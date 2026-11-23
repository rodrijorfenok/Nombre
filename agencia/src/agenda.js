// Agenda autónoma: el "gerente de operaciones" que no duerme. Cada minuto revisa
// qué trabajo corresponde lanzar sin que nadie lo pida. Cada tarea tiene una clave
// única por período, así nunca se duplica aunque el servidor se reinicie.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { store } from "./store.js";
import { config } from "./config.js";
import { crearTrabajo, retomarPendientes, ESTADOS_ACTIVOS, avisar } from "./jobs.js";
import { entregablesDelPlan } from "./cartera.js";

// Con 20 clientes no conviene lanzar todo el mismo día: cada cliente tiene un día fijo
// dentro de una ventana, calculado a partir de su id (estable y parejo).
const DIA_PLANIFICACION = Number(process.env.DIA_PLANIFICACION || 20); // primer día de la ventana del mes siguiente
const VENTANA_PLANIFICACION = Number(process.env.VENTANA_PLANIFICACION || 6);
const VENTANA_REAUDITORIA = Number(process.env.VENTANA_REAUDITORIA || 10);
const DIAS_SIN_METRICAS = Number(process.env.DIAS_SIN_METRICAS || 8);
const BACKUPS_A_GUARDAR = Number(process.env.BACKUPS_A_GUARDAR || 14);

export function desfase(clienteId, ventana) {
  return crypto.createHash("sha1").update(String(clienteId)).digest()[0] % Math.max(ventana, 1);
}
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
    const pendiente = store.find("jobs", { leadId: lead.id, tipo: "seguimiento", estado: ESTADOS_ACTIVOS });
    if (pendiente) continue;
    const j = lanzarUnaVez(`seguimiento:${lead.id}:${(lead.seguimientos || 0) + 1}`, "seguimiento", lead, { leadId: lead.id });
    if (j) lanzados.push(j);
  }

  // 2. Trabajo recurrente de cada cliente activo.
  for (const c of store.list("clientes").filter((x) => x.activo)) {
    const auto = c.automatizaciones || {};
    const dia = ahora.getUTCDate();
    if (dia >= DIA_PLANIFICACION + desfase(c.id, VENTANA_PLANIFICACION)) {
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
    const diaAuditoria = 1 + desfase(c.id + ":auditoria", VENTANA_REAUDITORIA);
    if (auto.reauditoria && c.url && dia >= diaAuditoria && dia <= diaAuditoria + 7) {
      const j = lanzarUnaVez(`auditoria:${c.id}:${mesDe(ahora)}`, "auditoria", {}, { clienteId: c.id });
      if (j) lanzados.push(j);
    }

    // 3. Reportes: si el plan incluye reportes semanales y no llegan métricas, avisar.
    if (entregablesDelPlan(c.plan).reporte) {
      const ultimo = store.list("jobs", { where: { clienteId: c.id, tipo: "reporte" }, limit: 1, liviano: true })[0];
      const desde = new Date(ultimo?.creado || c.creado).getTime();
      const semana = `${ahora.getUTCFullYear()}-${Math.floor((ahora.getTime() - Date.UTC(ahora.getUTCFullYear(), 0, 1)) / 604800000)}`;
      if (ahora.getTime() - desde > DIAS_SIN_METRICAS * 86400000 && !yaHecho(`sin_metricas:${c.id}:${semana}`)) {
        marcar(`sin_metricas:${c.id}:${semana}`, null);
        store.update("clientes", c.id, { alerta: "Hace más de una semana que no llegan métricas para el reporte." });
        avisar({ evento: "requiere_atencion", motivo: "faltan_metricas", cliente: c.marca, clienteId: c.id, responsable: c.responsable || null });
      }
    }
  }

  // 4. Copia de seguridad diaria de la base.
  const fecha = ahora.toISOString().slice(0, 10);
  if (process.env.BACKUPS !== "0" && !yaHecho(`backup:${fecha}`)) {
    try {
      const dir = path.join(path.dirname(config.dbFile), "backups");
      store.backup(path.join(dir, `escala-${fecha}.db`));
      marcar(`backup:${fecha}`, null);
      const viejos = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort().slice(0, -BACKUPS_A_GUARDAR);
      for (const f of viejos) fs.unlinkSync(path.join(dir, f));
    } catch (err) {
      console.error("[agenda] backup falló:", err.message);
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
