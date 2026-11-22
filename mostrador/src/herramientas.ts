import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import {
  agregarLinea,
  calcularTotales,
  cuentas,
  ErrorPedido,
  faltantes,
  modificarLinea,
  quitarLinea,
  resumenCliente,
  type LineaPedido,
  type Pedido,
} from "./order.ts";
import { estaAbierto, estimarEspera, horaLocal, textoHorarios } from "./tiempos.ts";

// ---------------- esquemas de entrada ----------------

const OpcionIn = z.strictObject({
  grupo: z.string().describe("nombre del grupo de opción, ej: 'tamaño', 'carne', 'guarnición', 'sabor'"),
  valor: z.string().describe("id del valor elegido, ej: 'doble', 'pollo', 'pure', 'chica'"),
});

const ReemplazoIn = z.strictObject({
  quitar: z.string().describe("ingrediente que trae el producto y el cliente NO quiere"),
  poner: z.string().describe("ingrediente que quiere en su lugar (tiene que ser uno que el local ya usa)"),
});

const LineaIn = z.strictObject({
  producto_id: z.string().describe("id exacto del producto en el menú"),
  cantidad: z.number().int().optional().describe("unidades, por defecto 1"),
  opciones: z.array(OpcionIn).optional().describe("una por cada grupo de opción obligatorio del producto"),
  extras: z.array(z.string()).optional().describe("ids de extras con costo, ej: ['bacon','cheddar-extra']"),
  sin_ingredientes: z.array(z.string()).optional().describe("ingredientes a SACAR por completo, ej: ['cebolla','tomate']"),
  observacion: z
    .string()
    .optional()
    .describe("pedido especial de cocina para ESTA línea: 'poca cebolla', 'pizza con piso', 'bien cocida', 'cortar en 4', 'salsa aparte'"),
  reemplazos: z
    .array(ReemplazoIn)
    .optional()
    .describe("cambiar un ingrediente por otro, ej: [{quitar:'cebolla caramelizada', poner:'cebolla brunoise'}]. Sin costo."),
});

export const Esquemas = {
  enviar_menu: z.strictObject({
    categoria: z.string().optional().describe("id de categoría para mandar solo esa parte; omitir para el menú completo"),
  }),
  consultar_precios: z.strictObject({
    productos: z.array(z.string()).min(1).describe("ids de productos o extras a consultar"),
  }),
  agregar_productos: z.strictObject({ items: z.array(LineaIn).min(1) }),
  modificar_producto: z.strictObject({
    linea: z.number().int().describe("número de línea [n] que muestra ver_pedido"),
    cantidad: z.number().int().optional(),
    opciones: z.array(OpcionIn).optional(),
    extras: z.array(z.string()).optional().describe("lista COMPLETA de extras que debe quedar (reemplaza la anterior)"),
    sin_ingredientes: z.array(z.string()).optional().describe("lista COMPLETA de ingredientes a sacar (reemplaza la anterior)"),
    observacion: z.string().optional().describe("observación COMPLETA que debe quedar; '' para borrarla"),
    reemplazos: z.array(ReemplazoIn).optional().describe("lista COMPLETA de cambios de ingrediente (reemplaza la anterior); [] para borrarlos"),
  }),
  quitar_producto: z.strictObject({ linea: z.number().int() }),
  ver_pedido: z.strictObject({}),
  configurar_entrega: z.strictObject({
    modo: z.enum(["delivery", "take_away"]),
    direccion: z.string().optional().describe("calle y altura, piso/depto si corresponde, y localidad"),
    entre_calles: z.string().optional(),
    referencias: z.string().optional().describe("timbre, portón, color de casa, etc."),
    zona_id: z.string().optional().describe("id de la zona de delivery"),
  }),
  datos_cliente: z.strictObject({
    nombre: z.string().optional(),
    observacion_general: z.string().optional().describe("observación para todo el pedido: 'tocar timbre 2B', 'sin cubiertos', 'llamar al llegar'"),
  }),
  elegir_pago: z.strictObject({
    metodo: z.enum(["transferencia", "efectivo", "mixto"]).describe("mixto = paga una parte en efectivo y el resto por transferencia"),
    monto_efectivo: z.number().optional().describe("solo mixto: cuánto paga en efectivo; el resto se transfiere"),
    paga_con: z.number().optional().describe("efectivo o mixto: billete con el que paga la parte en efectivo, para llevar el vuelto"),
  }),
  estado_local: z.strictObject({}),
  confirmar_pedido: z.strictObject({}),
  estado_pedido: z.strictObject({}),
  cancelar_pedido: z.strictObject({ motivo: z.string() }),
  nuevo_pedido: z.strictObject({}),
  sumar_a_pedido_en_cocina: z.strictObject({
    items: z.array(LineaIn).min(1),
    pago: z.enum(["efectivo", "transferencia"]).describe("cómo paga lo que se suma"),
  }),
  derivar_a_humano: z.strictObject({ motivo: z.string() }),
} as const;

