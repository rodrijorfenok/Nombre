// Servidor de Kairos Creative: sirve el sitio y el panel, expone la API de los agentes y
// arranca la agenda autónoma.
import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.js";
import { store } from "./src/store.js";
import { AGENTES, crearTrabajo, reintentar, retomarPendientes, estadoCola, avisar, feedback, ESTADOS_ACTIVOS } from "./src/jobs.js";
import { chatear } from "./src/agents/comercial.js";
import { crearCliente, agregarLeccion, CAMPOS_CLIENTE, nuevoTokenPortal } from "./src/memoria.js";
import { resumenCartera } from "./src/cartera.js";
import { gastoDeHoy } from "./src/telemetria.js";
import { iniciarAgenda, tick } from "./src/agenda.js";

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
app.use("/", express.static(dir("./sitio")));
app.use("/panel", express.static(dir("./panel")));
app.get("/portal/:token", (req, res) => res.sendFile(dir("./portal/index.html")));
// Tienda ficticia para demostraciones (solo con ESCALA_DEMO=1).
if (process.env.ESCALA_DEMO === "1") app.use("/demo-tienda", express.static(dir("./demo-tienda")));
app.get("/panel/vendor/marked.min.js", (req, res) => res.sendFile(dir("./node_modules/marked/marked.min.js")));
app.get("/panel/vendor/purify.min.js", (req, res) => res.sendFile(dir("./node_modules/dompurify/dist/purify.min.js")));
app.get("/api/salud", (req, res) => res.json({ ok: true, cola: estadoCola(), hora: new Date().toISOString() }));

// ---------- utilidades ----------
const texto = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function limitador(max, ventanaMs) {
  const hits = new Map();
  return (req, res, next) => {
    const k = req.ip;
    const ahora = Date.now();
    const lista = (hits.get(k) || []).filter((t) => ahora - t < ventanaMs);
    if (lista.length >= max) return res.status(429).json({ error: "Demasiados pedidos. Probá de nuevo en un rato." });
    lista.push(ahora);
    hits.set(k, lista);
    next();
  };
}

