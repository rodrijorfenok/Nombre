// Cola de trabajos autónoma. Cada trabajo:
//   1. espera presupuesto (si hay un límite diario y se agotó, queda en pausa);
//   2. ejecuta el agente con la memoria del cliente;
//   3. pasa por control de calidad y, si no aprueba, se corrige solo (hasta MAX_REVISIONES);
//   4. si sigue sin aprobar, o no se puede resolver solo, escala a una persona;
//   5. ante errores transitorios reintenta con espera exponencial, aun tras reiniciar el servidor.
// Todo queda trazado: pasos, tokens, costo, revisiones y motivo de cada decisión.
import { store } from "./store.js";
import { config } from "./config.js";
import { conTraza, presupuestoAgotado } from "./telemetria.js";
import { revisar, tieneRubrica } from "./calidad.js";
import { contextoCliente, completarConCliente, agregarLeccion } from "./memoria.js";
import { auditar } from "./agents/auditor.js";
import { calendario } from "./agents/contenido.js";
import { creativos } from "./agents/creativos.js";
import { reporte } from "./agents/reportes.js";
import { diagnostico } from "./agents/diagnostico.js";
import { calificarLead, seguimientoLead } from "./agents/comercial.js";

export const AGENTES = {
  auditoria: { nombre: "Auditor CRO", run: auditar },
  contenido: { nombre: "Contenido mensual", run: calendario },
  creativos: { nombre: "Creativos de pauta", run: creativos },
  reporte: { nombre: "Reporte semanal", run: reporte },
  diagnostico: { nombre: "Diagnóstico + plan 90 días", run: diagnostico },
  calificacion: { nombre: "Calificación de lead", run: calificarLead, sinRevisorIA: true },
  seguimiento: { nombre: "Seguimiento de lead", run: seguimientoLead, sinRevisorIA: true },
};

const MAX_CONCURRENTES = Number(process.env.MAX_JOBS || 4);
const MAX_POR_CLIENTE = Number(process.env.MAX_JOBS_POR_CLIENTE || 1);
const MAX_REVISIONES = Number(process.env.MAX_REVISIONES || 2);
const MAX_INTENTOS = Number(process.env.MAX_INTENTOS || 4);
const ESPERA_BASE_MS = Number(process.env.ESPERA_REINTENTO_MS || 30000);

// La cola vive en la base de datos (sobrevive reinicios). En memoria solo se lleva
// qué se está ejecutando, para limitar la concurrencia total y por cliente.
const enCurso = new Map(); // jobId -> clienteId
let pausaGlobalHasta = 0;
let despertador = null;

// Prioridad: 1 = lo que toca a un prospecto en vivo, 2 = entregas de clientes, 3 = mantenimiento.
export function prioridadDe(tipo, meta = {}) {
  if (meta.prioridad) return meta.prioridad;
  if (["calificacion", "seguimiento"].includes(tipo) || (tipo === "auditoria" && meta.leadId && !meta.clienteId)) return 1;
  if (meta.origen === "onboarding") return 1;
  if (meta.origen === "agenda" && tipo === "auditoria") return 3;
  return 2;
}

export const ESTADOS_ACTIVOS = ["en_cola", "trabajando", "revisando", "esperando_reintento", "pausado_presupuesto"];

export function crearTrabajo(tipo, input, meta = {}) {
  if (!AGENTES[tipo]) throw new Error(`Agente desconocido: ${tipo}`);
  const job = store.insert("jobs", {
    tipo, agente: AGENTES[tipo].nombre, input, estado: "en_cola", progreso: "", intentos: 0, revisiones: [],
    prioridad: prioridadDe(tipo, meta), ...meta,
  });
  encolar();
  return job;
}

function encolar() {
  setImmediate(procesar);
}

/** Elige el próximo trabajo: mayor prioridad, más antiguo, y de un cliente que no esté ocupado. */
function siguiente() {
  const ocupados = new Map();
  for (const c of enCurso.values()) if (c) ocupados.set(c, (ocupados.get(c) || 0) + 1);
  // Orden de llegada (desempata por orden de inserción) y después prioridad (sort estable).
  const candidatos = store.list("jobs", { where: { estado: "en_cola" }, liviano: true, orden: "asc" })
    .sort((a, b) => (a.prioridad || 2) - (b.prioridad || 2));
  return candidatos.find((j) => !enCurso.has(j.id) && (!j.clienteId || (ocupados.get(j.clienteId) || 0) < MAX_POR_CLIENTE));
}

