import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { menuVigente } from "./catalogo.ts";
import { comandaTexto } from "./comanda.ts";
import { evaluarComprobante, extraerDatosComprobante, type DatosComprobante } from "./comprobantes.ts";
import { env, soportaFallbacks, type Menu, type Negocio } from "./config.ts";
import { Store, type Conversacion, type Mensaje } from "./db.ts";
import { definicionesHerramientas, ejecutarHerramienta, type ContextoHerramientas, type Efecto } from "./herramientas.ts";
import { pesos } from "./money.ts";
import { calcularTotales, ErrorPedido, type Pedido } from "./order.ts";
import { systemPrompt } from "./prompt.ts";
import { respuestaRapida } from "./rapidas.ts";
import { estaAbierto, estimarEspera, horaLocal } from "./tiempos.ts";
import { avisarIntegracion } from "./integraciones.ts";
import { Semaforo } from "./limites.ts";

/** Compartido por todos los bots del proceso: limita las consultas simultáneas a la IA. */
export const semaforoIA = new Semaforo(env.iaEnParalelo);

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

export interface OpcionesBot {
  store: Store;
  /** menú base (menu.json); los cambios de precio y faltantes del día se aplican encima */
  menu: Menu;
  negocio: Negocio;
  client: Anthropic;
  mensajero: Mensajero;
  reloj?: () => Date;
  /** carpeta para comprobantes de este local */
  dataDir?: string;
  /** ms para juntar mensajes seguidos del cliente en un solo turno (0 = sin espera) */
  esperaRafagaMs?: number;
  /** URL pública para links a comanda/comprobante */
  publicUrl?: string;
  /** carpeta del local en clientes/ (para los links del panel) */
  slug?: string;
}

type PedidoConPendiente = Pedido & { comprobantePendiente?: string };

const HORAS_REINICIO_CONVERSACION = 4;
const MAX_VUELTAS_HERRAMIENTAS = 10;

export class Bot {
  readonly store: Store;
  readonly menuBase: Menu;
  readonly negocio: Negocio;
  readonly mensajero: Mensajero;
  private readonly client: Anthropic;
  private readonly reloj: () => Date;
  private readonly dataDir: string;
  private readonly esperaRafagaMs: number;
  private readonly publicUrl: string;
  private readonly slug: string;
  private readonly tools = definicionesHerramientas();
  private colas = new Map<string, Promise<unknown>>();
  private rafagas = new Map<string, { textos: string[]; timer: NodeJS.Timeout; avisar: (() => void)[] }>();

  constructor(o: OpcionesBot) {
    this.store = o.store;
    this.menuBase = o.menu;
    this.negocio = o.negocio;
    this.client = o.client;
    this.mensajero = o.mensajero;
    this.reloj = o.reloj ?? (() => new Date());
    this.dataDir = o.dataDir ?? env.dataDir;
    this.esperaRafagaMs = o.esperaRafagaMs ?? env.esperaRafagaMs;
    this.publicUrl = o.publicUrl ?? env.publicUrl;
    this.slug = o.slug ?? "local";
    const url = this.negocio.integraciones.webhookPedidos;
    if (url) this.store.alCambiarEstado = (p, anterior) => avisarIntegracion(url, this.slug, this.menu, this.negocio, p, anterior);
  }

  /** Para el apagado prolijo: espera a que terminen los turnos en curso. */
  async terminarPendientes() {
    for (const t of [...this.rafagas.keys()]) void this.soltarRafaga(t);
    await Promise.allSettled([...this.colas.values()]);
  }

  get turnosEnCurso() {
    return this.colas.size;
  }

  /** Menú con los precios y faltantes que el local cargó hoy por WhatsApp. */
  get menu(): Menu {
    return menuVigente(this.menuBase, this.store);
  }

  private abierto(): boolean {
    const manual = this.store.ajuste("abierto_manual");
    return manual === null ? estaAbierto(this.negocio, this.reloj()) : manual === "1";
  }

  /**
   * Punto de entrada. Los textos seguidos ("hola" / "quiero 2 dobles" / "y una coca") se juntan
   * en un solo turno; los turnos de un mismo cliente nunca corren en paralelo.
   */
  recibir(telefono: string, msg: Entrante): Promise<void> {
    if (msg.tipo === "texto" && this.esperaRafagaMs > 0) {
      return new Promise((resolve) => {
        const r = this.rafagas.get(telefono) ?? { textos: [], timer: undefined as unknown as NodeJS.Timeout, avisar: [] };
        clearTimeout(r.timer);
        r.textos.push(msg.texto);
        r.avisar.push(resolve);
        r.timer = setTimeout(() => this.soltarRafaga(telefono), this.esperaRafagaMs);
        this.rafagas.set(telefono, r);
      });
    }
    const previa = this.soltarRafaga(telefono);
    return Promise.all([previa, this.encolar(telefono, msg)]).then(() => {});
  }

