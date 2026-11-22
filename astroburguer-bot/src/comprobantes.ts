import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env, type Negocio } from "./config.ts";
import { normalizar, pesos } from "./money.ts";

export const DatosComprobanteSchema = z.object({
  es_comprobante: z.boolean().describe("true si la imagen es un comprobante de transferencia o pago bancario/billetera virtual"),
  legible: z.boolean().describe("true si se pueden leer con claridad monto y destinatario"),
  monto: z.number().nullable().describe("monto transferido en pesos, como número sin separadores de miles (ej: 15300.50)"),
  fecha_hora: z
    .string()
    .nullable()
    .describe("fecha y hora de la operación tal como figura, normalizada a 'YYYY-MM-DDTHH:mm' en hora local argentina; null si no figura"),
  destinatario_nombre: z.string().nullable().describe("nombre del titular que RECIBE el dinero"),
  destinatario_alias_cvu: z.string().nullable().describe("alias, CVU o CBU del que recibe, si figura"),
  origen_nombre: z.string().nullable().describe("nombre de quien envía el dinero"),
  numero_operacion: z.string().nullable().describe("número/código de operación, transacción o comprobante"),
  entidad: z.string().nullable().describe("banco o billetera que emitió el comprobante (Mercado Pago, Ualá, Brubank, etc.)"),
  estado: z.string().nullable().describe("estado que muestra la operación, ej: 'aprobada', 'en proceso', 'programada'"),
  signos_de_edicion: z.boolean().describe("true si hay indicios visibles de edición o montaje (tipografías mezcladas, recortes, números superpuestos)"),
  observaciones: z.string().describe("cualquier detalle relevante, en una oración"),
});

export type DatosComprobante = z.infer<typeof DatosComprobanteSchema>;

export type Veredicto = "aprobado" | "revisar" | "rechazado";

export interface ResultadoComprobante {
  veredicto: Veredicto;
  motivos: string[];
  /** mensaje sugerido para el cliente */
  mensajeCliente: string;
}

const PROMPT_EXTRACCION = `Extraé los datos de este comprobante de pago argentino (transferencia bancaria, Mercado Pago u otra billetera).
Leé solamente lo que figura en la imagen: si un dato no está o no se lee, devolvé null. No inventes ni completes números.
Si la imagen no es un comprobante de pago (por ejemplo, una foto de comida, una captura de chat o un QR), indicá es_comprobante=false.`;

