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
import { calcularResumen, inicioJornada, textoResumen } from "./reportes.ts";
import { estaAbierto, estimarEspera, horaLocal } from "./tiempos.ts";
import { avisarIntegracion } from "./integraciones.ts";
import { Semaforo } from "./limites.ts";

/** Compartido por todos los bots del proceso: limita las consultas simultáneas a la IA. */
export const semaforoIA = new Semaforo(env.iaEnParalelo);

/**
 * Freno automático: si la IA falla varias veces seguidas (caída del servicio, clave vencida, sin saldo),
 * el bot deja de intentarlo un rato y pasa todas las charlas a una persona, en vez de responder mal.
 */
export const disyuntor = {
  erroresSeguidos: 0,
  abiertoHasta: 0,
  limite: 3,
  pausaMs: 5 * 60_000,
  abierto(ahora = Date.now()) {
    return this.abiertoHasta > ahora;
  },
  exito() {
    this.erroresSeguidos = 0;
  },
  /** devuelve true si este error es el que lo abre */
  falla(ahora = Date.now()) {
    this.erroresSeguidos++;
    if (this.erroresSeguidos >= this.limite && !this.abierto(ahora)) {
      this.abiertoHasta = ahora + this.pausaMs;
      this.erroresSeguidos = 0;
      return true;
    }
    return false;
  },
};

export class ErrorModoSeguro extends Error {}