function procesar() {
  if (Date.now() < pausaGlobalHasta) {
    clearTimeout(despertador);
    despertador = setTimeout(procesar, pausaGlobalHasta - Date.now() + 50);
    despertador.unref?.();
    return;
  }
  while (enCurso.size < MAX_CONCURRENTES) {
    const job = siguiente();
    if (!job) return;
    enCurso.set(job.id, job.clienteId || null);
    store.update("jobs", job.id, { estado: "trabajando" });
    ejecutar(job.id).finally(() => { enCurso.delete(job.id); procesar(); });
  }
}

async function ejecutar(id) {
  const job = store.get("jobs", id);
  if (!job) return;
  if (presupuestoAgotado()) {
    store.update("jobs", id, { estado: "pausado_presupuesto", progreso: "Presupuesto diario agotado: se retoma mañana." });
    return;
  }

  const inicio = Date.now();
  const traza = { pasos: job.traza?.pasos || [], costo_usd: job.costo_usd || 0 };
  const intentos = (job.intentos || 0) + 1;
  store.update("jobs", id, { estado: "trabajando", iniciado: new Date().toISOString(), intentos, error: null });
  const progreso = (texto) => store.update("jobs", id, { progreso: texto });

  try {
    await conTraza(traza, async () => {
      let input = completarConCliente(job.tipo, job.input, job.clienteId);
      const memoria = contextoCliente(job.clienteId);
      if (memoria) input = { ...input, _memoria: memoria };

      const revisiones = [];
      let resultado, veredicto;
      for (let ronda = 0; ronda <= MAX_REVISIONES; ronda++) {
        progreso(ronda ? `Corrigiendo (ronda ${ronda}) según el revisor` : "Generando");
        resultado = await AGENTES[job.tipo].run({ ...input, progreso });
        if (!tieneRubrica(job.tipo)) { veredicto = { aprobado: true, puntaje: null }; break; }

        store.update("jobs", id, { estado: "revisando", progreso: "Control de calidad" });
        veredicto = await revisar(job.tipo, input, resultado, { sinIA: AGENTES[job.tipo].sinRevisorIA });
        revisiones.push({ ronda, aprobado: veredicto.aprobado, puntaje: veredicto.puntaje, problemas_codigo: veredicto.problemas_codigo, criterios: veredicto.criterios, correcciones: veredicto.correcciones });
        if (veredicto.aprobado || veredicto.bloqueante) break;
        input = { ...input, _correcciones: veredicto.correcciones.map((c, i) => `${i + 1}. ${c}`).join("\n") };
        store.update("jobs", id, { estado: "trabajando" });
      }

      const estado = veredicto.aprobado ? "listo" : "requiere_revision";
      store.update("jobs", id, {
        estado, resultado, revisiones, progreso: "",
        calidad: { aprobado: veredicto.aprobado, puntaje: veredicto.puntaje, rondas: revisiones.length, motivo: veredicto.aprobado ? null : veredicto.correcciones.slice(0, 5) },
        segundos: Math.round((Date.now() - inicio) / 1000),
        traza: { pasos: traza.pasos }, costo_usd: traza.costo_usd,
      });
      alTerminar(store.get("jobs", id));
    });
  } catch (err) {
    console.error(`[jobs] ${job.tipo} ${id} (intento ${intentos}):`, err.message);
    const reintentar = err.retryable && intentos < MAX_INTENTOS;
    // Ante un límite de la API, frena toda la cola un rato en lugar de seguir chocando.
    if (err.code === "rate_limit") pausaGlobalHasta = Date.now() + Number(process.env.PAUSA_LIMITE_MS || 60000);
    const espera = ESPERA_BASE_MS * 2 ** (intentos - 1) * (0.8 + Math.random() * 0.4);
    store.update("jobs", id, {
      estado: reintentar ? "esperando_reintento" : "error",
      error: err.message,
      proximoIntento: reintentar ? new Date(Date.now() + espera).toISOString() : null,
      traza: { pasos: traza.pasos }, costo_usd: traza.costo_usd, progreso: "",
    });
    if (!reintentar) avisar({ evento: "requiere_atencion", motivo: "error", trabajo: resumen(store.get("jobs", id)) });
  }
}

