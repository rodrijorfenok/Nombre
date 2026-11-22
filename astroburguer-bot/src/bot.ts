import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { env, type Menu, type Negocio } from "./config.ts";
import { comandaTexto } from "./comanda.ts";
import { evaluarComprobante, extraerDatosComprobante, type DatosComprobante } from "./comprobantes.ts";
import { Store, type Conversacion, type Mensaje } from "./db.ts";
import { definicionesHerramientas, ejecutarHerramienta, type ContextoHerramientas, type Efecto } from "./herramientas.ts";
import { pesos } from "./money.ts";
import { calcularTotales, ErrorPedido, type Pedido } from "./order.ts";
import { systemPrompt } from "./prompt.ts";
import { estimarEspera, horaLocal } from "./tiempos.ts";

export interface Mensajero {
  enviarTexto(telefono: string, texto: string): Promise<void>;
}

export type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export type Entrante =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagen"; datos: Buffer; mime: MediaType; caption?: string }
  | { tipo: "ubicacion"; lat: number; lng: number; nombre?: string; direccion?: string }
  | { tipo: "audio" }
  | { tipo: "otro"; descripcion: string };

const HORAS_REINICIO_CONVERSACION = 4;
const MAX_VUELTAS_HERRAMIENTAS = 10;

export class Bot {
  private readonly system: string;
  private readonly tools = definicionesHerramientas();
  private colas = new Map<string, Promise<unknown>>();

  constructor(
    readonly store: Store,
    readonly menu: Menu,
    readonly negocio: Negocio,
    private readonly client: Anthropic,
    readonly mensajero: Mensajero,
    private readonly reloj: () => Date = () => new Date(),
  ) {
    // El system prompt se arma una vez por proceso: debe quedar idéntico entre turnos
    // (caché de prompt e historial de pensamiento solo-agregar).
    this.system = systemPrompt(menu, negocio);
  }

