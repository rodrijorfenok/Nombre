// Pruebas de la operación autónoma: control de calidad, feedback y memoria,
// puesta en marcha de clientes, ingesta, agenda, presupuesto y reintentos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.ESCALA_MOCK = "1";
process.env.ADMIN_TOKEN = "secreto-test";
process.env.INGESTA_TOKEN = "ingesta-test";
process.env.ESPERA_REINTENTO_MS = "20";
process.env.DATA_FILE = path.join(os.tmpdir(), `escala-auto-${process.pid}.json`);

let base, store, tick, retomar;
const admin = { "x-admin-token": "secreto-test", "content-type": "application/json" };
const get = async (p) => (await fetch(base + p, { headers: admin })).json();
const post = async (p, body, h = admin) => { const r = await fetch(base + p, { method: "POST", headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const patch = async (p, body) => (await fetch(base + p, { method: "PATCH", headers: admin, body: JSON.stringify(body) })).json();
const FINALES = ["listo", "requiere_revision", "error", "aprobado", "rechazado", "pausado_presupuesto"];

async function esperar(id, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const j = await get(`/api/admin/jobs/${id}`);
    if (FINALES.includes(j.estado)) return j;
    if (j.estado === "esperando_reintento") retomar();
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timeout esperando ${id}`);
}

before(async () => {
  const { app } = await import("../server.js");
  ({ store } = await import("../src/store.js"));
  ({ tick } = await import("../src/agenda.js"));
  ({ retomarPendientes: retomar } = await import("../src/jobs.js"));
  await new Promise((r) => { const s = app.listen(0, () => { base = `http://127.0.0.1:${s.address().port}`; r(); }); s.unref(); });
});

test("calidad: aprueba a la primera y deja la traza", async () => {
  const { body } = await post("/api/admin/jobs", { tipo: "creativos", input: { producto: "Mate térmico", cantidad: 5 } });
  const j = await esperar(body.id);
  assert.equal(j.estado, "listo");
  assert.equal(j.calidad.aprobado, true);
  assert.equal(j.calidad.rondas, 1);
  assert.ok(j.traza.pasos.length >= 2, "registra el paso del generador y del revisor");
  assert.ok(j.traza.pasos.some((p) => p.agente === "revisor"));
});

test("calidad: si el revisor rechaza, el agente se corrige solo", async () => {
  const { body } = await post("/api/admin/jobs", { tipo: "auditoria", input: { url: "https://tienda.com", contexto: "FORZAR_REVISION" } });
  const j = await esperar(body.id);
  assert.equal(j.estado, "listo");
  assert.equal(j.calidad.rondas, 2);
  assert.equal(j.revisiones[0].aprobado, false);
  assert.match(j.resultado.markdown, /\(corregido\)/);
});

test("calidad: detecta números inventados en un reporte", async () => {
  const { revisar } = await import("../src/calidad.js");
  const md = "## Resumen\nx\n## Números clave\n| Métrica | Esta semana | Anterior | Var |\n|---|---|---|---|\n| Ventas | 84 | 90 | -7% |\n## Plan\n- y";
  const v = await revisar("reporte", { cliente: "x", metricas: "ventas,84,71" }, { markdown: md });
  assert.equal(v.aprobado, false);
  assert.match(v.problemas_codigo[0], /90/);
});

test("calidad: exige evidencia en la auditoría", async () => {
  const { revisar } = await import("../src/calidad.js");
  const { CHECKLIST_CRO } = await import("../src/agents/conocimiento.js");
  const data = { sitio_accesible: true, puntaje_general: 50, resumen: "", plan_recomendado: "Growth 360",
    checklist: CHECKLIST_CRO.map((punto) => ({ punto, estado: "ok", observacion: "", evidencia: "" })),
    mejoras_top: Array.from({ length: 10 }, () => ({ titulo: "t", impacto: "alto", esfuerzo: "bajo", detalle: "d" })) };
  const v = await revisar("auditoria", {}, { data, markdown: "x" });
  assert.equal(v.aprobado, false);
  assert.match(v.problemas_codigo[0], /no evidencia/);
});

test("reintentos: un corte transitorio se reintenta solo", async () => {
  const { body } = await post("/api/admin/jobs", { tipo: "reporte", input: { cliente: "X", metricas: "ventas,84,71", objetivos: "FALLA_TRANSITORIA" } });
  const j = await esperar(body.id);
  assert.equal(j.estado, "listo");
  assert.equal(j.intentos, 2);
});

test("cliente: al pasar un lead a cliente se crea su ficha y arranca el diagnóstico", async () => {
  const lead = store.insert("leads", { nombre: "Lu", contacto: "lu@x.com", marca: "Lu Deco", link: "https://ludeco.com", etapa: "propuesta" });
  const r = await patch(`/api/admin/leads/${lead.id}`, { etapa: "cliente" });
  assert.ok(r.cliente?.id);
  const { trabajos } = await get("/api/admin/jobs");
  const diag = trabajos.find((j) => j.clienteId === r.cliente.id && j.tipo === "diagnostico");
  assert.ok(diag, "lanza el diagnóstico");
  const j = await esperar(diag.id);
  assert.equal(j.estado, "listo");
  assert.equal(j.input.marca ?? "", "", "el pedido guarda lo que se pidió; el brief se completa al ejecutar");
});

test("feedback: rechazar crea una versión nueva y guarda la lección en la memoria del cliente", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Mila Kids", rubro: "Ropa infantil", productos: "Bodies de algodón" })).body;
  const { body } = await post("/api/admin/jobs", { tipo: "creativos", input: { cantidad: 4 }, clienteId: c.id });
  await esperar(body.id);
  const fb = await post(`/api/admin/jobs/${body.id}/feedback`, { decision: "rechazar", comentario: "Nunca usar la palabra barato; la marca es premium." });
  assert.equal(fb.status, 200);
  assert.equal(fb.body.trabajo.estado, "rechazado");
  const nuevo = await esperar(fb.body.nuevo.id);
  assert.equal(nuevo.versionDe, body.id);
  assert.match(nuevo.input._correcciones, /barato/);
  const cliente = (await get("/api/admin/clientes")).find((x) => x.id === c.id);
  assert.match(cliente.lecciones[0].texto, /barato/);
  const { contextoCliente } = await import("../src/memoria.js");
  assert.match(contextoCliente(c.id), /premium/);
  const ok = await post(`/api/admin/jobs/${nuevo.id}/feedback`, { decision: "aprobar" });
  assert.equal(ok.body.trabajo.estado, "aprobado");
});

test("feedback: rechazar sin comentario no se permite", async () => {
  const { body } = await post("/api/admin/jobs", { tipo: "creativos", input: { producto: "Taza" } });
  await esperar(body.id);
  const fb = await post(`/api/admin/jobs/${body.id}/feedback`, { decision: "rechazar" });
  assert.equal(fb.status, 400);
});

test("ingesta: con token, las métricas generan el reporte del cliente", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Bruma", rubro: "Cosmética", objetivo: "Subir recompra" })).body;
  assert.equal((await post("/api/ingesta/metricas", { clienteId: c.id, metricas: "x" }, { "content-type": "application/json" })).status, 401);
  const r = await post("/api/ingesta/metricas", { clienteId: c.id, periodo: "semana 47", metricas: "ventas,84,71" }, { "x-ingesta-token": "ingesta-test", "content-type": "application/json" });
  assert.equal(r.status, 201);
  const j = await esperar(r.body.trabajo);
  assert.equal(j.estado, "listo");
});

