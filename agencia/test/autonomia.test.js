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

test("cliente desde el chat: el link queda en el lead, arranca el onboarding y su auditoría pasa al cliente", async () => {
  const h = { "content-type": "application/json" };
  let r = (await post("/api/chat", { mensaje: "Hola, vendo ropa de lino" }, h)).body;
  r = (await post("/api/chat", { sesion: r.sesion, mensaje: "Soy Lucía, lucia@trama.example.com, mi tienda es https://trama.example.com" }, h)).body;
  const chat = store.get("chats", r.sesion);
  const lead = store.get("leads", chat.leadId);
  assert.equal(lead.link, "https://trama.example.com");
  const aud = store.find("jobs", { leadId: lead.id, tipo: "auditoria" });
  await esperar(aud.id);
  const res = await patch(`/api/admin/leads/${lead.id}`, { etapa: "cliente" });
  assert.equal(res.aviso, null);
  assert.equal(store.get("jobs", aud.id).clienteId, res.cliente.id, "la auditoría previa pasa a la historia del cliente");
  assert.ok(store.find("jobs", { clienteId: res.cliente.id, tipo: "diagnostico" }), "arranca el diagnóstico");
});

test("cliente sin URL de tienda: se crea igual y se avisa qué falta", async () => {
  const lead = store.insert("leads", { nombre: "Sin tienda", contacto: "s@x.com", etapa: "propuesta", link: "https://instagram.com/sintienda" });
  const res = await patch(`/api/admin/leads/${lead.id}`, { etapa: "cliente" });
  assert.ok(res.cliente.id);
  assert.match(res.aviso, /falta la URL/);
});

test("diagnóstico: reutiliza la auditoría aprobada reciente en vez de pagarla de nuevo", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Reuso", rubro: "Deco", url: "https://reuso.example.com" })).body;
  const aud = (await post("/api/admin/jobs", { tipo: "auditoria", input: {}, clienteId: c.id })).body;
  await esperar(aud.id);
  const diag = (await post("/api/admin/jobs", { tipo: "diagnostico", input: {}, clienteId: c.id })).body;
  const j = await esperar(diag.id);
  assert.equal(j.estado, "listo");
  assert.equal(j.traza.pasos.filter((p) => p.agente === "auditor").length, 0, "no vuelve a llamar al auditor");
});

test("punto de control: un trabajo interrumpido se retoma desde el borrador guardado", async () => {
  const { crearTrabajo } = await import("../src/jobs.js");
  const borrador = { data: { anuncios: [1, 2, 3].map((i) => ({ angulo: `Ángulo ${i}`, formato: "UGC", gancho: `Gancho ${i}`, guion: "x", texto_principal: "t", titulo: "t", cta: "Comprar" })), recomendacion_de_testeo: "x" }, markdown: "# Borrador guardado" };
  const j = store.insert("jobs", { tipo: "creativos", agente: "Creativos de pauta", input: { producto: "Mate", cantidad: 3 }, estado: "esperando_reintento", proximoIntento: new Date(0).toISOString(), intentos: 1, revisiones: [], avance: { ronda: 0, borrador }, traza: { pasos: [{ agente: "creativos", costo_usd: 0.1 }] }, costo_usd: 0.1 });
  retomar();
  const fin = await esperar(j.id);
  assert.equal(fin.estado, "listo");
  assert.equal(fin.resultado.markdown, "# Borrador guardado", "usa el borrador, no lo regenera");
  assert.equal(fin.traza.pasos.filter((p) => p.agente === "creativos").length, 1, "no hay una segunda llamada al generador");
  assert.equal(fin.avance, undefined);
  void crearTrabajo;
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
  const dia26 = new Date(Date.UTC(2026, 10, 27, 12)); // después de toda la ventana de planificación
  const primera = tick(dia26).filter((j) => j.clienteId === c.id).map((j) => j.tipo).sort();
  assert.deepEqual(primera, ["contenido", "creativos"]);
  assert.equal(tick(dia26).filter((j) => j.clienteId === c.id).length, 0, "no duplica");
  const { desfase } = await import("../src/agenda.js");
  const diaAuditoria = 1 + desfase(c.id + ":auditoria", Number(process.env.VENTANA_REAUDITORIA || 10));
  if (diaAuditoria > 1) assert.equal(tick(new Date(Date.UTC(2026, 11, diaAuditoria - 1, 12))).filter((j) => j.clienteId === c.id).length, 0, "no audita antes de su día");
  assert.deepEqual(tick(new Date(Date.UTC(2026, 11, diaAuditoria, 12))).filter((j) => j.clienteId === c.id).map((j) => j.tipo), ["auditoria"]);
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
