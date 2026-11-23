// Cola de trabajos en segundo plano. Cada trabajo ejecuta un agente, guarda el
// resultado y avisa por webhook. Concurrencia limitada para cuidar costos y límites.
import { store } from "./store.js";
import { config } from "./config.js";
import { auditar } from "./agents/auditor.js";
import { calendario } from "./agents/contenido.js";
import { creativos } from "./agents/creativos.js";
import { reporte } from "./agents/reportes.js";
import { diagnostico } from "./agents/diagnostico.js";
import { calificarLead } from "./agents/comercial.js";

export const AGENTES = {
  auditoria: { nombre: "Auditor CRO", run: auditar },
  contenido: { nombre: "Contenido mensual", run: calendario },
  creativos: { nombre: "Creativos de pauta", run: creativos },
  reporte: { nombre: "Reporte semanal", run: reporte },
  diagnostico: { nombre: "Diagnóstico + plan 90 días", run: diagnostico },
  calificacion: { nombre: "Calificación de lead", run: calificarLead },
};

const MAX_CONCURRENTES = Number(process.env.MAX_JOBS || 2);
const cola = [];
let activos = 0;

export function crearTrabajo(tipo, input, meta = {}) {
  if (!AGENTES[tipo]) throw new Error(`Agente desconocido: ${tipo}`);
  const job = store.insert("jobs", { tipo, agente: AGENTES[tipo].nombre, input, estado: "en_cola", progreso: "", ...meta });
  cola.push(job.id);
  setImmediate(procesar);
  return job;
}

function procesar() {
  while (activos < MAX_CONCURRENTES && cola.length) {
    const id = cola.shift();
    activos++;
    ejecutar(id).finally(() => { activos--; procesar(); });
  }
}

async function ejecutar(id) {
  const job = store.get("jobs", id);
  if (!job) return;
  const inicio = Date.now();
  store.update("jobs", id, { estado: "trabajando", iniciado: new Date().toISOString() });
  try {
    const progreso = (texto) => store.update("jobs", id, { progreso: texto });
    const resultado = await AGENTES[job.tipo].run({ ...job.input, progreso });
    store.update("jobs", id, { estado: "listo", resultado, progreso: "", segundos: Math.round((Date.now() - inicio) / 1000) });
    if (job.leadId) vincularConLead(job, resultado);
    avisar({ evento: "trabajo_listo", trabajo: { id, tipo: job.tipo, leadId: job.leadId || null } });
  } catch (err) {
    console.error(`[jobs] ${job.tipo} ${id}:`, err.message);
    store.update("jobs", id, { estado: "error", error: err.message, reintentable: Boolean(err.retryable) });
  }
}

function vincularConLead(job, resultado) {
  const lead = store.get("leads", job.leadId);
  if (!lead) return;
  if (job.tipo === "calificacion") {
    const d = resultado.data;
    store.update("leads", lead.id, { puntaje: d.puntaje, temperatura: d.temperatura, plan_recomendado: d.plan_recomendado, mensaje_sugerido: d.mensaje_sugerido });
  }
  if (job.tipo === "auditoria") {
    store.update("leads", lead.id, { auditoria: { jobId: job.id, puntaje: resultado.data?.puntaje_general } });
  }
}

export function reintentar(id) {
  const job = store.get("jobs", id);
  if (!job || job.estado !== "error") return null;
  store.update("jobs", id, { estado: "en_cola", error: null });
  cola.push(id);
  setImmediate(procesar);
  return job;
}

/** Al reiniciar el servidor, los trabajos que quedaron a medias vuelven a la cola. */
export function recuperarPendientes() {
  for (const job of store.list("jobs")) {
    if (job.estado === "en_cola" || job.estado === "trabajando") {
      store.update("jobs", job.id, { estado: "en_cola" });
      cola.push(job.id);
    }
  }
  setImmediate(procesar);
}

export async function avisar(payload) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agencia: config.agencia.nombre, ...payload }) });
  } catch (err) {
    console.error("[webhook] falló:", err.message);
  }
}

export const estadoCola = () => ({ activos, en_cola: cola.length });