  private soltarRafaga(telefono: string): Promise<void> {
    const r = this.rafagas.get(telefono);
    if (!r) return Promise.resolve();
    clearTimeout(r.timer);
    this.rafagas.delete(telefono);
    return this.encolar(telefono, { tipo: "texto", texto: r.textos.join("\n") }).then(() => r.avisar.forEach((f) => f()));
  }

  private encolar(telefono: string, msg: Entrante): Promise<void> {
    const prev = this.colas.get(telefono) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.procesar(telefono, msg))
      .catch(async (e) => {
        console.error(`[bot ${this.negocio.nombre}] error con ${telefono}:`, e);
        await this.mensajero.enviarTexto(telefono, "Uy, se me trabó algo de mi lado 😅 ¿Me lo repetís?").catch(() => {});
      })
      .finally(() => {
        // limpiar la cola si nadie más se encoló detrás (evita que el mapa crezca sin fin)
        if (this.colas.get(telefono) === next) this.colas.delete(telefono);
      });
    this.colas.set(telefono, next);
    return next;
  }

  // ------------------------------------------------------------------

  private async procesar(telefono: string, msg: Entrante) {
    if (msg.tipo === "audio") {
      await this.mensajero.enviarTexto(telefono, "Por ahora no puedo escuchar audios 🙏 ¿Me lo escribís así no se me escapa nada?");
      return;
    }
    const conv = this.conversacionVigente(telefono);
    const pedido = this.store.pedido(conv.pedidoId!)! as PedidoConPendiente;

    if (msg.tipo === "imagen" && ["esperando_pago", "pago_en_revision"].includes(pedido.estado)) {
      await this.procesarComprobante(conv, pedido, msg.datos, msg.mime);
      return;
    }

    if (msg.tipo === "texto") {
      const rapida = respuestaRapida(msg.texto, {
        menu: this.menu,
        negocio: this.negocio,
        pedido,
        primerMensaje: conv.mensajes.length === 0,
        abierto: this.abierto(),
        ahora: this.reloj(),
      });
      if (rapida) {
        for (const t of rapida) await this.mensajero.enviarTexto(telefono, t);
        // Queda en el historial para que la IA tenga el contexto si la charla sigue.
        this.agregarAlHistorial(conv, msg.texto, rapida.join("\n\n"));
        return;
      }
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
            text: `[El cliente compartió su ubicación: ${msg.direccion ?? ""} ${msg.nombre ?? ""} (lat ${msg.lat}, lng ${msg.lng}). Si no dio calle, altura y entre calles, pedíselas.]`,
          },
        ];
        break;
      case "imagen": {
        pedido.comprobantePendiente = this.guardarArchivo(pedido.id!, msg.datos, msg.mime);
        this.store.guardarPedido(pedido);
        contenido = [
          {
            type: "text",
            text: "[El cliente envió una imagen. Si es un comprobante de pago quedó guardado y se verifica solo cuando el pedido se confirme con transferencia.]",
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
    // Conversación nueva: historial vacío y el system prompt vigente hoy, fijo para toda la charla.
    const pedido = this.store.crearPedido(telefono, this.reloj());
    const nueva: Conversacion = {
      telefono,
      system: systemPrompt(this.menuBase, this.negocio),
      mensajes: [],
      pedidoId: pedido.id!,
      actualizadoEn: this.reloj().toISOString(),
    };
    this.store.guardarConversacion(nueva);
    return nueva;
  }

  private async llamarModelo(system: string, mensajes: Mensaje[]) {
    return semaforoIA.usar(() => this.client.beta.messages.create({
      model: env.model,
      max_tokens: 16000,
      ...(soportaFallbacks(env.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: env.effort },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: this.tools,
      messages: mensajes,
    }));
  }

  private async turnoAgente(conv: Conversacion, pedidoInicial: Pedido, contenido: Anthropic.Beta.BetaContentBlockParam[]) {
    // Todo se trabaja en copias: si algo falla a mitad del turno, no se guarda nada a medias.
    const mensajes: Mensaje[] = [...conv.mensajes, { role: "user", content: contenido }];
    const system = conv.system ?? systemPrompt(this.menuBase, this.negocio);
    const menu = this.menu;
    const ctx: ContextoHerramientas = {
      menu,
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
      const res = await this.llamarModelo(system, mensajes);
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
            resultados.push({ type: "tool_result", tool_use_id: u.id, content: ejecutarHerramienta(u.name, u.input, ctx) });
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
    if (!respuesta && !ctx.salida.length) respuesta = "¿Me lo repetís? No llegué a entenderte bien 🙏";

    // ---- commit ----
    pedidosTocados.set(ctx.pedido.id!, ctx.pedido);
    for (const p of pedidosTocados.values()) this.store.guardarPedido(p);
    this.store.guardarConversacion({ ...conv, system, mensajes, pedidoId: ctx.pedido.id!, actualizadoEn: this.reloj().toISOString() });

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
        const p = this.store.pedido(e.pedidoId) as PedidoConPendiente | null;
        if (p?.comprobantePendiente && fs.existsSync(p.comprobantePendiente)) {
          const archivo = p.comprobantePendiente;
          const mime: MediaType = archivo.endsWith(".pdf") ? "application/pdf" : archivo.endsWith(".png") ? "image/png" : "image/jpeg";
          await this.procesarComprobante(this.store.conversacion(telefono)!, p, fs.readFileSync(archivo), mime, archivo);
        }
        break;
      }
    }
  }

  // ------------------------- comprobantes -------------------------

  private guardarArchivo(pedidoId: number, datos: Buffer, mime: MediaType): string {
    const dir = path.join(this.dataDir, "comprobantes");
    fs.mkdirSync(dir, { recursive: true });
    const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1].replace("jpeg", "jpg");
    const f = path.join(dir, `pedido-${pedidoId}-${Date.now()}.${ext}`);
    fs.writeFileSync(f, datos);
    return f;
  }

  private async procesarComprobante(conv: Conversacion, pedido: PedidoConPendiente, datos: Buffer, mime: MediaType, archivoExistente?: string) {
    const archivo = archivoExistente ?? this.guardarArchivo(pedido.id!, datos, mime);
    const total = calcularTotales(this.menu, this.negocio, pedido).total;

    let extraidos: DatosComprobante | null = null;
    try {
      extraidos = await semaforoIA.usar(() => extraerDatosComprobante(this.client, datos, mime));
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

    const linkImagen = this.publicUrl && this.negocio.panel.token ? `\n🖼️ ${this.publicUrl}/comprobante/${this.slug}/${comp.id}?token=${this.negocio.panel.token}` : "";
    let texto = r.mensajeCliente;
    if (r.veredicto === "aprobado") {
      this.pasarACocina(pedido);
      texto += `\n⏱️ ${pedido.entrega?.modo === "delivery" ? "Llega" : "Está listo"} aprox. a las *${horaLocal(new Date(pedido.horaEstimada!), this.negocio.zonaHoraria)}*.`;
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
    if (pedido.pago?.metodo === "transferencia") pedido.pagoVerificado = true;
    pedido.estado = "en_cocina";
    const est = estimarEspera(this.menu, this.negocio, pedido, Math.max(0, this.store.cargaCocina() - 1), Number(this.store.ajuste("demora_extra") ?? 0), this.reloj());
    pedido.minutosEstimados = est.rango;
    pedido.horaEstimada = est.horaEstimada.toISOString();
    this.store.guardarPedido(pedido);
  }

  /** Agrega un intercambio al final del historial (nunca se edita lo anterior). */
  private agregarAlHistorial(conv: Conversacion, textoUsuario: string, textoEnviado: string) {
    const mensajes = [...conv.mensajes];
    if (mensajes.at(-1)?.role === "user") mensajes.push({ role: "assistant", content: "…" });
    mensajes.push({ role: "user", content: textoUsuario }, { role: "assistant", content: textoEnviado });
    this.store.guardarConversacion({ ...conv, mensajes, actualizadoEn: this.reloj().toISOString() });
  }

  /** Deja constancia en el historial del cliente de algo que pasó fuera de la IA (comprobante, aviso del local). */
  registrarEvento(telefono: string, evento: string, textoEnviado: string) {
    const c = this.store.conversacion(telefono);
    if (c) this.agregarAlHistorial(c, evento, textoEnviado);
  }

  // ------------------------- avisos -------------------------

  async enviarComanda(pedidoId: number) {
    const p = this.store.pedido(pedidoId);
    if (!p) return;
    const texto = comandaTexto(this.menu, this.negocio, p);
    const link = this.publicUrl && this.negocio.panel.token ? `\n🖨️ ${this.publicUrl}/comanda/${this.slug}/${p.id}?token=${this.negocio.panel.token}&print=1` : "";
    for (const n of this.negocio.equipo.cocina) await this.mensajero.enviarTexto(n, texto + link).catch((e) => console.error("[comanda]", e));
    console.log(`[${this.negocio.nombre}] comanda #${p.id} enviada a cocina`);
  }

  async avisarStaff(texto: string) {
    for (const n of this.negocio.equipo.encargados) await this.mensajero.enviarTexto(n, texto).catch((e) => console.error("[staff]", e));
    console.log(`[${this.negocio.nombre}] ${texto}`);
  }
}
