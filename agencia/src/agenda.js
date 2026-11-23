// Agenda autónoma: el "gerente de operaciones" que no duerme. Cada minuto revisa
// qué trabajo corresponde lanzar sin que nadie lo pida. Cada tarea tiene una clave
// única por período, así nunca se duplica aunque el servidor se reinicie.
import { store } from "./store.js";
import { crearTrabajo, retomarPendientes, ESTADOS_ACTIVOS } from "./jobs.js";

const DIA_PLANIFICACION = Number(process.env.DIA_PLANIFICACION || 25); // calendario del mes siguiente
const DIAS_SEGUIMIENTO = Number(process.env.DIAS_SEGUIMIENTO || 3);
const MAX_SEGUIMIENTOS = Number(process.env.MAX_SEGUIMIENTOS || 2);

const mesDe = (fecha) => fecha.toISOString().slice(0, 7);
function mesSiguiente(fecha) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 1));
  return { clave: mesDe(d), nombre: d.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

function yaHecho(clave) {
  return Boolean((store.meta("agenda") || {})[clave]);
}
function marcar(clave, jobId) {
  const a = store.meta("agenda") || {};
  a[clave] = { jobId, fecha: new Date().toISOString() };
  store.setMeta("agenda", a);
}
function lanzarUnaVez(clave, tipo, input, meta) {
  if (yaHecho(clave)) return null;
  const job = crearTrabajo(tipo, input, { ...meta, origen: "agenda" });
  marcar(clave, job.id);
  return job;
}

export function tick(ahora = new Date()) {
  const lanzados = [];
  retomarPendientes();

  // 1. Seguimiento de leads que no avanzaron.
  const limite = ahora.getTime() - DIAS_SEGUIMIENTO * 86400000;
  for (const lead of store.list("leads")) {
    if (!["nuevo", "contactado"].includes(lead.etapa)) continue;
    if ((lead.seguimientos || 0) >= MAX_SEGUIMIENTOS) continue;
    const ultimoMovimiento = new Date(lead.ultimo_seguimiento || lead.actualizado || lead.creado).getTime();
    if (ultimoMovimiento > limite) continue;
    const pendiente = store.find("jobs", (j) => j.leadId === lead.id && j.tipo === "seguimiento" && ESTADOS_ACTIVOS.includes(j.estado));
    if (pendiente) continue;
    const j = lanzarUnaVez(`seguimiento:${lead.id}:${(lead.seguimientos || 0) + 1}`, "seguimiento", lead, { leadId: lead.id });
    if (j) lanzados.push(j);
  }

  // 2. Trabajo recurrente de cada cliente activo.
  for (const c of store.list("clientes").filter((x) => x.activo)) {
    const auto = c.automatizaciones || {};
    if (ahora.getUTCDate() >= DIA_PLANIFICACION) {
      const prox = mesSiguiente(ahora);
      if (auto.contenido && c.rubro) {
        const j = lanzarUnaVez(`contenido:${c.id}:${prox.clave}`, "contenido", { mes: prox.nombre }, { clienteId: c.id });
        if (j) lanzados.push(j);
      }
      if (auto.creativos && c.productos) {
        const j = lanzarUnaVez(`creativos:${c.id}:${prox.clave}`, "creativos", { cantidad: 10 }, { clienteId: c.id });
        if (j) lanzados.push(j);
      }
    }
    if (auto.reauditoria && c.url && ahora.getUTCDate() <= 7) {
      const j = lanzarUnaVez(`auditoria:${c.id}:${mesDe(ahora)}`, "auditoria", {}, { clienteId: c.id });
      if (j) lanzados.push(j);
    }
  }
  return lanzados;
}

let timer = null;
export function iniciarAgenda(ms = Number(process.env.AGENDA_INTERVALO_MS || 60000)) {
  if (timer) return;
  const vuelta = () => { try { tick(); } catch (err) { console.error("[agenda]", err.message); } };
  vuelta();
  timer = setInterval(vuelta, ms);
  timer.unref();
}