  /** Serializa los mensajes de cada teléfono: WhatsApp manda ráfagas y no queremos turnos en paralelo. */
  recibir(telefono: string, msg: Entrante): Promise<void> {
    const prev = this.colas.get(telefono) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.procesar(telefono, msg))
      .catch(async (e) => {
        console.error(`[bot] error procesando mensaje de ${telefono}:`, e);
        await this.mensajero.enviarTexto(telefono, "Uy, tuve un problemita técnico 😅 ¿Me repetís el último mensaje?").catch(() => {});
      });
    this.colas.set(telefono, next);
    return next;
  }

  // ------------------------------------------------------------------

  private async procesar(telefono: string, msg: Entrante) {
    if (msg.tipo === "audio") {
      await this.mensajero.enviarTexto(telefono, "Todavía no puedo escuchar audios 🙏 ¿Me lo escribís, porfa?");
      return;
    }
    const conv = this.conversacionVigente(telefono);
    const pedido = this.store.pedido(conv.pedidoId!)!;

    if (msg.tipo === "imagen" && ["esperando_pago", "pago_en_revision"].includes(pedido.estado)) {
      await this.procesarComprobante(conv, pedido, msg.datos, msg.mime);
      return;
    }

    let contenido: Anthropic.Beta.BetaContentBlockParam[];
    switch (msg.tipo) {
      case "texto":
        contenido = [{ type: "text", text: msg.texto }];
        break;
      case "ubicacion":
        contenido = [
          {
            type: "text",
            text: `[El cliente compartió su ubicación: ${msg.direccion ?? ""} ${msg.nombre ?? ""} (lat ${msg.lat}, lng ${msg.lng}). Pedile igual calle, altura y entre calles si no las dio.]`,
          },
        ];
        break;
      case "imagen": {
        const archivo = this.guardarArchivo(pedido.id!, msg.datos, msg.mime);
        (pedido as Pedido & { comprobantePendiente?: string }).comprobantePendiente = archivo;
        this.store.guardarPedido(pedido);
        contenido = [
          {
            type: "text",
            text: "[El cliente envió una imagen. Si es un comprobante de pago, quedó guardado y se verifica automáticamente cuando el pedido se confirme con transferencia.]",
          },
        ];
        if (msg.mime !== "application/pdf") contenido.push({ type: "image", source: { type: "base64", media_type: msg.mime, data: msg.datos.toString("base64") } });
        if (msg.caption) contenido.push({ type: "text", text: msg.caption });
        break;
      }
      case "otro":
        contenido = [{ type: "text", text: `[El cliente envió ${msg.descripcion}, que no se puede procesar.]` }];
        break;
    }
    await this.turnoAgente(conv, pedido, contenido);
  }

  private conversacionVigente(telefono: string): Conversacion {
    const c = this.store.conversacion(telefono);
    if (c?.pedidoId) {
      const p = this.store.pedido(c.pedidoId);
      const horas = (this.reloj().getTime() - new Date(c.actualizadoEn).getTime()) / 3_600_000;
      const terminado = !p || p.estado === "entregado" || p.estado === "cancelado";
      const abandonado = p?.estado === "armando" && horas > HORAS_REINICIO_CONVERSACION;
      if (!terminado && !abandonado && horas < 24) return c;
      if (abandonado && p) {
        p.estado = "cancelado";
        this.store.guardarPedido(p);
      }
    }
    // Conversación nueva = historial nuevo (no se recorta ni edita el historial viejo).
    const pedido = this.store.crearPedido(telefono, this.reloj());
    const nueva: Conversacion = { telefono, mensajes: [], pedidoId: pedido.id!, actualizadoEn: this.reloj().toISOString() };
    this.store.guardarConversacion(nueva);
    return nueva;
  }

  private async llamarModelo(mensajes: Mensaje[]) {
    return this.client.beta.messages.create({
      model: env.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: env.effort },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
      tools: this.tools,
      messages: mensajes,
    });
  }

  private async turnoAgente(conv: Conversacion, pedidoInicial: Pedido, contenido: Anthropic.Beta.BetaContentBlockParam[]) {
    // Trabajamos sobre copias: si algo falla a mitad del turno no se guarda nada.
    const mensajes: Mensaje[] = [...conv.mensajes, { role: "user", content: contenido }];
    const ctx: ContextoHerramientas = {
      menu: this.menu,
      negocio: this.negocio,
      pedido: structuredClone(pedidoInicial),
      cargaCocina: () => this.store.cargaCocina(),
      demoraExtra: () => Number(this.store.ajuste("demora_extra") ?? 0),
      abiertoManual: () => {
        const v = this.store.ajuste("abierto_manual");
        return v === null ? null : v === "1";
      },
      crearPedido: () => {
        const p = this.store.crearPedido(conv.telefono, this.reloj());
        p.cliente = ctx.pedido.cliente;
        return p;
      },
      ahora: this.reloj,
      salida: [],
      efectos: [],
    };
    const pedidosTocados = new Map<number, Pedido>();

    let respuesta = "";
    for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
      const res = await this.llamarModelo(mensajes);
      mensajes.push({ role: "assistant", content: res.content });

      if (res.stop_reason === "refusal") {
        respuesta = "Perdón, con eso no te puedo ayudar por acá. Si querés, te comunico con alguien del local.";
        break;
      }
      if (res.stop_reason === "pause_turn") continue;

      const usos = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason === "tool_use" && usos.length) {
        const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of usos) {
          try {
            const texto = ejecutarHerramienta(u.name, u.input, ctx);
            resultados.push({ type: "tool_result", tool_use_id: u.id, content: texto });
          } catch (e) {
            if (!(e instanceof ErrorPedido)) throw e;
            resultados.push({ type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true });
          }
          pedidosTocados.set(ctx.pedido.id!, ctx.pedido);
        }
        mensajes.push({ role: "user", content: resultados });
        continue;
      }
      respuesta = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }
    if (!respuesta && !ctx.salida.length) respuesta = "¿Me repetís? No llegué a entender 🙏";

    // ---- commit ----
    pedidosTocados.set(ctx.pedido.id!, ctx.pedido);
    for (const p of pedidosTocados.values()) this.store.guardarPedido(p);
    this.store.guardarConversacion({ ...conv, mensajes, pedidoId: ctx.pedido.id! });

    for (const s of ctx.salida) await this.mensajero.enviarTexto(conv.telefono, s);
    if (respuesta) await this.mensajero.enviarTexto(conv.telefono, respuesta);
    for (const e of ctx.efectos) await this.aplicarEfecto(e, conv.telefono);
  }

  private async aplicarEfecto(e: Efecto, telefono: string) {
    switch (e.tipo) {
      case "comanda":
        await this.enviarComanda(e.pedidoId);
        break;
      case "avisar_staff":
        await this.avisarStaff(e.texto);
        break;
      case "verificar_comprobante_pendiente": {
        const p = this.store.pedido(e.pedidoId) as (Pedido & { comprobantePendiente?: string }) | null;
        if (p?.comprobantePendiente && fs.existsSync(p.comprobantePendiente)) {
          const archivo = p.comprobantePendiente;
          const mime: MediaType = archivo.endsWith(".pdf") ? "application/pdf" : archivo.endsWith(".png") ? "image/png" : "image/jpeg";
          const conv = this.store.conversacion(telefono)!;
          await this.procesarComprobante(conv, p, fs.readFileSync(archivo), mime, archivo);
        }
        break;
      }
    }
  }

  // ------------------------- comprobantes -------------------------

  private guardarArchivo(pedidoId: number, datos: Buffer, mime: MediaType): string {
    const dir = path.join(env.dataDir, "comprobantes");
    fs.mkdirSync(dir, { recursive: true });
    const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1].replace("jpeg", "jpg");
    const f = path.join(dir, `pedido-${pedidoId}-${Date.now()}.${ext}`);
    fs.writeFileSync(f, datos);
    return f;
  }

  private async procesarComprobante(conv: Conversacion, pedido: Pedido & { comprobantePendiente?: string }, datos: Buffer, mime: MediaType, archivoExistente?: string) {
    const archivo = archivoExistente ?? this.guardarArchivo(pedido.id!, datos, mime);
    const total = calcularTotales(this.menu, this.negocio, pedido).total;

    let extraidos: DatosComprobante | null = null;
    try {
      extraidos = await extraerDatosComprobante(this.client, datos, mime);
    } catch (e) {
      console.error("[comprobante] error leyendo imagen", e);
    }
    const duplicado = extraidos?.numero_operacion ? this.store.operacionYaUsada(extraidos.numero_operacion, pedido.id) : null;
    const r = evaluarComprobante(extraidos, {
      total,
      negocio: this.negocio,
      pedidoCreadoEn: new Date(pedido.creadoEn),
      ahora: this.reloj(),
      operacionDuplicada: Boolean(duplicado),
    });
    const comp = this.store.guardarComprobante({
      pedidoId: pedido.id!,
      telefono: pedido.telefono,
      archivo,
      numeroOperacion: extraidos?.numero_operacion ?? null,
      monto: extraidos?.monto ?? null,
      veredicto: r.veredicto,
      motivos: r.motivos,
      datos: extraidos,
    });
    pedido.comprobantePendiente = undefined;

    const linkImagen = env.publicUrl && env.panelToken ? `\n🖼️ ${env.publicUrl}/comprobante/${comp.id}?token=${env.panelToken}` : "";
    let texto = r.mensajeCliente;
    if (r.veredicto === "aprobado") {
      this.pasarACocina(pedido);
      texto += `\n⏱️ Llega/está listo aprox. a las *${horaLocal(new Date(pedido.horaEstimada!), this.negocio.zonaHoraria)}*.`;
    } else if (r.veredicto === "revisar") {
      pedido.estado = "pago_en_revision";
      this.store.guardarPedido(pedido);
      await this.avisarStaff(
        `🔎 Revisar comprobante del pedido #${pedido.id} (${pedido.cliente ?? pedido.telefono}) por ${pesos(total)}.\nMotivos: ${r.motivos.join("; ")}${linkImagen}\nRespondé *pago ok ${pedido.id}* o *pago no ${pedido.id} <motivo>*.`,
      );
    } else {
      this.store.guardarPedido(pedido);
      if (duplicado) await this.avisarStaff(`⚠️ Pedido #${pedido.id}: comprobante con operación ya usada en el pedido #${duplicado.pedidoId}.${linkImagen}`);
    }
    await this.mensajero.enviarTexto(conv.telefono, texto);
    if (r.veredicto === "aprobado") await this.enviarComanda(pedido.id!);
    this.registrarEvento(conv.telefono, `[El cliente envió un comprobante. Verificación automática: ${r.veredicto} (${r.motivos.join("; ")}).]`, texto);
  }

  /** Recalcula el tiempo desde ahora (el pago puede llegar tarde) y marca en cocina. */
  pasarACocina(pedido: Pedido) {
    pedido.pagoVerificado = pedido.pago?.metodo === "transferencia" ? true : pedido.pagoVerificado;
    pedido.estado = "en_cocina";
    const est = estimarEspera(this.menu, this.negocio, pedido, Math.max(0, this.store.cargaCocina() - 1), Number(this.store.ajuste("demora_extra") ?? 0), this.reloj());
    pedido.minutosEstimados = est.rango;
    pedido.horaEstimada = est.horaEstimada.toISOString();
    this.store.guardarPedido(pedido);
  }

  /**
   * Deja constancia en el historial del cliente de algo que pasó fuera del modelo
   * (comprobante, aviso del local). Se agrega al final: nunca se edita lo anterior.
   */
  registrarEvento(telefono: string, evento: string, textoEnviado: string) {
    const c = this.store.conversacion(telefono);
    if (!c) return;
    const ultimo = c.mensajes.at(-1);
    const mensajes = [...c.mensajes];
    // Si el último mensaje es del usuario (un turno que falló), lo cerramos para mantener la alternancia.
    if (ultimo?.role === "user") mensajes.push({ role: "assistant", content: "…" });
    mensajes.push({ role: "user", content: evento }, { role: "assistant", content: textoEnviado });
    this.store.guardarConversacion({ ...c, mensajes });
  }

  // ------------------------- avisos -------------------------

  async enviarComanda(pedidoId: number) {
    const p = this.store.pedido(pedidoId);
    if (!p) return;
    const texto = comandaTexto(this.menu, this.negocio, p);
    const link = env.publicUrl && env.panelToken ? `\n🖨️ ${env.publicUrl}/comanda/${p.id}?token=${env.panelToken}&print=1` : "";
    for (const n of env.kitchenNumbers) await this.mensajero.enviarTexto(n, texto + link).catch((e) => console.error("[comanda]", e));
    console.log(`[comanda] pedido #${p.id} enviado a cocina`);
  }

  async avisarStaff(texto: string) {
    for (const n of env.staffNumbers) await this.mensajero.enviarTexto(n, texto).catch((e) => console.error("[staff]", e));
    console.log(`[staff] ${texto}`);
  }
}