/** Efectos de negocio de un trabajo terminado. */
function alTerminar(job) {
  const r = job.resultado;
  if (job.leadId && store.get("leads", job.leadId)) {
    if (job.tipo === "calificacion") {
      const d = r.data;
      store.update("leads", job.leadId, { puntaje: d.puntaje, temperatura: d.temperatura, plan_recomendado: d.plan_recomendado, mensaje_sugerido: d.mensaje_sugerido });
    }
    if (job.tipo === "auditoria") store.update("leads", job.leadId, { auditoria: { jobId: job.id, puntaje: r.data?.puntaje_general } });
    if (job.tipo === "seguimiento") {
      const lead = store.get("leads", job.leadId);
      store.update("leads", job.leadId, { mensaje_seguimiento: r.data.mensaje, seguimientos: (lead.seguimientos || 0) + 1, ultimo_seguimiento: new Date().toISOString() });
    }
  }
  if (job.estado === "listo") avisar({ evento: "entregable_listo", trabajo: resumen(job), markdown: r.markdown });
  else avisar({ evento: "requiere_atencion", motivo: "calidad", trabajo: resumen(job), problemas: job.calidad.motivo });
}

const resumen = (j) => {
  const cliente = j.clienteId && store.get("clientes", j.clienteId);
  return { id: j.id, tipo: j.tipo, estado: j.estado, leadId: j.leadId || null, clienteId: j.clienteId || null, cliente: cliente?.marca || null, responsable: cliente?.responsable || null, puntaje: j.calidad?.puntaje ?? null };
};

/**
 * Feedback humano sobre una entrega. Aprobar la cierra; rechazar lanza una nueva
 * versión con el comentario como corrección. Si el trabajo es de un cliente, el
 * comentario queda como lección para todas las entregas futuras.
 */
export function feedback(id, { decision, comentario = "", guardarLeccion = true }) {
  const job = store.get("jobs", id);
  if (!job) throw new Error("Trabajo no encontrado.");
  if (!["listo", "requiere_revision", "aprobado"].includes(job.estado)) throw new Error("Solo se puede dar feedback sobre entregas terminadas.");
  if (!["aprobar", "rechazar"].includes(decision)) throw new Error("La decisión tiene que ser aprobar o rechazar.");
  if (decision === "rechazar" && !comentario.trim()) throw new Error("Para rechazar, escribí qué hay que cambiar.");

  if (comentario.trim() && guardarLeccion && job.clienteId) agregarLeccion(job.clienteId, `${AGENTES[job.tipo].nombre}: ${comentario}`, job.id);
  if (decision === "aprobar") {
    store.update("jobs", id, { estado: "aprobado", feedback: { decision, comentario } });
    avisar({ evento: "entregable_aprobado", trabajo: resumen(store.get("jobs", id)), markdown: job.resultado?.markdown });
    return { job: store.get("jobs", id) };
  }
  store.update("jobs", id, { estado: "rechazado", feedback: { decision, comentario } });
  const nuevo = crearTrabajo(job.tipo, { ...job.input, _correcciones: `Pedido del equipo: ${comentario}` }, { leadId: job.leadId, clienteId: job.clienteId, versionDe: job.id });
  return { job: store.get("jobs", id), nuevo };
}

export function reintentar(id) {
  const job = store.get("jobs", id);
  if (!job || !["error", "requiere_revision"].includes(job.estado)) return null;
  store.update("jobs", id, { estado: "en_cola", error: null, intentos: 0 });
  encolar();
  return job;
}

/** Retoma lo pendiente: al arrancar el servidor y en cada vuelta de la agenda. */
export function retomarPendientes({ arranque = false } = {}) {
  const ahora = Date.now();
  const estados = ["esperando_reintento", "pausado_presupuesto", ...(arranque ? ["trabajando", "revisando"] : [])];
  for (const job of store.list("jobs", { where: { estado: estados }, liviano: true })) {
    const vencido = job.estado === "esperando_reintento" && new Date(job.proximoIntento).getTime() <= ahora;
    const pausado = job.estado === "pausado_presupuesto" && !presupuestoAgotado();
    const huerfano = arranque && !enCurso.has(job.id);
    if (vencido || pausado || huerfano) store.update("jobs", job.id, { estado: "en_cola" });
  }
  encolar();
}

export async function avisar(payload) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agencia: config.agencia.nombre, fecha: new Date().toISOString(), ...payload }) });
  } catch (err) {
    console.error("[webhook] falló:", err.message);
  }
}

export const estadoCola = () => ({
  activos: enCurso.size,
  en_cola: store.count("jobs", { estado: "en_cola" }),
  pausa_por_limite: pausaGlobalHasta > Date.now() ? new Date(pausaGlobalHasta).toISOString() : null,
});
