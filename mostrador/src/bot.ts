import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { menuVigente } from "./catalogo.ts";
import { comandaTexto, type InfoComanda } from "./comanda.ts";
import { evaluarComprobante, extraerDatosComprobante, type DatosComprobante } from "./comprobantes.ts";
import { env, soportaFallbacks, type Menu, type Negocio } from "./config.ts";
import { Store, type Conversacion, type Mensaje } from "./db.ts";
import { definicionesHerramientas, ejecutarHerramienta, type ContextoHerramientas, type Efecto } from "./herramientas.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, ErrorPedido, horaObjetivoCocina, type Agregado, type Pedido } from "./order.ts";
import { systemPrompt } from "./prompt.ts";
import { respuestaRapida } from "./rapidas.ts";
import { normalizar } from "./money.ts";
import { calcularResumen, inicioJornada, textoResumen } from "./reportes.ts";
import { estaAbierto, estimarEspera, horaLocal } from "./tiempos.ts";
import { avisarIntegracion } from "./integraciones.ts";
import { fichaCliente, pedidoConcretado, textoFicha } from "./clientes.ts";
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
/** Un pedido que sigue abierto tantas horas después de su hora prometida se cierra solo. */
const HORAS_CIERRE_AUTOMATICO = 10;
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

  /** Hora actual según el reloj del bot (en los tests se puede adelantar). */
  ahora(): Date {
    return this.reloj();
  }

  abierto(): boolean {
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
    if (msg.tipo === "texto" && !this.enAtencionHumana(telefono) && (await this.calificacion(telefono, msg.texto))) return;
    const conv = this.conversacionVigente(telefono);
    const pedido = this.store.pedido(conv.pedidoId!)! as PedidoConPendiente;

    const esperaPago = ["esperando_pago", "pago_en_revision"].includes(pedido.estado) || cuentas(this.menu, this.negocio, pedido).agregadosPorTransferir.length > 0;
    if (msg.tipo === "imagen" && esperaPago) {
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
    // Si el cliente ya compró, la ficha (nombre, última dirección y último pedido) va aparte, también fija.
    const pedido = this.store.crearPedido(telefono, this.reloj());
    const ficha = fichaCliente(this.store, telefono, pedido.id);
    if (ficha.nombre) {
      pedido.cliente = ficha.nombre;
      this.store.guardarPedido(pedido);
    }
    const nueva: Conversacion = {
      telefono,
      system: systemPrompt(this.menuBase, this.negocio),
      mensajes: [],
      pedidoId: pedido.id!,
      actualizadoEn: this.reloj().toISOString(),
      ficha: textoFicha(this.menu, this.negocio, ficha),
    };
    this.store.guardarConversacion(nueva);
    return nueva;
  }

  private async llamarModelo(system: string, mensajes: Mensaje[], ficha?: string) {
    if (disyuntor.abierto()) throw new ErrorModoSeguro("IA en pausa por errores seguidos");
    try {
      const r = await this.llamarModeloSinFreno(system, mensajes, ficha);
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

  private async llamarModeloSinFreno(system: string, mensajes: Mensaje[], ficha?: string) {
    return semaforoIA.usar(() => this.client.beta.messages.create({
      model: env.model,
      max_tokens: 16000,
      ...(soportaFallbacks(env.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: env.effort },
      cache_control: { type: "ephemeral" },
      // El system prompt es igual para todos los clientes (queda en caché); la ficha va después.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }, ...(ficha ? [{ type: "text" as const, text: ficha }] : [])],
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
      cargaCocina: () => this.store.cargaCocina(this.reloj()),
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
      pedidoAnterior: () => this.store.pedidosDeTelefono(conv.telefono, 30).find((p) => p.id !== ctx.pedido.id && pedidoConcretado(p)) ?? null,
      ahora: this.reloj,
      salida: [],
      efectos: [],
    };
    const pedidosTocados = new Map<number, Pedido>();

    let respuesta = "";
    let erroresHerramientas = 0;
    let motivoDerivar: string | null = null;
    for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
      const res = await this.llamarModelo(system, mensajes, conv.ficha);
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
        await this.enviarComanda(e.pedidoId, e.tanda);
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
    const c = cuentas(this.menu, this.negocio, pedido);
    // Qué se está pagando: el pedido (o su parte por transferencia, si es mixto) o un agregado sumado en cocina.
    const delPedido = ["esperando_pago", "pago_en_revision"].includes(pedido.estado);
    const agregado: Agregado | undefined = delPedido ? undefined : c.agregadosPorTransferir[0];
    const total = agregado ? agregado.monto : c.transferenciaBase;

    let extraidos: DatosComprobante | null = null;
    try {
      extraidos = await semaforoIA.usar(() => extraerDatosComprobante(this.client, datos, mime));
    } catch (e) {
      console.error("[comprobante] error leyendo imagen", e);
    }
    const duplicado = extraidos?.numero_operacion ? this.store.operacionYaUsada(extraidos.numero_operacion, pedido.id) : null;
    // Pagos parciales anteriores del mismo pedido: este comprobante tiene que cubrir el saldo.
    const pagadoAntes = agregado
      ? (agregado.pagadoParcial ?? 0)
      : this.store
          .comprobantesDePedido(pedido.id!)
          .filter((x) => x.veredicto === "parcial" && !x.motivos.some((m) => m.startsWith("agregado")))
          .reduce((a, x) => a + (x.monto ?? 0), 0);
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
      motivos: agregado ? [`agregado ${agregado.tanda}`, ...r.motivos] : r.motivos,
      datos: extraidos,
    });
    pedido.comprobantePendiente = undefined;

    if (agregado) {
      await this.comprobanteDeAgregado(conv, pedido, agregado, r, extraidos, comp.id, total);
      return;
    }

    const linkImagen = this.publicUrl && this.negocio.panel.token ? `\n🖼️ ${this.publicUrl}/comprobante/${this.slug}/${comp.id}?token=${this.negocio.panel.token}` : "";
    let texto = r.mensajeCliente;
    if (r.veredicto === "aprobado") {
      this.pasarACocina(pedido);
      texto += pedido.programadoPara
        ? `\n🕘 Queda programado para las *${horaLocal(new Date(pedido.horaEstimada!), this.negocio.zonaHoraria)}*.`
        : `\n⏱️ ${pedido.entrega?.modo === "delivery" ? "Llega" : "Está listo"} aprox. a las *${horaLocal(new Date(pedido.horaEstimada!), this.negocio.zonaHoraria)}*.`;
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

  /** Comprobante por lo que se sumó a un pedido que ya estaba en cocina. */
  private async comprobanteDeAgregado(
    conv: Conversacion,
    pedido: Pedido,
    agregado: Agregado,
    r: ReturnType<typeof evaluarComprobante>,
    extraidos: DatosComprobante | null,
    comprobanteId: number,
    monto: number,
  ) {
    const ag = pedido.agregados!.find((x) => x.tanda === agregado.tanda)!;
    let texto = r.mensajeCliente;
    if (r.veredicto === "aprobado") {
      ag.pagado = true;
      texto = `✅ ¡Recibí el pago de lo que sumaste! Sale todo junto con tu pedido #${pedido.id}.`;
    } else if (r.veredicto === "parcial") {
      ag.pagadoParcial = (ag.pagadoParcial ?? 0) + (extraidos?.monto ?? 0);
    } else if (r.veredicto === "revisar") {
      const link = this.publicUrl && this.negocio.panel.token ? `\n🖼️ ${this.publicUrl}/comprobante/${this.slug}/${comprobanteId}?token=${this.negocio.panel.token}` : "";
      await this.avisarStaff(
        `🔎 Revisar comprobante del agregado al pedido #${pedido.id} (${pedido.cliente ?? pedido.telefono}) por ${pesos(monto)}.\nMotivos: ${r.motivos.join("; ")}${link}\nRespondé *pago ok ${pedido.id}* o *pago no ${pedido.id} <motivo>*.`,
      );
    }
    this.store.guardarPedido(pedido);
    await this.mensajero.enviarTexto(conv.telefono, texto);
    if (ag.pagado && !ag.comandaEnviada) await this.enviarComanda(pedido.id!, ag.tanda);
    this.registrarEvento(conv.telefono, `[El cliente envió el comprobante de lo que sumó al pedido. Verificación automática: ${r.veredicto} (${r.motivos.join("; ")}).]`, texto);
  }

  /** El local aprueba a mano los agregados pagados por transferencia (comando "pago ok N" con el pedido en cocina). */
  async aprobarAgregados(pedido: Pedido): Promise<number> {
    const pendientes = cuentas(this.menu, this.negocio, pedido).agregadosPorTransferir;
    for (const a of pendientes) pedido.agregados!.find((x) => x.tanda === a.tanda)!.pagado = true;
    this.store.guardarPedido(pedido);
    for (const a of pendientes) if (!a.comandaEnviada) await this.enviarComanda(pedido.id!, a.tanda);
    return pendientes.length;
  }

  /** Recalcula el tiempo desde ahora (el pago puede llegar tarde) y marca en cocina. */
  pasarACocina(pedido: Pedido) {
    if (pedido.pago?.metodo === "transferencia" || pedido.pago?.metodo === "mixto") pedido.pagoVerificado = true;
    pedido.estado = "en_cocina";
    pedido.enCocinaDesde = this.reloj().toISOString();
    const est = estimarEspera(this.menu, this.negocio, pedido, Math.max(0, this.store.cargaCocina(this.reloj()) - 1), Number(this.store.ajuste("demora_extra") ?? 0), this.reloj());
    pedido.minutosEstimados = est.rango;
    const programado = pedido.programadoPara ? new Date(pedido.programadoPara) : null;
    pedido.horaEstimada = (programado && programado > est.horaEstimada ? programado : est.horaEstimada).toISOString();
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
    const recurrente = (p: Pedido) => this.store.pedidosDeTelefono(p.telefono, 30).some((x) => x.id! < p.id! && pedidoConcretado(x));
    return textoResumen(titulo, calcularResumen(this.menu, this.negocio, this.store.pedidosEntre(desde.toISOString(), hasta.toISOString()), recurrente));
  }

  /**
   * Tareas automáticas (el servidor la llama cada minuto): recordatorios de pago, alertas de atraso,
   * cierre de pedidos que quedaron abiertos de días anteriores y, cuando el local ya cerró,
   * el resumen de la jornada a los encargados (una sola vez).
   */
  async tareaPeriodica() {
    await this.tareasDelTurno().catch((e) => console.error(`[tareas ${this.negocio.nombre}]`, e));
    await this.resumenAlCerrar();
  }

  private async tareasDelTurno() {
    const ahora = this.reloj();
    const { menu, negocio } = this;
    const abierto = this.abierto();
    const cerrados: string[] = [];
    for (const p of this.store.pedidosActivos()) {
      const confirmado = new Date(p.confirmadoEn ?? p.creadoEn).getTime();
      const referencia = Math.max(confirmado, p.horaEstimada ? new Date(p.horaEstimada).getTime() : 0);
      const minutos = (ahora.getTime() - confirmado) / 60_000;

      // 1. Quedó abierto de un turno anterior (nadie lo marcó entregado o el pago nunca llegó): se cierra solo.
      if (ahora.getTime() - referencia > HORAS_CIERRE_AUTOMATICO * 3_600_000) {
        const sinPago = p.estado === "esperando_pago" || p.estado === "pago_en_revision";
        p.estado = sinPago ? "cancelado" : "entregado";
        p.cerradoAutomatico = true;
        this.store.guardarPedido(p);
        cerrados.push(`#${p.id} ${p.cliente ?? p.telefono} → ${sinPago ? "cancelado (nunca se pagó)" : "entregado"}`);
        continue;
      }
      p.avisos ??= {};

      // 2. Confirmó por transferencia y no mandó el comprobante: un recordatorio al cliente y, más tarde, aviso al local.
      const rec = negocio.pago.minutosRecordatorioPago;
      if (p.estado === "esperando_pago" && abierto && rec > 0 && !this.store.comprobantesDePedido(p.id!).length) {
        if (!p.avisos.recordatorioPago && minutos >= rec && minutos < 90) {
          p.avisos.recordatorioPago = ahora.toISOString();
          this.store.guardarPedido(p);
          const c = cuentas(menu, negocio, p);
          const texto = `👋 ¿Pudiste hacer la transferencia de *${pesos(c.transferenciaBase)}*? Cuando la tengas, mandame la captura del comprobante y lo paso a cocina.\nAlias: *${negocio.pago.alias}* (${negocio.pago.titular})${negocio.pago.aceptaEfectivo && p.pago?.metodo === "transferencia" ? "\nSi preferís pagar en efectivo, avisame y lo cambio." : ""}`;
          await this.mensajero.enviarTexto(p.telefono, texto);
          this.registrarEvento(p.telefono, `[Recordatorio automático: el pedido #${p.id} sigue esperando el comprobante.]`, texto);
        } else if (
          p.avisos.recordatorioPago &&
          !p.avisos.sinPago &&
          minutos >= rec * 3 &&
          minutos < 120 &&
          ahora.getTime() - new Date(p.avisos.recordatorioPago).getTime() >= 15 * 60_000
        ) {
          p.avisos.sinPago = ahora.toISOString();
          this.store.guardarPedido(p);
          await this.avisarStaff(
            `⏳ El pedido #${p.id} (${p.cliente ?? p.telefono}, ${pesos(cuentas(menu, negocio, p).transferenciaBase)}) lleva ${Math.round(minutos)} min confirmado sin comprobante. Si no aparece: *cancelar ${p.id}*. Para escribirle: *r ${p.id} mensaje*.`,
          );
        }
      }

      // 3. La cocina se pasó de la hora: aviso al encargado (una vez) para que le avise al cliente.
      const objetivo = horaObjetivoCocina(negocio, p);
      if (p.estado === "en_cocina" && objetivo && !p.avisos.atraso && ahora.getTime() > objetivo.getTime() + 5 * 60_000) {
        p.avisos.atraso = ahora.toISOString();
        this.store.guardarPedido(p);
        await this.avisarStaff(
          `⏰ El pedido #${p.id} (${p.cliente ?? p.telefono}) está atrasado: tenía que estar listo a las ${horaLocal(objetivo, negocio.zonaHoraria)}. Si va a tardar, avisale al cliente con *demorado ${p.id} 10* (suma 10 min y le pide disculpas).`,
        );
      }
    }
    if (cerrados.length) await this.avisarStaff(`🧹 Cerré ${cerrados.length === 1 ? "un pedido que quedó abierto" : `${cerrados.length} pedidos que quedaron abiertos`} de un turno anterior:\n${cerrados.join("\n")}`);
  }

  /** Nota del 1 al 5 que manda el cliente después de recibir el pedido. true = el mensaje era eso. */
  private async calificacion(telefono: string, texto: string): Promise<boolean> {
    const crudo = texto.trim();
    const estrellas = /^(⭐|🌟|★){1,5}$/u.test(crudo) ? [...crudo].length : 0;
    const m = normalizar(crudo).match(/^(?:(?:le |te )?(?:doy|pongo) )?(?:un |una )?([1-5])(?: (?:5|de 5|estrellas?|puntos?))?$/);
    const nota = estrellas || (m ? Number(m[1]) : 0);
    if (!nota) return false;
    const p = this.store.pedidosDeTelefono(telefono, 1)[0];
    const pedida = p?.avisos?.pedidoCalificacion;
    if (!p || p.estado !== "entregado" || p.calificacion || !pedida) return false;
    if (this.reloj().getTime() - new Date(pedida).getTime() > 24 * 3_600_000) return false;
    p.calificacion = { nota, en: this.reloj().toISOString() };
    this.store.guardarPedido(p);
    if (nota >= 4) {
      await this.mensajero.enviarTexto(telefono, nota === 5 ? "¡Gracias por el 5! 🙌 Nos alegra un montón. ¡Te esperamos la próxima!" : "¡Gracias por la nota! 🙌 ¡Te esperamos la próxima!");
      return true;
    }
    await this.mensajero.enviarTexto(telefono, "Gracias por contarnos 🙏 Nos importa que salga bien. ¿Qué fue lo que no te gustó? Ya te lee alguien del local.");
    await this.iniciarAtencionHumana(p.id!, `el cliente calificó el pedido con ${nota}/5`);
    return true;
  }

  private async resumenAlCerrar() {
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

  /** Manda a cocina la comanda del pedido, o solo la de un agregado (tanda) sumado después. */
  async enviarComanda(pedidoId: number, tanda?: number) {
    const p = this.store.pedido(pedidoId);
    if (!p) return;
    if (tanda) {
      const ag = p.agregados?.find((a) => a.tanda === tanda);
      if (!ag) return;
      ag.comandaEnviada = true;
      this.store.guardarPedido(p);
    }
    const texto = comandaTexto(this.menu, this.negocio, p, tanda, this.infoComanda(p));
    const link =
      this.publicUrl && this.negocio.panel.token
        ? `\n🖨️ ${this.publicUrl}/comanda/${this.slug}/${p.id}?token=${this.negocio.panel.token}${tanda ? `&tanda=${tanda}` : ""}&print=1`
        : "";
    for (const n of this.negocio.equipo.cocina) await this.mensajero.enviarTexto(n, texto + link).catch((e) => console.error("[comanda]", e));
    if (tanda) await this.avisarStaff(`➕ El cliente del pedido #${p.id} sumó productos (agregado ${tanda}). Ya está en la comanda.`);
    console.log(`[${this.negocio.nombre}] comanda #${p.id}${tanda ? ` (agregado ${tanda})` : ""} enviada a cocina`);
  }

  /** Lo que la comanda cuenta del cliente: si es la primera vez o ya es habitual. */
  infoComanda(p: Pedido): InfoComanda {
    return { pedidosPrevios: fichaCliente(this.store, p.telefono, p.id).pedidos };
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