export type NombreHerramienta = keyof typeof Esquemas;

const DESCRIPCIONES: Record<NombreHerramienta, string> = {
  enviar_menu:
    "Envía al cliente el menú con precios (completo o de una categoría) como mensaje aparte. Usalo cuando pida la carta o no sepa qué pedir; después no repitas el menú en tu respuesta.",
  consultar_precios:
    "Precio vigente, variantes, extras con su costo y disponibilidad de los productos indicados. Usalo cuando pregunten cuánto sale algo o antes de ofrecer una alternativa.",
  agregar_productos:
    "Agrega uno o más productos al pedido. Si falta una opción obligatoria (tamaño, carne, guarnición...) devuelve error con las alternativas: preguntale al cliente. Devuelve el pedido actualizado con precios.",
  modificar_producto: "Cambia una línea existente del pedido (cantidad, opciones, extras, ingredientes a sacar u observación).",
  quitar_producto: "Saca una línea del pedido.",
  ver_pedido: "Devuelve el resumen detallado del pedido (líneas, subtotal, envío, total) y la lista de datos que faltan para confirmar.",
  configurar_entrega: "Define delivery o take away. Para delivery hacen falta dirección y zona; devuelve el costo de envío.",
  datos_cliente: "Guarda el nombre del cliente y/o una observación general del pedido.",
  elegir_pago:
    "Define el medio de pago: transferencia (se envía alias y se pide comprobante), efectivo, o mixto (una parte en efectivo con monto_efectivo y el resto por transferencia).",
  estado_local:
    "Devuelve hora actual, si el local está abierto, la demora actual de cocina y el tiempo estimado para el pedido que se está armando.",
  confirmar_pedido:
    "Cierra el pedido. Solo llamalo cuando el cliente aceptó explícitamente el resumen. El sistema envía automáticamente el ticket, el tiempo estimado y, si es transferencia, el alias.",
  estado_pedido: "Estado actual del pedido confirmado (en cocina, listo, en camino...) y hora estimada.",
  cancelar_pedido: "Cancela el pedido si todavía no entró a cocina.",
  nuevo_pedido: "Empieza un pedido nuevo cuando el anterior ya está confirmado y el cliente quiere hacer otro aparte.",
  sumar_a_pedido_en_cocina:
    "Suma productos a un pedido que YA está en cocina, si entró hace poco (el plazo lo controla el sistema). Sale todo junto, un poco más tarde. Antes de llamarla decile al cliente cuánto suma (consultar_precios) y que se demora unos minutos más, y esperá que diga que sí. El sistema le avisa a cocina, recalcula la hora y, si paga por transferencia, le manda el alias por el monto agregado.",
  derivar_a_humano:
    "Pasa la conversación a una persona del local: el bot deja de responder a este cliente hasta que el local lo libere. Usalo ante reclamos, pedidos especiales que no están en la carta, situaciones de la lista 'Derivar a una persona', o cuando no estés seguro de la respuesta. Más vale derivar que responder mal.",
};