test("agenda: planifica el mes siguiente de cada cliente una sola vez", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Nube", rubro: "Deco", productos: "Velas", url: "https://nube.com" })).body;
  const dia26 = new Date(Date.UTC(2026, 10, 26, 12));
  const primera = tick(dia26).filter((j) => j.clienteId === c.id).map((j) => j.tipo).sort();
  assert.deepEqual(primera, ["contenido", "creativos"]);
  assert.equal(tick(dia26).filter((j) => j.clienteId === c.id).length, 0, "no duplica");
  const dia3 = new Date(Date.UTC(2026, 11, 3, 12));
  assert.deepEqual(tick(dia3).filter((j) => j.clienteId === c.id).map((j) => j.tipo), ["auditoria"]);
});

test("agenda: hace seguimiento de leads quietos", async () => {
  const viejo = new Date(Date.now() - 5 * 86400000).toISOString();
  const lead = store.insert("leads", { nombre: "Quieto", contacto: "q@x.com", etapa: "nuevo", creado: viejo });
  const lanzados = tick().filter((j) => j.leadId === lead.id);
  assert.equal(lanzados[0]?.tipo, "seguimiento");
  await esperar(lanzados[0].id);
  const actualizado = store.get("leads", lead.id);
  assert.equal(actualizado.seguimientos, 1);
  assert.ok(actualizado.mensaje_seguimiento);
});

test("presupuesto: si se agota, los trabajos se pausan y se retoman", async () => {
  process.env.PRESUPUESTO_DIARIO_USD = "0.5";
  const g = store.meta("gastos") || {};
  const hoy = new Date().toISOString().slice(0, 10);
  store.setMeta("gastos", { ...g, [hoy]: 1 });
  const { body } = await post("/api/admin/jobs", { tipo: "creativos", input: { producto: "Termo" } });
  const j = await esperar(body.id);
  assert.equal(j.estado, "pausado_presupuesto");
  process.env.PRESUPUESTO_DIARIO_USD = "100";
  retomar();
  assert.equal((await esperar(body.id)).estado, "listo");
  delete process.env.PRESUPUESTO_DIARIO_USD;
});

test("chat: deriva a una persona y lo marca en el CRM", async () => {
  const r = (await post("/api/chat", { mensaje: "Quiero hablar con una persona real" }, { "content-type": "application/json" })).body;
  assert.match(r.respuesta, /persona/);
  const chat = store.get("chats", r.sesion);
  assert.equal(chat.derivado, true);
});

test("métricas: el tablero de operación resume costos y calidad", async () => {
  const m = await get("/api/admin/metricas");
  assert.ok(typeof m.gasto_hoy_usd === "number");
  assert.ok(m.aprobacion_automatica >= 0);
  assert.ok(m.por_agente.find((a) => a.id === "auditoria"));
});