/** El cliente pide hablar con una persona o se está frustrando: no lo dejamos con el bot. */
export function pideHumano(texto: string): boolean {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /(hablar|comunicar(me)?|comunicas|atender(me)?|pasar(me)?|pasas|pasan|pasame) con (una persona|alguien|un humano|una persona real|el encargado|la encargada|el dueno|la duena)/.test(t) ||
    /\b(quiero|necesito|pasame( con)?) (un|una) (humano|persona)/.test(t) ||
    /^(humano|persona|operador|encargado)\W*$/.test(t) ||
    /no (me )?(entendes|entendiste|entienden) (nada|un carajo|lo que)/.test(t) ||
    /(dejame|basta) de (bot|robot)/.test(t)
  );
}

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
  private readonly negocioBase: Negocio;
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
    this.negocioBase = o.negocio;
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

  /** Datos del local + feriados que el encargado marcó por WhatsApp ("feriado"). */
  get negocio(): Negocio {
    const extra = Object.keys(this.store.ajustesConPrefijo("feriado:"));
    if (!extra.length) return this.negocioBase;
    const f = this.negocioBase.feriados ?? { fechas: [], abre: this.negocioBase.horarios[0]?.abre ?? "20:00", cierra: this.negocioBase.horarios[0]?.cierra ?? "00:00" };
    return { ...this.negocioBase, feriados: { ...f, fechas: [...f.fechas, ...extra] } };
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
        if (!(e instanceof ErrorModoSeguro)) console.error(`[bot ${this.negocio.nombre}] error con ${telefono}:`, e);
        await this.pasarAPersonaPorError(telefono, msg).catch((e2) => console.error("[bot] no se pudo derivar:", e2));
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
    if (msg.tipo === "audio" && !this.enAtencionHumana(telefono)) {
      await this.mensajero.enviarTexto(telefono, "Por ahora no puedo escuchar audios 🙏 ¿Me lo escribís así no se me escapa nada?");
      return;
    }
    const conv = this.conversacionVigente(telefono);
    const pedido = this.store.pedido(conv.pedidoId!)! as PedidoConPendiente;

    if (msg.tipo === "imagen" && ["esperando_pago", "pago_en_revision"].includes(pedido.estado)) {
      await this.procesarComprobante(conv, pedido, msg.datos, msg.mime);
      return;
    }

    if (this.enAtencionHumana(telefono)) {
      await this.reenviarAlLocal(conv, pedido, msg);
      return;
    }

    if (msg.tipo === "texto" && pideHumano(msg.texto)) {
      await this.mensajero.enviarTexto(telefono, "¡Dale! Ya te escribe alguien del local 🙌");
      this.agregarAlHistorial(conv, msg.texto, "¡Dale! Ya te escribe alguien del local 🙌");
      await this.iniciarAtencionHumana(pedido.id!, `el cliente pidió hablar con una persona: "${msg.texto}"`);
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
            text: `[El cliente compartió su ubicación: ${msg.direccion ?? ""} ${msg.nombre ?? ""} (lat ${msg.lat}, lng ${msg.lng}). ${zonaPorUbicacion(this.negocio, msg.lat, msg.lng)} Si no dio calle, altura y entre calles, pedíselas.]`,
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
      case "audio":
        contenido = [{ type: "text", text: "[El cliente envió un audio, que no se puede escuchar. Pedile que lo escriba.]" }];
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
    if (disyuntor.abierto()) throw new ErrorModoSeguro("IA en pausa por errores seguidos");
    try {
      const r = await this.llamarModeloSinFreno(system, mensajes);
      disyuntor.exito();
      return r;
    } catch (e) {
      if (disyuntor.falla()) {
        await this.avisarStaff(
          `⚠️ *El bot entró en modo seguro*: la IA falló ${disyuntor.limite} veces seguidas (${(e as Error).message?.slice(0, 120)}).\nDurante 5 minutos los mensajes de los clientes te llegan a vos para que respondas con *r N mensaje*. Después reintenta solo.`,
        );
      }
      throw e;
    }
  }

  private async llamarModeloSinFreno(system: string, mensajes: Mensaje[]) {
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
    let erroresHerramientas = 0;
    let motivoDerivar: string | null = null;
    for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
      const res = await this.llamarModelo(system, mensajes);
      mensajes.push({ role: "assistant", content: res.content });

      if (res.stop_reason === "refusal") {
        motivoDerivar = "la IA no quiso responder ese mensaje";
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
            erroresHerramientas++;
            resultados.push({ type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true });
          }
          pedidosTocados.set(ctx.pedido.id!, ctx.pedido);
        }
        mensajes.push({ role: "user", content: resultados });
        if (erroresHerramientas >= 4) {
          motivoDerivar = `el bot no logró cargar el pedido (${erroresHerramientas} intentos fallidos)`;
          // cerrar el turno de forma válida: el último mensaje del historial tiene que ser del asistente
          mensajes.push({ role: "assistant", content: "[Derivado a una persona del local por errores al cargar el pedido.]" });
          break;
        }
        continue;
      }
      respuesta = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }
    if (!respuesta && !ctx.salida.length && !motivoDerivar) motivoDerivar = "el bot no supo qué responder";
    if (mensajes.at(-1)?.role === "user") mensajes.push({ role: "assistant", content: "[Sin respuesta del bot.]" });
    if (motivoDerivar) {
      // Freno automático: antes que responder mal, pasa la charla a una persona.
      respuesta = "Para no equivocarme, ya te responde una persona del local 🙌";
      ctx.efectos.push({ tipo: "atencion_humana", pedidoId: ctx.pedido.id!, motivo: `🛑 freno automático: ${motivoDerivar}` });
    }

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
      case "atencion_humana":
        await this.iniciarAtencionHumana(e.pedidoId, e.motivo);
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
    // Pagos parciales anteriores del mismo pedido: este comprobante tiene que cubrir el saldo.
    const pagadoAntes = this.store
      .comprobantesDePedido(pedido.id!)
      .filter((c) => c.veredicto === "parcial")
      .reduce((a, c) => a + (c.monto ?? 0), 0);
    const r = evaluarComprobante(extraidos, {
      total: Math.max(0, total - pagadoAntes),
      pagadoAntes,
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

  // ------------------------- atención humana -------------------------

  /** Apagado general (comando "bot off"): nadie habla con la IA, todo va al local. */
  get apagado(): boolean {
    return this.store.ajuste("bot_apagado") === "1";
  }

  private async pasarAPersonaPorError(telefono: string, msg: Entrante) {
    const conv = this.store.conversacion(telefono);
    const pedidoId = conv?.pedidoId;
    if (!conv || !pedidoId) {
      await this.mensajero.enviarTexto(telefono, "En un momento te responde alguien del local 🙌");
      return;
    }
    const ya = this.enAtencionHumana(telefono);
    if (!ya) {
      await this.mensajero.enviarTexto(telefono, "En un momento te responde alguien del local 🙌");
      await this.iniciarAtencionHumana(pedidoId, disyuntor.abierto() ? "🛑 el bot está en modo seguro (la IA no responde)" : "🛑 el bot tuvo un error técnico");
    }
    const p = this.store.pedido(pedidoId)! as PedidoConPendiente;
    await this.reenviarAlLocal(conv, p, msg);
  }

  enAtencionHumana(telefono: string): boolean {
    if (this.apagado || disyuntor.abierto()) return true;
    const hasta = this.store.ajuste(`humano:${telefono}`);
    return Boolean(hasta && new Date(hasta).getTime() > this.reloj().getTime());
  }

  private extenderAtencionHumana(telefono: string) {
    const min = this.negocio.asistente.minutosAtencionHumana;
    this.store.setAjuste(`humano:${telefono}`, new Date(this.reloj().getTime() + min * 60_000).toISOString());
  }

  /** El bot deja de responderle a este cliente y le pasa la charla al local. */
  async iniciarAtencionHumana(pedidoId: number, motivo: string) {
    const p = this.store.pedido(pedidoId);
    if (!p) return;
    this.extenderAtencionHumana(p.telefono);
    const conv = this.store.conversacion(p.telefono);
    const ultimos = (conv?.mensajes ?? [])
      .filter((m) => m.role === "user" && typeof m.content !== "string")
      .flatMap((m) => (m.content as Anthropic.Beta.BetaContentBlockParam[]).filter((b) => b.type === "text").map((b) => (b as { text: string }).text))
      .filter((t) => !t.startsWith("["))
      .slice(-3);
    const resumen = p.lineas.length ? `\n🛒 ${calcularTotales(this.menu, this.negocio, p).lineas.map((l) => `${l.cantidad}x ${l.nombre}`).join(", ")}` : "";
    await this.avisarStaff(
      `🙋 *Te necesitan* — pedido #${p.id} · ${p.cliente ?? "cliente"} (${p.telefono})\nMotivo: ${motivo}${resumen}` +
        (ultimos.length ? `\nÚltimo que escribió: "${ultimos.join(" / ")}"` : "") +
        `\n\n✍️ Respondele: *r ${p.id} tu mensaje*\n🤖 Para que el bot siga: *bot ${p.id}*\n(si nadie responde en ${this.negocio.asistente.minutosAtencionHumana} min, el bot retoma solo)`,
    );
  }

  /** Mientras atiende una persona, todo lo que manda el cliente se reenvía al local. */
  private async reenviarAlLocal(conv: Conversacion, pedido: PedidoConPendiente, msg: Entrante) {
    let texto: string;
    switch (msg.tipo) {
      case "texto":
        texto = msg.texto;
        break;
      case "ubicacion":
        texto = `📍 ubicación: https://maps.google.com/?q=${msg.lat},${msg.lng} ${msg.direccion ?? ""}`;
        break;
      case "imagen": {
        const f = this.guardarArchivo(pedido.id!, msg.datos, msg.mime);
        texto = `📷 mandó una imagen${msg.caption ? `: ${msg.caption}` : ""} (guardada en ${path.basename(f)})`;
        break;
      }
      case "audio":
        texto = "🎤 mandó un audio (pedile que lo escriba)";
        break;
      default:
        texto = `mandó ${msg.descripcion}`;
    }
    await this.avisarStaff(`💬 #${pedido.id} ${pedido.cliente ?? pedido.telefono}: ${texto}\n↩️ *r ${pedido.id} …*  ·  🤖 *bot ${pedido.id}*`);
    this.agregarAlHistorial(conv, msg.tipo === "texto" ? msg.texto : `[${texto}]`, "[Este mensaje lo está atendiendo una persona del local; el bot no respondió.]");
  }

  /** El local le escribe al cliente a través del bot (comando "r N mensaje"). */
  async responderComoLocal(pedidoId: number, texto: string): Promise<string> {
    const p = this.store.pedido(pedidoId);
    if (!p) throw new Error(`No encuentro el pedido ${pedidoId}.`);
    this.extenderAtencionHumana(p.telefono);
    await this.mensajero.enviarTexto(p.telefono, texto);
    this.registrarEvento(p.telefono, "[Mensaje escrito por una persona del local]", texto);
    return `✅ Enviado a ${p.cliente ?? p.telefono}. Cuando termines: *bot ${p.id}*`;
  }

  /** Devuelve la conversación al bot (comando "bot N"). */
  devolverAlBot(pedidoId: number): string {
    const p = this.store.pedido(pedidoId);
    if (!p) throw new Error(`No encuentro el pedido ${pedidoId}.`);
    this.store.setAjuste(`humano:${p.telefono}`, null);
    const c = this.store.conversacion(p.telefono);
    if (c) this.agregarAlHistorial(c, "[Aviso del local: la persona terminó de atender; el bot vuelve a responder. Seguí con el pedido teniendo en cuenta lo que se habló.]", "Entendido.");
    return `🤖 El bot vuelve a atender a ${p.cliente ?? p.telefono} (pedido #${p.id}).`;
  }

  // ------------------------- reportes -------------------------

  /** Resumen de ventas: `atras` = cuántas jornadas para atrás empieza (0 = la actual), `dias` = cuántas abarca. */
  resumen(atras = 0, dias = 1): string {
    const tz = this.negocio.zonaHoraria;
    const inicioHoy = inicioJornada(this.reloj(), tz);
    const desde = new Date(inicioHoy.getTime() - (atras + dias - 1) * 86_400_000);
    const hasta = new Date(inicioHoy.getTime() - (atras - 1) * 86_400_000);
    const fmt = (d: Date) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "numeric" }).format(d);
    const titulo = dias === 1 ? `${this.negocio.nombre} · ${fmt(desde)}` : `${this.negocio.nombre} · del ${fmt(desde)} al ${fmt(new Date(hasta.getTime() - 86_400_000))}`;
    return textoResumen(titulo, calcularResumen(this.menu, this.negocio, this.store.pedidosEntre(desde.toISOString(), hasta.toISOString())));
  }

  /**
   * Tareas automáticas (el servidor la llama cada 10 minutos): cuando el local ya cerró,
   * le manda a los encargados el resumen de la jornada, una sola vez.
   */
  async tareaPeriodica() {
    const ahora = this.reloj();
    if (this.abierto()) return;
    const inicio = inicioJornada(ahora, this.negocio.zonaHoraria);
    // jornada que terminó: si estamos antes de las 6, la actual (empezó ayer); si no, nada que mandar hasta la noche
    const horasDesdeInicio = (ahora.getTime() - inicio.getTime()) / 3_600_000;
    if (horasDesdeInicio < 14) return; // entre las 06 y las 20 todavía no hubo turno de noche
    const clave = `resumen_enviado:${inicio.toISOString().slice(0, 10)}`;
    if (this.store.ajuste(clave)) return;
    const pedidos = this.store.pedidosEntre(inicio.toISOString(), ahora.toISOString());
    if (!pedidos.some((p) => p.confirmadoEn)) return;
    if (this.store.pedidosActivos().some((p) => ["en_cocina", "listo", "en_camino"].includes(p.estado))) return; // todavía se está entregando
    this.store.setAjuste(clave, ahora.toISOString());
    await this.avisarStaff(`${this.resumen(0, 1)}\n\n¡Buen turno! 🙌 (Escribí *resumen semana* para ver los últimos 7 días)`);
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

/** Distancia del cliente al local en cuadras (línea recta × 1,3 por el recorrido real) y zona que le toca. */
export function zonaPorUbicacion(negocio: Negocio, lat: number, lng: number): string {
  if (!negocio.ubicacion) return "";
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat - negocio.ubicacion.lat);
  const dLng = rad(lng - negocio.ubicacion.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(negocio.ubicacion.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(a)) * 1.3;
  const cuadras = Math.round(km * 10);
  const zona = negocio.delivery.zonas.find((z) => z.hastaCuadras !== undefined && cuadras <= z.hastaCuadras);
  if (zona) return `Está a unas ${cuadras} cuadras del local: corresponde la zona ${zona.id} (${zona.nombre}).`;
  return `Está a unas ${cuadras} cuadras del local: queda FUERA del área de delivery. Ofrecé take away o derivá a una persona.`;
}