export function definicionesHerramientas(): Anthropic.Beta.BetaTool[] {
  return (Object.keys(Esquemas) as NombreHerramienta[]).map((name) => {
    const { $schema: _omit, ...schema } = z.toJSONSchema(Esquemas[name]) as Record<string, unknown>;
    return { name, description: DESCRIPCIONES[name], input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
  });
}

// ---------------- ejecución ----------------

export type Efecto =
  | { tipo: "comanda"; pedidoId: number; tanda?: number }
  | { tipo: "avisar_staff"; texto: string }
  | { tipo: "atencion_humana"; pedidoId: number; motivo: string }
  | { tipo: "verificar_comprobante_pendiente"; pedidoId: number };

export interface ContextoHerramientas {
  menu: Menu;
  negocio: Negocio;
  /** pedido actual de la conversación (se modifica en memoria y se guarda al final del turno) */
  pedido: Pedido;
  cargaCocina: () => number;
  demoraExtra: () => number;
  abiertoManual: () => boolean | null;
  crearPedido: () => Pedido;
  ahora: () => Date;
  /** mensajes deterministas que se mandan al cliente antes de la respuesta del modelo */
  salida: string[];
  efectos: Efecto[];
}

export function textoMenu(menu: Menu, categoria?: string): string {
  const cats = menu.categorias.filter((c) => !categoria || c.id === categoria);
  if (!cats.length) throw new ErrorPedido(`Categoría inexistente. Usá una de: ${menu.categorias.map((c) => c.id).join(", ")}`);
  const out: string[] = [];
  for (const c of cats) {
    out.push(`${c.emoji} *${c.nombre.toUpperCase()}*`);
    for (const p of menu.productos.filter((x) => x.categoria === c.id && x.disponible)) {
      const variantes = p.opciones
        .filter((g) => g.valores.some((v) => v.precio !== 0))
        .map((g) => g.valores.map((v) => `${v.nombre} ${pesos(p.precio + v.precio)}`).join(" · "));
      out.push(`• *${p.nombre}* — ${variantes.length ? variantes.join(" | ") : pesos(p.precio)}`);
      if (p.descripcion) out.push(`  _${p.descripcion}_`);
      // opciones sin diferencia de precio (variedad, sabor…): se listan para que el cliente sepa qué elegir
      for (const g of p.opciones.filter((g) => g.valores.every((v) => v.precio === 0) && g.valores.length <= 4)) {
        out.push(`  ${g.grupo[0].toUpperCase()}${g.grupo.slice(1)}: ${g.valores.map((v) => v.nombre).join(" / ")}`);
      }
    }
    out.push("");
  }
  if (!categoria) {
    out.push("➕ *AGREGADOS*");
    out.push(menu.extras.filter((e) => e.disponible).map((e) => `${e.nombre} ${pesos(e.precio)}`).join(" · "));
  }
  return out.join("\n").trim();
}

/** Minutos que le quedan al cliente para sumar cosas a un pedido en cocina (0 = ya no se puede). */
export function minutosParaSumar(negocio: Negocio, pedido: Pedido, ahora: Date): number {
  if (pedido.estado !== "en_cocina") return 0;
  const desde = new Date(pedido.enCocinaDesde ?? pedido.confirmadoEn ?? pedido.creadoEn).getTime();
  const quedan = negocio.cocina.minutosParaAgregar - (ahora.getTime() - desde) / 60_000;
  return quedan > 0 ? Math.ceil(quedan) : 0;
}

function puedeEditar(ctx: ContextoHerramientas): string | null {
  const e = ctx.pedido.estado;
  if (e === "armando") return null;
  if (e === "esperando_pago") {
    ctx.pedido.estado = "armando";
    ctx.pedido.horaEstimada = undefined;
    ctx.pedido.minutosEstimados = undefined;
    return "AVISO: el pedido estaba confirmado esperando el pago; volvió a estado 'armando' y hay que confirmarlo de nuevo (el total puede cambiar).";
  }
  if (minutosParaSumar(ctx.negocio, ctx.pedido, ctx.ahora()) > 0) {
    throw new ErrorPedido(
      `El pedido #${ctx.pedido.id} ya está en cocina. Si el cliente quiere SUMAR productos, todavía está a tiempo: usá sumar_a_pedido_en_cocina. Para sacar o cambiar algo de lo que ya se está preparando, derivar_a_humano.`,
    );
  }
  throw new ErrorPedido(
    `El pedido #${ctx.pedido.id} ya está ${e.replace("_", " ")} y no se puede modificar desde el chat. Si quiere algo más, puede hacer un pedido nuevo aparte (nuevo_pedido); para cambios en lo que ya se prepara, derivar_a_humano.`,
  );
}

function abiertoAhora(ctx: ContextoHerramientas): boolean {
  const manual = ctx.abiertoManual();
  return manual ?? estaAbierto(ctx.negocio, ctx.ahora());
}

function resumenConFaltantes(ctx: ContextoHerramientas, aviso?: string | null) {
  const f = faltantes(ctx.menu, ctx.negocio, ctx.pedido);
  return [
    aviso ?? "",
    resumenCliente(ctx.menu, ctx.negocio, ctx.pedido),
    "",
    f.length ? `FALTA PARA CONFIRMAR: ${f.join("; ")}.` : "Todo listo para confirmar: mostrale el resumen al cliente y pedile que confirme.",
  ]
    .filter((x, i) => x || i > 0)
    .join("\n");
}

export function ejecutarHerramienta(nombre: string, input: unknown, ctx: ContextoHerramientas): string {
  if (!(nombre in Esquemas)) throw new ErrorPedido(`Herramienta desconocida: ${nombre}`);
  const parsed = Esquemas[nombre as NombreHerramienta].safeParse(input);
  if (!parsed.success) throw new ErrorPedido(`Parámetros inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const a = parsed.data as Record<string, any>;
  const { menu, negocio, pedido } = ctx;

  switch (nombre as NombreHerramienta) {
    case "enviar_menu": {
      ctx.salida.push(textoMenu(menu, a.categoria));
      return "Menú enviado al cliente.";
    }
    case "consultar_precios": {
      return (a.productos as string[])
        .map((id) => {
          const p = menu.productos.find((x) => x.id === id);
          if (p) {
            const variantes = p.opciones
              .map((g) => `${g.grupo}: ${g.valores.map((v) => `${v.nombre} ${pesos(p.precio + v.precio)}`).join(" / ")}`)
              .join("; ");
            const extras = p.extras
              .map((eid) => menu.extras.find((e) => e.id === eid)!)
              .filter((e) => e.disponible)
              .map((e) => `${e.nombre} +${pesos(e.precio)}`)
              .join(", ");
            return `${p.nombre}: ${p.disponible ? "" : "AGOTADO HOY. "}${variantes || pesos(p.precio)}${extras ? ` | extras: ${extras}` : ""}`;
          }
          const e = menu.extras.find((x) => x.id === id);
          if (e) return `${e.nombre} (extra): +${pesos(e.precio)}${e.disponible ? "" : " — AGOTADO HOY"}`;
          return `${id}: no existe en el menú`;
        })
        .join("\n");
    }
    case "agregar_productos": {
      const aviso = puedeEditar(ctx);
      const agregadas: string[] = [];
      const errores: string[] = [];
      for (const item of a.items) {
        try {
          const l = agregarLinea(menu, pedido, item);
          agregadas.push(`línea ${l.linea}`);
        } catch (e) {
          if (e instanceof ErrorPedido) errores.push(`${item.producto_id}: ${e.message}`);
          else throw e;
        }
      }
      return [
        agregadas.length ? `Agregado: ${agregadas.join(", ")}.` : "No se agregó nada.",
        errores.length ? `ERRORES (no se agregaron): ${errores.join(" | ")}` : "",
        resumenConFaltantes(ctx, aviso),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "modificar_producto": {
      const aviso = puedeEditar(ctx);
      modificarLinea(menu, pedido, a as never);
      return resumenConFaltantes(ctx, aviso);
    }
    case "quitar_producto": {
      const aviso = puedeEditar(ctx);
      quitarLinea(pedido, a.linea);
      return resumenConFaltantes(ctx, aviso);
    }
    case "ver_pedido":
      return resumenConFaltantes(ctx);
    case "configurar_entrega": {
      const aviso = puedeEditar(ctx);
      if (a.modo === "take_away") {
        pedido.entrega = { modo: "take_away" };
        return `${aviso ?? ""}\nTake away: retira en ${negocio.direccionLocal}. Sin costo de envío.\n${resumenConFaltantes(ctx)}`.trim();
      }
      if (a.zona_id && !negocio.delivery.zonas.some((z) => z.id === a.zona_id)) {
        throw new ErrorPedido(`Zona inexistente. Zonas: ${negocio.delivery.zonas.map((z) => `${z.id} = ${z.nombre} (${z.referencia})`).join("; ")}`);
      }
      const prev = pedido.entrega?.modo === "delivery" ? pedido.entrega : { modo: "delivery" as const };
      pedido.entrega = {
        modo: "delivery",
        direccion: a.direccion ?? prev.direccion,
        entreCalles: a.entre_calles ?? prev.entreCalles,
        referencias: a.referencias ?? prev.referencias,
        zonaId: a.zona_id ?? prev.zonaId,
      };
      return resumenConFaltantes(ctx, aviso);
    }
    case "datos_cliente": {
      if (a.nombre) pedido.cliente = a.nombre.trim();
      if (a.observacion_general !== undefined) {
        puedeEditar(ctx);
        pedido.observacionGeneral = a.observacion_general.trim() || undefined;
      }
      return resumenConFaltantes(ctx);
    }
    case "elegir_pago": {
      const aviso = puedeEditar(ctx);
      if (a.metodo !== "transferencia" && !negocio.pago.aceptaEfectivo) throw new ErrorPedido("El local no acepta efectivo por ahora, solo transferencia.");
      if (a.metodo === "mixto" && a.monto_efectivo === undefined) throw new ErrorPedido("Para pago mixto falta monto_efectivo: preguntale cuánto paga en efectivo (el resto va por transferencia).");
      pedido.pago = {
        metodo: a.metodo,
        pagaCon: a.metodo === "transferencia" ? undefined : a.paga_con,
        montoEfectivo: a.metodo === "mixto" ? a.monto_efectivo : undefined,
      };
      const c = cuentas(menu, negocio, pedido);
      const detalle = a.metodo === "mixto" ? `Pago mixto: ${pesos(c.efectivo)} en efectivo y ${pesos(c.transferenciaBase)} por transferencia.\n` : "";
      return `${detalle}${resumenConFaltantes(ctx, aviso)}`;
    }
    case "estado_local": {
      const ahora = ctx.ahora();
      const est = estimarEspera(menu, negocio, pedido, ctx.cargaCocina(), ctx.demoraExtra(), ahora);
      return [
        `Hora actual: ${horaLocal(ahora, negocio.zonaHoraria)}.`,
        `Local ${abiertoAhora(ctx) ? "ABIERTO" : "CERRADO"} (horarios: ${textoHorarios(negocio)}).`,
        `Pedidos en curso en cocina: ${ctx.cargaCocina()}. Demora extra cargada por el local: ${ctx.demoraExtra()} min.`,
        pedido.lineas.length
          ? `Tiempo estimado para este pedido: ${est.rango[0]}–${est.rango[1]} min (${est.detalle}).`
          : "Todavía no hay productos para estimar el tiempo.",
        `Zonas de delivery: ${negocio.delivery.zonas.map((z) => `${z.id} ${z.nombre} ${pesos(z.costo)}`).join("; ")}. Pedido mínimo delivery ${pesos(negocio.delivery.pedidoMinimo)}.`,
      ].join("\n");
    }
    case "confirmar_pedido": {
      if (pedido.estado !== "armando") throw new ErrorPedido(`El pedido #${pedido.id} ya está confirmado (estado: ${pedido.estado}).`);
      if (!abiertoAhora(ctx)) throw new ErrorPedido(`El local está cerrado ahora. Horarios: ${textoHorarios(negocio)}. No se puede confirmar.`);
      const f = faltantes(menu, negocio, pedido);
      if (f.length) throw new ErrorPedido(`No se puede confirmar todavía. Falta: ${f.join("; ")}.`);
      const ahora = ctx.ahora();
      const est = estimarEspera(menu, negocio, pedido, ctx.cargaCocina(), ctx.demoraExtra(), ahora);
      const t = calcularTotales(menu, negocio, pedido);
      pedido.confirmadoEn = ahora.toISOString();
      pedido.minutosEstimados = est.rango;
      pedido.horaEstimada = est.horaEstimada.toISOString();
      const llega = pedido.entrega?.modo === "delivery" ? "llega" : "está listo para retirar";
      const tiempo = `⏱️ Tiempo estimado: *${est.rango[0]} a ${est.rango[1]} minutos* (${llega} aprox. a las ${horaLocal(est.horaEstimada, negocio.zonaHoraria)}).`;

      if (pedido.pago?.metodo === "transferencia" || pedido.pago?.metodo === "mixto") {
        const c = cuentas(menu, negocio, pedido);
        const mixto = pedido.pago.metodo === "mixto";
        pedido.estado = "esperando_pago";
        if (negocio.pago.comandaAntesDelPago) ctx.efectos.push({ tipo: "comanda", pedidoId: pedido.id! });
        ctx.salida.push(`✅ *Pedido #${pedido.id} confirmado* · Total *${pesos(t.total)}*\n${tiempo}`);
        ctx.salida.push(
          [
            `💸 Para pagar transferí *${pesos(c.transferenciaBase)}* a:`,
            `Alias: *${negocio.pago.alias}*`,
            negocio.pago.cvu ? `CVU: ${negocio.pago.cvu}` : "",
            `Titular: ${negocio.pago.titular}${negocio.pago.banco ? ` (${negocio.pago.banco})` : ""}`,
            "",
            mixto ? `💵 Los otros *${pesos(c.efectivo)}* los pagás en efectivo ${pedido.entrega?.modo === "delivery" ? "cuando te llega" : "cuando retirás"}.` : "",
            "",
            "📸 Cuando transfieras, mandame la *captura del comprobante* por acá y lo mandamos a cocina.",
          ]
            .filter((x, i, xs) => x !== "" || (i > 0 && xs[i - 1] !== ""))
            .join("\n"),
        );
        ctx.efectos.push({ tipo: "verificar_comprobante_pendiente", pedidoId: pedido.id! });
        return `Pedido #${pedido.id} confirmado, esperando comprobante de transferencia por ${pesos(c.transferenciaBase)}${mixto ? ` (y ${pesos(c.efectivo)} en efectivo al entregar)` : ""}. El sistema YA envió la confirmación con el total, el tiempo estimado y el alias: no los repitas, solo cerrá con una frase corta.`;
      }
      pedido.estado = "en_cocina";
      pedido.enCocinaDesde = ahora.toISOString();
      ctx.salida.push(`✅ *Pedido #${pedido.id} confirmado y en cocina* · Total *${pesos(t.total)}*${pedido.pago?.pagaCon ? ` (pagás con ${pesos(pedido.pago.pagaCon)}, te llevamos ${pesos(pedido.pago.pagaCon - t.total)} de vuelto)` : ""}\n${tiempo}`);
      ctx.efectos.push({ tipo: "comanda", pedidoId: pedido.id! });
      return `Pedido #${pedido.id} confirmado en efectivo y enviado a cocina. El sistema YA envió la confirmación con el total y el tiempo estimado: no los repitas, solo agradecé en una frase.`;
    }
    case "estado_pedido": {
      if (pedido.estado === "armando") return "El pedido todavía no está confirmado.";
      const textos: Record<string, string> = {
        esperando_pago: "confirmado, esperando el comprobante de transferencia",
        pago_en_revision: "el comprobante lo está revisando el personal",
        en_cocina: "en preparación en cocina",
        listo: pedido.entrega?.modo === "delivery" ? "listo, por salir con el repartidor" : "listo para retirar",
        en_camino: "en camino con el repartidor",
        entregado: "entregado",
        cancelado: "cancelado",
      };
      const hora = pedido.horaEstimada ? ` Hora estimada: ${horaLocal(new Date(pedido.horaEstimada), negocio.zonaHoraria)}.` : "";
      const quedan = minutosParaSumar(negocio, pedido, ctx.ahora());
      const sumar = quedan ? ` Todavía se le pueden sumar productos (quedan ${quedan} min).` : "";
      return `Pedido #${pedido.id}: ${textos[pedido.estado]}.${hora}${sumar}`;
    }
    case "cancelar_pedido": {
      if (!["armando", "esperando_pago", "pago_en_revision"].includes(pedido.estado)) {
        throw new ErrorPedido(`El pedido ya está ${pedido.estado.replace("_", " ")}; no se puede cancelar desde el chat. Usá derivar_a_humano.`);
      }
      const estabaConfirmado = pedido.estado !== "armando";
      pedido.estado = "cancelado";
      if (estabaConfirmado) ctx.efectos.push({ tipo: "avisar_staff", texto: `❌ El cliente canceló el pedido #${pedido.id}. Motivo: ${a.motivo}` });
      return `Pedido #${pedido.id} cancelado.`;
    }
    case "nuevo_pedido": {
      if (pedido.estado === "armando" && pedido.lineas.length) throw new ErrorPedido("Ya hay un pedido en armado: seguí con ese o cancelalo primero.");
      const nuevo = ctx.crearPedido();
      ctx.pedido = nuevo;
      return `Pedido nuevo #${nuevo.id} iniciado (vacío).`;
    }
    case "sumar_a_pedido_en_cocina": {
      const ahora = ctx.ahora();
      if (pedido.estado !== "en_cocina") {
        throw new ErrorPedido(
          pedido.estado === "armando" || pedido.estado === "esperando_pago"
            ? "El pedido todavía no está en cocina: usá agregar_productos."
            : `El pedido #${pedido.id} ya está ${pedido.estado.replace("_", " ")}: ya no se le puede sumar nada. Ofrecé un pedido nuevo aparte (nuevo_pedido).`,
        );
      }
      if (!minutosParaSumar(negocio, pedido, ahora)) {
        throw new ErrorPedido(
          `Pasaron más de ${negocio.cocina.minutosParaAgregar} minutos desde que el pedido #${pedido.id} entró a cocina: ya no se puede sumar al mismo pedido. Ofrecé un pedido nuevo aparte (nuevo_pedido).`,
        );
      }
      if (a.pago === "efectivo" && !negocio.pago.aceptaEfectivo) throw new ErrorPedido("El local no acepta efectivo, solo transferencia.");
      const antes = calcularTotales(menu, negocio, pedido).total;
      const tanda = (pedido.agregados?.length ?? 0) + 1;
      const nuevas: LineaPedido[] = [];
      const errores: string[] = [];
      for (const item of a.items) {
        try {
          const l = agregarLinea(menu, pedido, item);
          l.tanda = tanda;
          nuevas.push(l);
        } catch (e) {
          if (e instanceof ErrorPedido) errores.push(`${item.producto_id}: ${e.message}`);
          else throw e;
        }
      }
      if (!nuevas.length) throw new ErrorPedido(`No se sumó nada. ${errores.join(" | ")}`);
      const monto = calcularTotales(menu, negocio, pedido).total - antes;
      const enTransferencia = a.pago === "transferencia";
      pedido.agregados = [
        ...(pedido.agregados ?? []),
        { tanda, en: ahora.toISOString(), monto, pago: a.pago, pagado: false, comandaEnviada: false },
      ];
      // Lo sumado se prepara aparte, sin cola: el pedido sale cuando esté todo.
      const soloLoNuevo: Pedido = { ...pedido, lineas: nuevas };
      const est = estimarEspera(menu, negocio, soloLoNuevo, 0, ctx.demoraExtra(), ahora);
      const anterior = pedido.horaEstimada ? new Date(pedido.horaEstimada).getTime() : 0;
      const nueva = Math.max(anterior + 5 * 60_000, est.horaEstimada.getTime());
      pedido.horaEstimada = new Date(nueva).toISOString();
      const hora = horaLocal(new Date(nueva), negocio.zonaHoraria);
      const llega = pedido.entrega?.modo === "delivery" ? "Llega" : "Está listo para retirar";
      const nombres = calcularTotales(menu, negocio, pedido)
        .lineas.filter((d) => d.tanda === tanda)
        .map((d) => `${d.cantidad}x ${d.nombre}`)
        .join(", ");
      const total = antes + monto;
      if (enTransferencia) {
        ctx.salida.push(
          [
            `➕ Sumé ${nombres} al pedido #${pedido.id}. Nuevo total *${pesos(total)}*.`,
            `💸 Transferí los *${pesos(monto)}* que se agregan al alias *${negocio.pago.alias}* (${negocio.pago.titular}) y mandame el comprobante.`,
            `⏱️ ${llega} aprox. a las *${hora}*.`,
          ].join("\n"),
        );
        if (negocio.pago.comandaAntesDelPago) ctx.efectos.push({ tipo: "comanda", pedidoId: pedido.id!, tanda });
      } else {
        const cobrar = cuentas(menu, negocio, pedido).efectivo;
        ctx.salida.push(
          [
            `➕ Sumé ${nombres} al pedido #${pedido.id}. Nuevo total *${pesos(total)}*.`,
            `💵 ${pedido.entrega?.modo === "delivery" ? "Al recibir" : "Al retirar"} pagás *${pesos(cobrar)}* en efectivo.`,
            `⏱️ ${llega} aprox. a las *${hora}*.`,
          ].join("\n"),
        );
        ctx.efectos.push({ tipo: "comanda", pedidoId: pedido.id!, tanda });
      }
      return [
        `Sumado al pedido #${pedido.id} (agregado ${tanda}, ${pesos(monto)}, paga por ${a.pago}). El sistema YA le mandó al cliente lo sumado, el nuevo total, cómo pagar y la nueva hora: no lo repitas, cerrá con una frase corta.`,
        errores.length ? `ERRORES (no se sumaron): ${errores.join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "derivar_a_humano": {
      ctx.efectos.push({ tipo: "atencion_humana", pedidoId: pedido.id!, motivo: a.motivo });
      return "Listo: una persona del local toma la conversación. Decile al cliente en una línea, con buena onda y hablándole de vos, algo como \"ya te escribe alguien del local\". No agregues nada más.";
    }
  }
}
