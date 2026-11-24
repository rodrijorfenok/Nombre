// Prueba de punta a punta en modo demo: sitio → leads → agentes → panel.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.ESCALA_MOCK = "1";
process.env.ADMIN_TOKEN = "secreto-test";
process.env.DATA_FILE = path.join(os.tmpdir(), `escala-test-${process.pid}.json`);

let base;
const admin = { "x-admin-token": "secreto-test", "content-type": "application/json" };
const json = { "content-type": "application/json" };

before(async () => {
  const { app } = await import("../server.js");
  await new Promise((r) => { const s = app.listen(0, () => { base = `http://127.0.0.1:${s.address().port}`; r(); }); s.unref(); });
});

async function esperarJobs(filtro, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const { trabajos } = await (await fetch(`${base}/api/admin/jobs`, { headers: admin })).json();
    const sel = trabajos.filter(filtro);
    if (sel.length && sel.every((j) => j.estado === "listo" || j.estado === "error")) return sel;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout esperando trabajos");
}

test("sirve el sitio y el panel", async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /Kairos Creative/);
  assert.match(await (await fetch(`${base}/panel/`)).text(), /Panel Kairos/);
});

test("el panel exige token", async () => {
  assert.equal((await fetch(`${base}/api/admin/leads`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/leads`, { headers: { "x-admin-token": "malo" } })).status, 401);
});

test("formulario: valida datos mínimos", async () => {
  const r = await fetch(`${base}/api/leads`, { method: "POST", headers: json, body: JSON.stringify({ nombre: "Ana" }) });
  assert.equal(r.status, 400);
});

test("formulario: guarda el lead, lo califica y audita la tienda", async () => {
  const r = await fetch(`${base}/api/leads`, { method: "POST", headers: json, body: JSON.stringify({
    nombre: "Ana Pérez", contacto: "ana@tienda.com", marca: "Tienda Ana", link: "https://tienda-ana.com", plan: "Growth 360", mensaje: "Tengo visitas pero no vendo",
  }) });
  const res = await r.json();
  assert.equal(r.status, 200);
  assert.equal(res.auditoria, true);
  const jobs = await esperarJobs((j) => j.leadId === res.id);
  assert.deepEqual(jobs.map((j) => j.tipo).sort(), ["auditoria", "calificacion"]);
  assert.ok(jobs.every((j) => j.estado === "listo"));
  const leads = await (await fetch(`${base}/api/admin/leads`, { headers: admin })).json();
  const lead = leads.find((l) => l.id === res.id);
  assert.equal(lead.plan_recomendado, "Tienda que convierte");
  assert.ok(lead.mensaje_sugerido);
  assert.equal(lead.auditoria.puntaje, 58);
});

test("formulario: no audita links de Instagram", async () => {
  const r = await fetch(`${base}/api/leads`, { method: "POST", headers: json, body: JSON.stringify({ nombre: "Beto", contacto: "+54 9 11 5555 5555", link: "https://instagram.com/beto" }) });
  assert.equal((await r.json()).auditoria, false);
});

test("chat: responde, registra el lead y pide la auditoría", async () => {
  let r = await (await fetch(`${base}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ mensaje: "Hola, vendo ropa" }) })).json();
  assert.ok(r.sesion && r.respuesta);
  r = await (await fetch(`${base}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ sesion: r.sesion, mensaje: "Soy Caro, caro@moda.com, mi tienda es https://moda-caro.com" }) })).json();
  assert.match(r.respuesta, /auditoría/);
  const chats = await (await fetch(`${base}/api/admin/chats`, { headers: admin })).json();
  const chat = chats.find((c) => c.id === r.sesion);
  assert.equal(chat.turnos.length, 4);
  assert.ok(chat.leadId);
  assert.equal(chat.auditoriaPedida, true);
  const jobs = await esperarJobs((j) => j.leadId === chat.leadId);
  assert.deepEqual(jobs.map((j) => j.tipo).sort(), ["auditoria", "calificacion"]);
});

test("panel: lanza cada agente y obtiene su resultado", async () => {
  const pedidos = {
    contenido: { marca: "Moda Caro", rubro: "Indumentaria" },
    creativos: { producto: "Campera rompevientos" },
    reporte: { cliente: "Moda Caro", metricas: "ventas, 84, 71" },
    diagnostico: { marca: "Moda Caro", url: "https://moda-caro.com", rubro: "Indumentaria" },
  };
  const ids = [];
  for (const [tipo, input] of Object.entries(pedidos)) {
    const r = await fetch(`${base}/api/admin/jobs`, { method: "POST", headers: admin, body: JSON.stringify({ tipo, input }) });
    assert.equal(r.status, 201);
    ids.push((await r.json()).id);
  }
  await esperarJobs((j) => ids.includes(j.id));
  for (const id of ids) {
    const job = await (await fetch(`${base}/api/admin/jobs/${id}`, { headers: admin })).json();
    assert.equal(job.estado, "listo", `${job.tipo}: ${job.error}`);
    assert.ok(job.resultado.markdown.length > 20);
  }
});

test("panel: un agente con datos faltantes termina en error y se puede reintentar", async () => {
  const r = await (await fetch(`${base}/api/admin/jobs`, { method: "POST", headers: admin, body: JSON.stringify({ tipo: "auditoria", input: { url: "sin-protocolo" } }) })).json();
  const [job] = await esperarJobs((j) => j.id === r.id);
  assert.equal(job.estado, "error");
  const re = await fetch(`${base}/api/admin/jobs/${r.id}/reintentar`, { method: "POST", headers: admin });
  assert.equal(re.status, 200);
});