function tokenOk(recibido, esperado) {
  if (!esperado) return false;
  const a = Buffer.from(recibido || ""), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const adminToken = config.adminToken || crypto.randomBytes(12).toString("hex");
const soloAdmin = (req, res, next) => (tokenOk(req.get("x-admin-token"), adminToken) ? next() : res.status(401).json({ error: "Token de administrador inválido." }));

function guardarLead(datos, origen) {
  const lead = store.insert("leads", { ...datos, origen, etapa: "nuevo" });
  avisar({ evento: "lead_nuevo", lead });
  return lead;
}

const esTienda = (link) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(link || "") && !/instagram\.com|tiktok\.com|facebook\.com|wa\.me/i.test(link);

// ---------- API pública ----------
app.get("/api/estado", (req, res) => res.json({ ok: true, demo: config.mock, agencia: config.agencia.nombre }));

app.post("/api/leads", limitador(5, 60 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const lead = {
    nombre: texto(b.nombre, 120),
    contacto: texto(b.contacto, 160),
    marca: texto(b.marca, 160),
    link: texto(b.link, 300),
    facturacion: texto(b.facturacion, 60),
    plan_interes: texto(b.plan, 60),
    problema: texto(b.mensaje, 2000),
  };
  if (!lead.nombre || !lead.contacto) return res.status(400).json({ error: "Necesitamos tu nombre y un email o WhatsApp." });
  const nuevo = guardarLead(lead, "formulario");
  crearTrabajo("calificacion", lead, { leadId: nuevo.id });
  const auditoria = config.autoAudit && esTienda(lead.link);
  if (auditoria) crearTrabajo("auditoria", { url: lead.link, contexto: lead.problema }, { leadId: nuevo.id });
  res.json({ ok: true, id: nuevo.id, auditoria });
});

function estadoCRM(chat) {
  const partes = [];
  const lead = chat.leadId && store.get("leads", chat.leadId);
  if (lead) partes.push(`lead registrado (${lead.nombre}, ${lead.contacto}${lead.marca ? `, ${lead.marca}` : ""})`);
  if (chat.auditoriaPedida) partes.push("auditoría de la tienda ya pedida");
  if (chat.derivado) partes.push("conversación ya derivada a una persona del equipo");
  return partes.length ? `Estado del CRM para esta conversación: ${partes.join("; ")}.` : "";
}

app.post("/api/chat", limitador(40, 60 * 60 * 1000), async (req, res) => {
  const mensaje = texto(req.body?.mensaje, 2000);
  if (!mensaje) return res.status(400).json({ error: "Mensaje vacío." });
  let chat = req.body?.sesion && store.get("chats", texto(req.body.sesion, 40));
  if (!chat) chat = store.insert("chats", { turnos: [], leadId: null, auditoriaPedida: false, derivado: false });
  if (chat.turnos.length >= 40) return res.status(429).json({ error: "La conversación es muy larga. Escribinos por WhatsApp o email.", sesion: chat.id });

  const turnos = [...chat.turnos, { role: "user", text: mensaje }];
  const actual = () => store.get("chats", chat.id);
  const acciones = {
    registrarLead: async (datos) => {
      if (actual().leadId) return store.update("leads", actual().leadId, datos);
      const lead = guardarLead(datos, "chat");
      store.update("chats", chat.id, { leadId: lead.id });
      crearTrabajo("calificacion", lead, { leadId: lead.id });
      return lead;
    },
    solicitarAuditoria: async (link) => {
      if (!actual().leadId) return { ok: false, motivo: "primero hay que registrar el lead (nombre y contacto)" };
      if (actual().auditoriaPedida) return { ok: false, motivo: "ya hay una auditoría pedida en esta conversación" };
      if (!esTienda(link)) return { ok: false, motivo: "el link tiene que ser la URL de una tienda online, con https://" };
      crearTrabajo("auditoria", { url: link }, { leadId: actual().leadId });
      // El link de la tienda queda en la ficha del lead (lo necesita el onboarding si se convierte en cliente).
      const lead = store.get("leads", actual().leadId);
      if (lead && !esTienda(lead.link)) store.update("leads", lead.id, { link });
      store.update("chats", chat.id, { auditoriaPedida: true });
      return { ok: true };
    },
    derivar: async ({ motivo, urgencia }) => {
      if (actual().derivado) return { ok: false, motivo: "ya se derivó; avisale que el equipo ya está al tanto" };
      store.update("chats", chat.id, { derivado: true, motivoDerivacion: motivo });
      if (actual().leadId) store.update("leads", actual().leadId, { urgente: urgencia === "alta", motivoDerivacion: motivo });
      avisar({ evento: "requiere_atencion", motivo: "chat_derivado", urgencia, detalle: motivo, chatId: chat.id, leadId: actual().leadId });
      return { ok: true };
    },
  };

  try {
    const respuesta = await chatear({ history: turnos, acciones, estado: estadoCRM(actual()) });
    store.update("chats", chat.id, { turnos: [...turnos, { role: "assistant", text: respuesta }] });
    res.json({ sesion: chat.id, respuesta });
  } catch (err) {
    console.error("[chat]", err.message);
    res.status(502).json({ sesion: chat.id, error: "El asistente no está disponible en este momento. Dejanos tus datos en el formulario y te escribimos." });
  }
});

// Ingesta automática de métricas (Make, Zapier, n8n, scripts): genera el reporte del cliente.
app.post("/api/ingesta/metricas", limitador(60, 60 * 60 * 1000), (req, res) => {
  if (!tokenOk(req.get("x-ingesta-token"), process.env.INGESTA_TOKEN)) return res.status(401).json({ error: "Token de ingesta inválido o no configurado (INGESTA_TOKEN)." });
  const { clienteId, periodo, metricas } = req.body || {};
  const cliente = store.get("clientes", texto(clienteId, 40));
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado." });
  const datos = typeof metricas === "string" ? metricas : JSON.stringify(metricas, null, 2);
  if (!datos || datos.length < 5) return res.status(400).json({ error: "Faltan las métricas." });
  const job = crearTrabajo("reporte", { periodo: texto(periodo, 80), metricas: datos.slice(0, 60000) }, { clienteId: cliente.id, origen: "ingesta" });
  if (cliente.alerta) store.update("clientes", cliente.id, { alerta: undefined });
  res.status(201).json({ ok: true, trabajo: job.id });
});

// ---------- Portal del cliente ----------
// Cada cliente tiene un link privado con sus entregas. Solo ve lo publicable según su
// configuración, nunca datos internos (costos, revisiones, lecciones).
function clienteDelPortal(req, res) {
  const token = texto(req.params.token, 60);
  const cliente = token.length >= 20 && store.find("clientes", { portalToken: token });
  if (!cliente || !cliente.activo) { res.status(404).json({ error: "Link inválido o vencido. Pedile uno nuevo a tu contacto de la agencia." }); return null; }
  return cliente;
}
const publicable = (cliente, j) => j.estado === "aprobado" || (cliente.publicacion === "automatica" && j.estado === "listo");

app.get("/api/portal/:token", limitador(120, 60 * 60 * 1000), (req, res) => {
  const cliente = clienteDelPortal(req, res);
  if (!cliente) return;
  const entregas = store.list("jobs", { where: { clienteId: cliente.id, estado: ["aprobado", "listo"] } })
    .filter((j) => publicable(cliente, j) && j.tipo !== "calificacion" && j.tipo !== "seguimiento")
    .map((j) => ({ id: j.id, tipo: j.tipo, titulo: j.agente, fecha: j.actualizado || j.creado, markdown: j.resultado?.markdown || "", comentarios: (j.comentarios_cliente || []).map((c) => ({ texto: c.texto, fecha: c.fecha })) }));
  res.json({ agencia: config.agencia.nombre, marca: cliente.marca, entregas });
});

app.post("/api/portal/:token/comentarios", limitador(30, 60 * 60 * 1000), (req, res) => {
  const cliente = clienteDelPortal(req, res);
  if (!cliente) return;
  const job = store.get("jobs", texto(req.body?.entregaId, 40));
  const comentario = texto(req.body?.texto, 1500);
  if (!job || job.clienteId !== cliente.id || !publicable(cliente, job)) return res.status(404).json({ error: "Entrega no encontrada." });
  if (!comentario) return res.status(400).json({ error: "Escribí tu comentario." });
  const comentarios = [...(job.comentarios_cliente || []), { texto: comentario, fecha: new Date().toISOString(), leido: false }];
  store.update("jobs", job.id, { comentarios_cliente: comentarios });
  avisar({ evento: "requiere_atencion", motivo: "comentario_cliente", cliente: cliente.marca, clienteId: cliente.id, responsable: cliente.responsable || null, trabajo: job.id, comentario });
  res.status(201).json({ ok: true });
});

// ---------- API del panel ----------
const admin = express.Router();
admin.use(soloAdmin);

const resumenJob = ({ resultado, traza, ...j }) => ({ ...j, tiene_resultado: Boolean(resultado) });

admin.get("/agentes", (req, res) => res.json(Object.entries(AGENTES).map(([id, a]) => ({ id, nombre: a.nombre }))));

admin.get("/leads", (req, res) => res.json(store.list("leads")));
admin.patch("/leads/:id", (req, res) => {
  const etapas = ["nuevo", "contactado", "propuesta", "cliente", "perdido"];
  const etapa = texto(req.body?.etapa, 20);
  if (!etapas.includes(etapa)) return res.status(400).json({ error: `Etapa inválida. Usá: ${etapas.join(", ")}` });
  const lead = store.update("leads", req.params.id, { etapa });
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  // Puesta en marcha automática: al cerrar un cliente se crea su ficha y corre el diagnóstico.
  let cliente = null;
  let aviso = null;
  if (etapa === "cliente" && !store.find("clientes", { leadId: lead.id })) {
    cliente = crearCliente({ marca: lead.marca || lead.nombre, url: esTienda(lead.link) ? lead.link : "", redes: esTienda(lead.link) ? "" : lead.link, contacto: lead.contacto, objetivo: lead.problema, plan: lead.plan_recomendado || lead.plan_interes, leadId: lead.id });
    // Lo trabajado durante la etapa de lead (auditorías, calificación) pasa a la historia del cliente.
    for (const j of store.list("jobs", { where: { leadId: lead.id }, liviano: true })) if (!j.clienteId) store.update("jobs", j.id, { clienteId: cliente.id });
    if (cliente.url) crearTrabajo("diagnostico", {}, { clienteId: cliente.id, leadId: lead.id, origen: "onboarding" });
    else aviso = "Se creó el cliente, pero falta la URL de su tienda: completala en su ficha y lanzá el diagnóstico.";
  }
  res.json({ lead, cliente, aviso });
});

admin.get("/clientes", (req, res) => res.json(store.list("clientes")));
admin.get("/cartera", (req, res) => res.json(resumenCartera()));
admin.post("/clientes/:id/portal/renovar", (req, res) => {
  const c = store.update("clientes", req.params.id, { portalToken: nuevoTokenPortal() });
  c ? res.json(c) : res.status(404).json({ error: "Cliente no encontrado." });
});
admin.post("/clientes", (req, res) => {
  try { res.status(201).json(crearCliente(req.body || {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
admin.patch("/clientes/:id", (req, res) => {
  const b = req.body || {};
  const cambios = {};
  for (const k of CAMPOS_CLIENTE) if (typeof b[k] === "string") cambios[k] = b[k].trim().slice(0, 1000);
  if (typeof b.activo === "boolean") cambios.activo = b.activo;
  if (["automatica", "con_aprobacion"].includes(b.publicacion)) cambios.publicacion = b.publicacion;
  if (b.automatizaciones && typeof b.automatizaciones === "object") {
    const actual = store.get("clientes", req.params.id)?.automatizaciones || {};
    cambios.automatizaciones = { ...actual, ...Object.fromEntries(Object.entries(b.automatizaciones).filter(([, v]) => typeof v === "boolean")) };
  }
  const c = store.update("clientes", req.params.id, cambios);
  c ? res.json(c) : res.status(404).json({ error: "Cliente no encontrado." });
});
admin.post("/clientes/:id/lecciones", (req, res) => {
  const c = agregarLeccion(req.params.id, texto(req.body?.texto, 600), "equipo");
  c ? res.status(201).json(c) : res.status(400).json({ error: "Cliente no encontrado o lección vacía." });
});

admin.get("/jobs", (req, res) => {
  const where = {};
  if (req.query.estado) where.estado = String(req.query.estado).split(",");
  if (req.query.clienteId) where.clienteId = String(req.query.clienteId);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Number(req.query.offset) || 0;
  res.json({ cola: estadoCola(), total: store.count("jobs", where), trabajos: store.list("jobs", { where, limit, offset, liviano: true }).map(resumenJob) });
});
admin.get("/jobs/:id", (req, res) => {
  const job = store.get("jobs", req.params.id);
  job ? res.json(job) : res.status(404).json({ error: "Trabajo no encontrado." });
});
admin.post("/jobs", (req, res) => {
  const { tipo, input } = req.body || {};
  if (!AGENTES[tipo]) return res.status(400).json({ error: "Agente desconocido." });
  if (!input || typeof input !== "object") return res.status(400).json({ error: "Faltan los datos del trabajo." });
  const clienteId = texto(req.body.clienteId, 40) || undefined;
  if (clienteId && !store.get("clientes", clienteId)) return res.status(400).json({ error: "Cliente no encontrado." });
  res.status(201).json(resumenJob(crearTrabajo(tipo, input, { leadId: texto(req.body.leadId, 40) || undefined, clienteId })));
});
admin.post("/jobs/:id/reintentar", (req, res) => {
  const job = reintentar(req.params.id);
  job ? res.json(resumenJob(job)) : res.status(400).json({ error: "Solo se pueden reintentar trabajos con error o en revisión." });
});
admin.post("/jobs/:id/feedback", (req, res) => {
  try {
    const r = feedback(req.params.id, { decision: texto(req.body?.decision, 20), comentario: texto(req.body?.comentario, 1500), guardarLeccion: req.body?.guardarLeccion !== false });
    res.json({ trabajo: resumenJob(r.job), nuevo: r.nuevo ? resumenJob(r.nuevo) : null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
admin.post("/jobs/:id/comentarios/leidos", (req, res) => {
  const job = store.get("jobs", req.params.id);
  if (!job) return res.status(404).json({ error: "Trabajo no encontrado." });
  store.update("jobs", job.id, { comentarios_cliente: (job.comentarios_cliente || []).map((c) => ({ ...c, leido: true })) });
  res.json({ ok: true });
});
admin.get("/chats", (req, res) => res.json(store.list("chats", { limit: 200 })));

// Tablero de operación: cuánto se gastó, cuánto se aprueba solo, qué necesita atención.
admin.get("/metricas", (req, res) => {
  const jobs = store.list("jobs", { liviano: true });
  const terminados = jobs.filter((j) => j.calidad);
  const porTipo = {};
  for (const j of jobs) {
    const t = (porTipo[j.tipo] ||= { nombre: AGENTES[j.tipo]?.nombre || j.tipo, total: 0, auto_aprobados: 0, costo_usd: 0, puntajes: [] });
    t.total++;
    t.costo_usd += j.costo_usd || 0;
    if (j.calidad?.aprobado && j.calidad.rondas <= 1) t.auto_aprobados++;
    if (j.calidad?.puntaje != null) t.puntajes.push(j.calidad.puntaje);
  }
  const gastos = store.meta("gastos") || {};
  // Calibración del revisor: de las entregas que el equipo juzgó, ¿en cuántas coincidió con el control automático?
  const juzgadas = jobs.filter((j) => j.feedback && j.calidad);
  const coincidencias = juzgadas.filter((j) => j.calidad.aprobado === (j.feedback.decision === "aprobar")).length;
  res.json({
    acuerdo_revisor_humano: juzgadas.length ? { porcentaje: Math.round((coincidencias / juzgadas.length) * 100), muestras: juzgadas.length } : null,
    gasto_hoy_usd: Number(gastoDeHoy().toFixed(4)),
    presupuesto_diario_usd: Number(process.env.PRESUPUESTO_DIARIO_USD || 0) || null,
    gasto_7_dias: Object.entries(gastos).sort().slice(-7),
    aprobacion_automatica: terminados.length ? Math.round((terminados.filter((j) => j.calidad.aprobado).length / terminados.length) * 100) : null,
    requieren_atencion: jobs.filter((j) => ["requiere_revision", "error"].includes(j.estado) || (j.comentarios_cliente || []).some((c) => !c.leido)).length,
    en_curso: jobs.filter((j) => ESTADOS_ACTIVOS.includes(j.estado)).length,
    por_agente: Object.entries(porTipo).map(([id, t]) => ({
      id, nombre: t.nombre, total: t.total, auto_aprobados: t.auto_aprobados, costo_usd: Number(t.costo_usd.toFixed(4)),
      puntaje_promedio: t.puntajes.length ? Math.round(t.puntajes.reduce((a, b) => a + b, 0) / t.puntajes.length) : null,
    })),
    cola: estadoCola(),
  });
});
admin.post("/agenda/ejecutar", (req, res) => res.json({ lanzados: tick().map(resumenJob) }));
app.use("/api/admin", admin);

app.use((err, req, res, next) => {
  console.error("[server]", err.message);
  res.status(err.status || 500).json({ error: err.expose ? err.message : "Error interno." });
});

export { app, adminToken };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const c of store.list("clientes")) if (!c.portalToken) store.update("clientes", c.id, { portalToken: nuevoTokenPortal(), publicacion: c.publicacion || "con_aprobacion" });
  retomarPendientes({ arranque: true });
  if (process.env.AGENDA !== "0") iniciarAgenda();
  app.listen(config.port, () => {
    console.log(`${config.agencia.nombre} en http://localhost:${config.port}`);
    console.log(`Panel: http://localhost:${config.port}/panel`);
    if (!config.adminToken) console.log(`ADMIN_TOKEN no configurado. Token temporal del panel: ${adminToken}`);
    if (config.mock) console.log("Modo DEMO activo: los agentes devuelven datos simulados.");
  });
}
