// Servidor de Escalá: sirve el sitio y el panel, y expone la API que usan los agentes.
import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./src/config.js";
import { store } from "./src/store.js";
import { AGENTES, crearTrabajo, reintentar, recuperarPendientes, estadoCola, avisar } from "./src/jobs.js";
import { chatear } from "./src/agents/comercial.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
app.use("/", express.static(dir("./sitio")));
app.use("/panel", express.static(dir("./panel")));
app.get("/panel/vendor/marked.min.js", (req, res) => res.sendFile(dir("./node_modules/marked/marked.min.js")));
app.get("/panel/vendor/purify.min.js", (req, res) => res.sendFile(dir("./node_modules/dompurify/dist/purify.min.js")));

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

const adminToken = config.adminToken || crypto.randomBytes(12).toString("hex");
function soloAdmin(req, res, next) {
  const t = req.get("x-admin-token") || "";
  const ok = t.length === adminToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(adminToken));
  if (!ok) return res.status(401).json({ error: "Token de administrador inválido." });
  next();
}

function guardarLead(datos, origen) {
  const lead = store.insert("leads", { ...datos, origen, etapa: "nuevo" });
  avisar({ evento: "lead_nuevo", lead });
  return lead;
}

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
  let auditoria = false;
  if (config.autoAudit && /^https?:\/\/[^\s]+\.[^\s]+/i.test(lead.link) && !/instagram\.com|tiktok\.com|facebook\.com/i.test(lead.link)) {
    crearTrabajo("auditoria", { url: lead.link, contexto: lead.problema }, { leadId: nuevo.id });
    auditoria = true;
  }
  res.json({ ok: true, id: nuevo.id, auditoria });
});

app.post("/api/chat", limitador(40, 60 * 60 * 1000), async (req, res) => {
  const mensaje = texto(req.body?.mensaje, 2000);
  if (!mensaje) return res.status(400).json({ error: "Mensaje vacío." });
  let chat = req.body?.sesion && store.get("chats", texto(req.body.sesion, 40));
  if (!chat) chat = store.insert("chats", { turnos: [], leadId: null, auditoriaPedida: false });
  if (chat.turnos.length >= 40) return res.status(429).json({ error: "La conversación es muy larga. Escribinos por WhatsApp o email.", sesion: chat.id });

  const turnos = [...chat.turnos, { role: "user", text: mensaje }];
  const acciones = {
    registrarLead: async (datos) => {
      const actual = store.get("chats", chat.id);
      if (actual.leadId) return store.update("leads", actual.leadId, datos);
      const lead = guardarLead(datos, "chat");
      store.update("chats", chat.id, { leadId: lead.id });
      return lead;
    },
    solicitarAuditoria: async (link) => {
      const actual = store.get("chats", chat.id);
      if (!actual.leadId) return { ok: false, motivo: "primero hay que registrar el lead" };
      if (actual.auditoriaPedida) return { ok: false, motivo: "ya hay una auditoría pedida en esta conversación" };
      if (!/^https?:\/\//i.test(link)) return { ok: false, motivo: "el link tiene que empezar con https://" };
      crearTrabajo("auditoria", { url: link }, { leadId: actual.leadId });
      store.update("chats", chat.id, { auditoriaPedida: true });
      return { ok: true };
    },
  };

  try {
    const respuesta = await chatear({ history: turnos, acciones });
    store.update("chats", chat.id, { turnos: [...turnos, { role: "assistant", text: respuesta }] });
    res.json({ sesion: chat.id, respuesta });
  } catch (err) {
    console.error("[chat]", err.message);
    res.status(502).json({ sesion: chat.id, error: "El asistente no está disponible en este momento. Dejanos tus datos en el formulario y te escribimos." });
  }
});

// ---------- API del panel ----------
const admin = express.Router();
admin.use(soloAdmin);

const resumenJob = ({ resultado, ...j }) => ({ ...j, tiene_resultado: Boolean(resultado) });

admin.get("/agentes", (req, res) => res.json(Object.entries(AGENTES).map(([id, a]) => ({ id, nombre: a.nombre }))));
admin.get("/leads", (req, res) => res.json(store.list("leads")));
admin.patch("/leads/:id", (req, res) => {
  const etapas = ["nuevo", "contactado", "propuesta", "cliente", "perdido"];
  const etapa = texto(req.body?.etapa, 20);
  if (!etapas.includes(etapa)) return res.status(400).json({ error: `Etapa inválida. Usá: ${etapas.join(", ")}` });
  const lead = store.update("leads", req.params.id, { etapa, notas: texto(req.body?.notas, 2000) || undefined });
  lead ? res.json(lead) : res.status(404).json({ error: "Lead no encontrado." });
});
admin.get("/jobs", (req, res) => res.json({ cola: estadoCola(), trabajos: store.list("jobs").map(resumenJob) }));
admin.get("/jobs/:id", (req, res) => {
  const job = store.get("jobs", req.params.id);
  job ? res.json(job) : res.status(404).json({ error: "Trabajo no encontrado." });
});
admin.post("/jobs", (req, res) => {
  const { tipo, input } = req.body || {};
  if (!AGENTES[tipo]) return res.status(400).json({ error: "Agente desconocido." });
  if (!input || typeof input !== "object") return res.status(400).json({ error: "Faltan los datos del trabajo." });
  res.status(201).json(resumenJob(crearTrabajo(tipo, input, { leadId: texto(req.body.leadId, 40) || undefined })));
});
admin.post("/jobs/:id/reintentar", (req, res) => {
  const job = reintentar(req.params.id);
  job ? res.json(resumenJob(job)) : res.status(400).json({ error: "Solo se pueden reintentar trabajos con error." });
});
admin.get("/chats", (req, res) => res.json(store.list("chats")));
app.use("/api/admin", admin);

app.use((err, req, res, next) => {
  console.error("[server]", err.message);
  res.status(err.status || 500).json({ error: err.expose ? err.message : "Error interno." });
});

export { app, adminToken };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recuperarPendientes();
  app.listen(config.port, () => {
    console.log(`${config.agencia.nombre} en http://localhost:${config.port}`);
    console.log(`Panel: http://localhost:${config.port}/panel`);
    if (!config.adminToken) console.log(`ADMIN_TOKEN no configurado. Token temporal del panel: ${adminToken}`);
    if (config.mock) console.log("Modo DEMO activo: los agentes devuelven datos simulados.");
  });
}
