// Pruebas para operar ~20 clientes: base SQLite, cola con prioridades y equidad,
// agenda escalonada, cartera, portal del cliente, migración y copias de seguridad.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "escala-escala-"));
process.env.ESCALA_MOCK = "1";
process.env.ADMIN_TOKEN = "secreto-test";
process.env.MAX_JOBS = "4";
process.env.DATA_FILE = path.join(dir, "db.json");
// Un db.json de la versión anterior para probar la migración.
fs.writeFileSync(process.env.DATA_FILE, JSON.stringify({ leads: [{ id: "lead_viejo", creado: "2026-01-01T00:00:00.000Z", nombre: "Viejo", contacto: "v@x.com", etapa: "nuevo" }], jobs: [], chats: [], clientes: [], meta: { agenda: {} } }));

let base, store;
const admin = { "x-admin-token": "secreto-test", "content-type": "application/json" };
const get = async (p, h = admin) => { const r = await fetch(base + p, { headers: h }); return { status: r.status, body: await r.json() }; };
const post = async (p, body, h = admin) => { const r = await fetch(base + p, { method: "POST", headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const FINALES = ["listo", "requiere_revision", "error", "aprobado", "rechazado"];
async function esperarTodos(ids, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (ids.every((id) => FINALES.includes(store.get("jobs", id).estado))) return ids.map((id) => store.get("jobs", id));
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
}

before(async () => {
  const { app } = await import("../server.js");
  ({ store } = await import("../src/store.js"));
  await new Promise((r) => { const s = app.listen(0, () => { base = `http://127.0.0.1:${s.address().port}`; r(); }); s.unref(); });
});

test("migración: los datos del JSON anterior pasan a SQLite", () => {
  assert.equal(store.get("leads", "lead_viejo")?.nombre, "Viejo");
  assert.ok(fs.existsSync(process.env.DATA_FILE + ".migrado"));
});

test("cola: un cliente no acapara la cola y los leads tienen prioridad", async () => {
  const { crearTrabajo } = await import("../src/jobs.js");
  const { crearCliente } = await import("../src/memoria.js");
  const grande = crearCliente({ marca: "Acaparador", rubro: "Deco", productos: "Velas" });
  const chico = crearCliente({ marca: "Chico", rubro: "Moda", productos: "Remeras" });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(crearTrabajo("creativos", { cantidad: 3 }, { clienteId: grande.id }).id);
  const delChico = crearTrabajo("creativos", { cantidad: 3 }, { clienteId: chico.id });
  const lead = store.insert("leads", { nombre: "Urgente", contacto: "u@x.com", etapa: "nuevo" });
  const calif = crearTrabajo("calificacion", lead, { leadId: lead.id });

  let maxGrande = 0;
  const vigia = setInterval(() => {
    const activos = store.count("jobs", { clienteId: grande.id, estado: ["trabajando", "revisando"] });
    maxGrande = Math.max(maxGrande, activos);
  }, 5);
  const todos = await esperarTodos([...ids, delChico.id, calif.id]);
  clearInterval(vigia);

  assert.equal(maxGrande, 1, "nunca más de un trabajo a la vez del mismo cliente");
  const finDe = (id) => new Date(todos.find((j) => j.id === id).actualizado).getTime();
  assert.ok(finDe(delChico.id) < Math.max(...ids.map(finDe)), "el cliente chico no espera a que termine el grande");
  const inicios = ids.map((id) => store.get("jobs", id).iniciado);
  assert.deepEqual([...inicios].sort(), inicios, "los trabajos del mismo cliente respetan el orden de llegada");
  assert.ok(finDe(calif.id) <= Math.min(...ids.map(finDe)) + 400, "el lead se atiende entre los primeros");
  assert.equal(store.get("jobs", calif.id).prioridad, 1);
});

test("agenda: reparte la planificación de 20 clientes en varios días", async () => {
  const { desfase } = await import("../src/agenda.js");
  const dias = {};
  for (let i = 0; i < 20; i++) { const d = desfase(`cliente_${i}abc`, 6); dias[d] = (dias[d] || 0) + 1; }
  assert.ok(Object.keys(dias).length >= 4, "usa al menos 4 días distintos");
  assert.ok(Math.max(...Object.values(dias)) <= 8, "ningún día concentra casi todo");
});

test("cartera: mide cumplimiento del plan, costo y salud", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Bruma", rubro: "Cosmética", plan: "Growth 360", responsable: "Ana" })).body;
  const { crearTrabajo } = await import("../src/jobs.js");
  const j = crearTrabajo("contenido", { reels: 1, carruseles: 1, historias: 1 }, { clienteId: c.id });
  await esperarTodos([j.id]);
  store.update("jobs", j.id, { costo_usd: 1.5 });
  const { body } = await get("/api/admin/cartera");
  const fila = body.filas.find((f) => f.id === c.id);
  assert.equal(fila.responsable, "Ana");
  assert.deepEqual(fila.cumplimiento.find((x) => x.tipo === "contenido"), { tipo: "contenido", esperados: 1, hechos: 1 });
  assert.equal(fila.cumplimiento_pct, 14); // 1 de los 7 entregables del mes de Growth 360
});

test("portal: el cliente ve solo lo publicable y sin datos internos", async () => {
  const c = (await post("/api/admin/clientes", { marca: "Nube", rubro: "Deco", productos: "Velas" })).body;
  const { crearTrabajo, feedback } = await import("../src/jobs.js");
  const [a, b] = [crearTrabajo("creativos", { cantidad: 3 }, { clienteId: c.id }), crearTrabajo("creativos", { cantidad: 4 }, { clienteId: c.id })];
  await esperarTodos([a.id, b.id]);
  feedback(a.id, { decision: "aprobar" });

  assert.equal((await get("/api/portal/token-que-no-existe-123456")).status, 404);
  let r = await get(`/api/portal/${c.portalToken}`, {});
  assert.deepEqual(r.body.entregas.map((e) => e.id), [a.id], "con aprobación: solo lo aprobado por el equipo");
  assert.equal(r.body.entregas[0].costo_usd, undefined);
  assert.equal(r.body.entregas[0].revisiones, undefined);

  await fetch(`${base}/api/admin/clientes/${c.id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ publicacion: "automatica" }) });
  r = await get(`/api/portal/${c.portalToken}`, {});
  assert.equal(r.body.entregas.length, 2, "automática: también lo aprobado por calidad");

  const com = await post(`/api/portal/${c.portalToken}/comentarios`, { entregaId: a.id, texto: "¿Podemos cambiar el gancho 2?" }, { "content-type": "application/json" });
  assert.equal(com.status, 201);
  const m = (await get("/api/admin/metricas")).body;
  assert.ok(m.requieren_atencion >= 1, "el comentario del cliente aparece en Requieren atención");

  const otro = await post(`/api/portal/${c.portalToken}/comentarios`, { entregaId: "job_de_otro", texto: "x" }, { "content-type": "application/json" });
  assert.equal(otro.status, 404);

  const renovado = (await post(`/api/admin/clientes/${c.id}/portal/renovar`, {})).body;
  assert.equal((await get(`/api/portal/${c.portalToken}`, {})).status, 404, "el link viejo deja de funcionar");
  assert.equal((await get(`/api/portal/${renovado.portalToken}`, {})).status, 200);
  assert.match(await (await fetch(`${base}/portal/${renovado.portalToken}`)).text(), /tus entregas/);
});

test("trabajos: el listado se pagina y se filtra", async () => {
  const { body } = await get("/api/admin/jobs?limit=2");
  assert.equal(body.trabajos.length, 2);
  assert.ok(body.total > 2);
  assert.equal(body.trabajos[0].resultado, undefined, "el listado no trae los resultados pesados");
  const listos = (await get("/api/admin/jobs?estado=listo,aprobado")).body;
  assert.ok(listos.trabajos.every((j) => ["listo", "aprobado"].includes(j.estado)));
});

test("copias de seguridad: la agenda guarda una por día", async () => {
  const { tick } = await import("../src/agenda.js");
  tick();
  const backups = fs.readdirSync(path.join(dir, "backups"));
  assert.equal(backups.length, 1);
  tick();
  assert.equal(fs.readdirSync(path.join(dir, "backups")).length, 1, "no duplica en el mismo día");
});

test("copias de seguridad: la copia se puede restaurar y tiene los mismos datos", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const archivo = path.join(dir, "backups", fs.readdirSync(path.join(dir, "backups"))[0]);
  const copia = new DatabaseSync(archivo, { readOnly: true });
  try {
    assert.equal(copia.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    for (const col of ["leads", "jobs", "clientes"]) {
      const n = copia.prepare(`SELECT COUNT(*) AS n FROM ${col}`).get().n;
      assert.equal(n, store.count(col), `la copia tiene todos los ${col}`);
    }
    const c = store.list("clientes")[0];
    if (c) assert.equal(JSON.parse(copia.prepare("SELECT data FROM clientes WHERE id = ?").get(c.id).data).marca, c.marca);
  } finally { copia.close(); }
});

test("salud: endpoint para monitoreo externo", async () => {
  const { body } = await get("/api/salud", {});
  assert.equal(body.ok, true);
});