export async function extraerDatosComprobante(
  client: Anthropic,
  imagen: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf",
): Promise<DatosComprobante | null> {
  const data = imagen.toString("base64");
  const bloque: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  const res = await client.beta.messages.parse({
    model: env.model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(DatosComprobanteSchema) },
    messages: [{ role: "user", content: [bloque, { type: "text", text: PROMPT_EXTRACCION }] }],
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}

function parseFechaLocal(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  // Argentina es UTC-3 sin horario de verano.
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function coincideDestinatario(d: DatosComprobante, negocio: Negocio): boolean | null {
  const titular = normalizar(negocio.pago.titular);
  const alias = normalizar(negocio.pago.alias);
  const cvu = negocio.pago.cvu.replace(/\D/g, "");
  const nombre = d.destinatario_nombre ? normalizar(d.destinatario_nombre) : "";
  const cuenta = d.destinatario_alias_cvu ? normalizar(d.destinatario_alias_cvu) : "";
  if (!nombre && !cuenta) return null;
  if (cuenta) {
    if (alias && cuenta.replace(/ /g, "") === alias.replace(/ /g, "")) return true;
    const digitos = (d.destinatario_alias_cvu ?? "").replace(/\D/g, "");
    if (cvu && digitos.length >= 6 && (cvu.endsWith(digitos.slice(-6)) || digitos === cvu)) return true;
  }
  if (nombre) {
    // Los comprobantes suelen abreviar o cortar el nombre: alcanza con que coincidan 2 palabras (o todas si tiene menos).
    const pal = titular.split(" ").filter((w) => w.length > 2);
    const enComun = pal.filter((w) => nombre.includes(w)).length;
    if (enComun >= Math.min(2, pal.length)) return true;
  }
  return false;
}

/**
 * Reglas deterministas sobre los datos extraídos. El modelo solo lee la imagen;
 * la decisión de aceptar o no la toma este código.
 */
export function evaluarComprobante(
  d: DatosComprobante | null,
  opts: { total: number; negocio: Negocio; pedidoCreadoEn: Date; ahora?: Date; operacionDuplicada?: boolean },
): ResultadoComprobante {
  const { total, negocio } = opts;
  const ahora = opts.ahora ?? new Date();
  if (!d) {
    return { veredicto: "revisar", motivos: ["no se pudo analizar la imagen"], mensajeCliente: "Recibí tu comprobante, lo está revisando una persona del local. ¡Ya te confirmo!" };
  }
  if (!d.es_comprobante) {
    return {
      veredicto: "rechazado",
      motivos: ["la imagen no parece un comprobante de pago"],
      mensajeCliente: "Mmm, esa imagen no parece un comprobante de transferencia 🤔 ¿Me mandás la captura del comprobante?",
    };
  }
  if (!d.legible) {
    return {
      veredicto: "rechazado",
      motivos: ["comprobante ilegible"],
      mensajeCliente: "No llego a leer bien el comprobante. ¿Me mandás una captura más nítida donde se vea el monto y a quién se transfirió?",
    };
  }
  if (opts.operacionDuplicada) {
    return {
      veredicto: "rechazado",
      motivos: [`el número de operación ${d.numero_operacion} ya se usó en otro pedido`],
      mensajeCliente: "Ese comprobante ya fue usado en otro pedido. Si creés que es un error, te comunico con alguien del local.",
    };
  }

  const motivosRevisar: string[] = [];
  const motivosRechazo: string[] = [];

  if (d.monto === null) motivosRevisar.push("no se lee el monto");
  else if (d.monto + 1 < total) motivosRechazo.push(`monto ${pesos(d.monto)} menor al total ${pesos(total)} (faltan ${pesos(total - d.monto)})`);

  const dest = coincideDestinatario(d, negocio);
  if (dest === false) motivosRechazo.push(`el destinatario (${d.destinatario_nombre ?? d.destinatario_alias_cvu}) no coincide con la cuenta del local`);
  if (dest === null) motivosRevisar.push("no figura el destinatario");

  const fecha = parseFechaLocal(d.fecha_hora);
  if (!fecha) motivosRevisar.push("no se lee la fecha/hora");
  else {
    const desde = opts.pedidoCreadoEn.getTime() - negocio.pago.minutosValidezComprobante * 60_000;
    if (fecha.getTime() < desde) motivosRechazo.push(`comprobante viejo (${d.fecha_hora})`);
    else if (fecha.getTime() > ahora.getTime() + 15 * 60_000) motivosRevisar.push(`fecha futura (${d.fecha_hora})`);
  }

  if (d.estado && /proceso|pendiente|programad|revisi/i.test(d.estado)) motivosRevisar.push(`estado de la operación: ${d.estado}`);
  if (d.signos_de_edicion) motivosRevisar.push("posibles signos de edición");
  if (!d.numero_operacion) motivosRevisar.push("sin número de operación");

  if (motivosRechazo.length) {
    const faltaPlata = d.monto !== null && d.monto + 1 < total;
    return {
      veredicto: "rechazado",
      motivos: [...motivosRechazo, ...motivosRevisar],
      mensajeCliente: faltaPlata
        ? `El comprobante es por ${pesos(d.monto!)} y el total es ${pesos(total)}. Te faltan ${pesos(total - d.monto!)}: podés transferir la diferencia y mandarme ese comprobante también.`
        : `Hay un problema con el comprobante: ${motivosRechazo.join("; ")}. Revisá que la transferencia sea al alias *${negocio.pago.alias}* (${negocio.pago.titular}).`,
    };
  }
  if (motivosRevisar.length) {
    return {
      veredicto: "revisar",
      motivos: motivosRevisar,
      mensajeCliente: "¡Gracias! Recibí el comprobante y lo está chequeando alguien del local. En un ratito te confirmo y mandamos el pedido a cocina 🍔",
    };
  }
  const extra = d.monto! > total + 1 ? ` (transferiste ${pesos(d.monto! - total)} de más, lo charlamos con el local)` : "";
  return {
    veredicto: "aprobado",
    motivos: [`monto ${pesos(d.monto!)}`, `operación ${d.numero_operacion}`],
    mensajeCliente: `✅ ¡Pago recibido!${extra} Tu pedido ya pasó a cocina.`,
  };
}
