import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { Bot } from "./bot.ts";
import { comandaHtml } from "./comanda.ts";
import { estadoPanel, htmlPanel } from "./panel.ts";
import { cargarClientes, env, type Cliente } from "./config.ts";
import { Store } from "./db.ts";
import { comandoCocina, comandoStaff } from "./staff.ts";
import { montarDemo } from "./demo.ts";
import { aEntrante, firmaValida, parsearWebhook, WhatsAppCloud, type MensajeWebhook } from "./whatsapp.ts";
import { semaforoIA } from "./bot.ts";
import { mismoNumero } from "./telefonos.ts";

interface Local {
  cliente: Cliente;
  bot: Bot;
  wa: WhatsAppCloud;
  store: Store;
}

// Un solo servidor atiende a todos los locales de clientes/: cada uno con su número, su base y su panel.
// Reintenta solo los errores temporales (429, 5xx, red) y corta las consultas que se cuelgan.
const anthropic = new Anthropic({ maxRetries: 4, timeout: 90_000 });
const locales = new Map<string, Local>(); // slug -> local
const porNumero = new Map<string, Local>(); // phoneNumberId -> local

const todos = cargarClientes();
for (const cliente of todos) {
  const { slug, negocio, menu } = cliente;
  if (!negocio.whatsapp.phoneNumberId || !negocio.whatsapp.token) {
    console.warn(`ℹ️  ${slug}: sin WhatsApp configurado (solo demo web)`);
    continue;
  }
  const store = new Store(path.join(env.dataDir, slug, "pedidos.db"));
  const wa = new WhatsAppCloud(negocio.whatsapp.token, negocio.whatsapp.phoneNumberId);
  const bot = new Bot({ store, menu, negocio, client: anthropic, mensajero: wa, dataDir: path.join(env.dataDir, slug), slug });
  const local = { cliente, bot, wa, store };
  locales.set(slug, local);
  porNumero.set(negocio.whatsapp.phoneNumberId, local);
  console.log(`✅ ${negocio.nombre} (${slug}) listo · panel: /panel/${slug}?token=…`);
}
if (!locales.size) console.warn("⚠️  No hay ningún local configurado con WhatsApp en clientes/");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // La comanda se imprime desde el panel dentro de un iframe del mismo sitio; el resto no se puede embeber.
  res.setHeader("X-Frame-Options", req.path.startsWith("/comanda/") ? "SAMEORIGIN" : "DENY");
  next();
});

if (process.env.NODE_ENV === "production" && !process.env.WHATSAPP_APP_SECRET && locales.size) {
  console.error("⛔ Falta WHATSAPP_APP_SECRET: en producción se rechazan todos los mensajes de WhatsApp hasta configurarlo.");
}

/** Comparación de claves en tiempo constante (no da pistas a quien intenta adivinarlas). */
function mismaClave(a: unknown, b: string): boolean {
  if (typeof a !== "string" || !b) return false;
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

// Demo web para mostrarle el bot a cada local: /demo/<local> (si DEMO_TOKEN está definido: /demo/<local>?t=DEMO_TOKEN)
montarDemo(app, todos, anthropic);
if (process.env.NODE_ENV === "production" && !process.env.DEMO_TOKEN) console.log("🧪 Demo en vivo desactivada (definí DEMO_TOKEN para habilitarla).");
else for (const c of todos) console.log(`🧪 Demo de ${c.negocio.nombre}: /demo/${c.slug}${process.env.DEMO_TOKEN ? "?t=…" : ""}`);

// Verificación del webhook (Meta hace un GET al configurarlo). Un solo webhook para todos los locales.
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && mismaClave(req.query["hub.verify_token"], process.env.WHATSAPP_VERIFY_TOKEN ?? "")) {
    res.status(200).send(String(req.query["hub.challenge"]));
  } else res.sendStatus(403);
});

app.post("/webhook", express.raw({ type: "*/*", limit: "5mb" }), (req, res) => {
  const cuerpo = req.body as Buffer;
  if (!firmaValida(cuerpo, req.header("x-hub-signature-256"))) return void res.sendStatus(401);
  res.sendStatus(200); // responder rápido: Meta reintenta si tardamos
  let body: unknown;
  try {
    body = JSON.parse(cuerpo.toString("utf8"));
  } catch {
    return;
  }
  for (const m of parsearWebhook(body)) {
    const local = porNumero.get(m.phoneNumberId);
    if (!local) {
      console.warn(`mensaje para un número no configurado: ${m.phoneNumberId}`);
      continue;
    }
    // Se guarda ANTES de procesar: si el servidor se reinicia, se retoma al arrancar.
    if (!local.store.guardarEntrante(m.id, m)) continue; // Meta reintentó un mensaje que ya tenemos
    void local.wa.marcarLeido(m.id);
    void procesarEntrante(local, m);
  }
});

const metricas = { mensajes: 0, errores: 0, msTotal: 0, msMax: 0 };

async function procesarEntrante(local: Local, m: MensajeWebhook) {
  const inicio = Date.now();
  try {
    if (local.cliente.negocio.equipo.encargados.some((n) => mismoNumero(n, m.from)) && m.tipo === "text") {
      const r = await comandoStaff(local.bot, m.texto ?? "");
      if (r) {
        await local.wa.enviarTexto(m.from, r);
        local.store.marcarEntrante(m.id, "hecho");
        return;
      }
    }
    // La cocina puede avisar "faltan 5 min", marcar listo o salido desde su WhatsApp.
    if (local.cliente.negocio.equipo.cocina.some((n) => mismoNumero(n, m.from)) && m.tipo === "text") {
      const r = await comandoCocina(local.bot, m.texto ?? "");
      if (r) {
        await local.wa.enviarTexto(m.from, r);
        local.store.marcarEntrante(m.id, "hecho");
        return;
      }
    }
    await local.bot.recibir(m.from, await aEntrante(local.wa, m));
    local.store.marcarEntrante(m.id, "hecho");
  } catch (e) {
    metricas.errores++;
    local.store.marcarEntrante(m.id, "error");
    console.error(`[webhook ${local.cliente.slug}]`, e);
  } finally {
    const ms = Date.now() - inicio;
    metricas.mensajes++;
    metricas.msTotal += ms;
    metricas.msMax = Math.max(metricas.msMax, ms);
  }
}

// Al arrancar: retomar lo que quedó a medias (mensajes de los últimos 10 minutos) y limpiar lo viejo.
function mantenimiento() {
  for (const local of locales.values()) {
    const r = local.store.limpiarViejo();
    if (r.chats || r.archivos) console.log(`🧹 ${local.cliente.slug}: ${r.chats} chats viejos y ${r.archivos} comprobantes borrados`);
  }
}
mantenimiento();
setInterval(mantenimiento, 24 * 3_600_000).unref();

// Cada minuto: recordatorios de pago, alertas de atraso, cierre de pedidos viejos y resumen al cerrar.
setInterval(() => {
  for (const local of locales.values()) local.bot.tareaPeriodica().catch((e) => console.error(`[tareas ${local.cliente.slug}]`, e));
}, 60_000).unref();

for (const local of locales.values()) {
  const pendientes = local.store.entrantesPendientes(10);
  if (pendientes.length) console.log(`↻ ${local.cliente.slug}: retomando ${pendientes.length} mensajes pendientes`);
  for (const p of pendientes) void procesarEntrante(local, p.payload as MensajeWebhook);
}

// ------------------- panel de cada local -------------------
function localAutorizado(req: express.Request): Local | null {
  const local = locales.get(String(req.params.slug));
  const token = local?.cliente.negocio.panel.token;
  return local && token && mismaClave(req.query.token, token) ? local : null;
}

app.get("/panel/:slug", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(htmlPanel(local.cliente.negocio.nombre, local.cliente.slug));
});

// Datos del panel (los pide la página cada 5 segundos).
app.get("/panel/:slug/estado", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  res.setHeader("Cache-Control", "no-store");
  res.json(estadoPanel(local.bot, local.cliente.slug, local.cliente.negocio.panel.token));
});

// Los botones del panel usan los mismos comandos que el encargado por WhatsApp.
app.post("/panel/:slug/cmd", express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const respuesta = await comandoStaff(local.bot, String(req.body?.cmd ?? "").slice(0, 500));
  if (req.accepts(["html", "json"]) === "json") return void res.json({ respuesta });
  res.redirect(`/panel/${local.cliente.slug}?token=${encodeURIComponent(local.cliente.negocio.panel.token)}`);
});

// Escribirle al cliente desde el panel (como "r N mensaje").
app.post("/panel/:slug/responder", express.json(), async (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const texto = String(req.body?.texto ?? "").trim().slice(0, 1000);
  if (!texto) return void res.status(400).json({ respuesta: "Escribí un mensaje." });
  try {
    res.json({ respuesta: (await local.bot.responderComoLocal(Number(req.body?.pedido), texto)).replace(/\*/g, "") });
  } catch (e) {
    res.status(400).json({ respuesta: (e as Error).message });
  }
});

// Agotado / hay, tocando el producto en el panel.
app.post("/panel/:slug/stock", express.json(), (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const id = String(req.body?.id ?? "");
  const menu = local.bot.menuBase;
  const item = menu.productos.find((p) => p.id === id) ?? menu.extras.find((e) => e.id === id);
  if (!item) return void res.status(404).json({ respuesta: "No existe ese producto." });
  local.store.setAjuste(`agotado:${id}`, req.body?.disponible ? null : "1");
  res.json({ respuesta: `${item.nombre}: ${req.body?.disponible ? "hay de nuevo" : "agotado"}` });
});

app.get("/comanda/:slug/:id", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const p = local.store.pedido(Number(req.params.id));
  if (!p) return void res.sendStatus(404);
  const tanda = Number(req.query.tanda) || undefined;
  if (tanda && !p.agregados?.some((a) => a.tanda === tanda)) return void res.sendStatus(404);
  res.type("html").send(comandaHtml(local.bot.menu, local.bot.negocio, p, tanda, local.bot.infoComanda(p)));
});

app.get("/comprobante/:slug/:id", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const c = local.store.comprobante(Number(req.params.id));
  if (!c?.archivo || !fs.existsSync(c.archivo)) return void res.sendStatus(404);
  res.sendFile(path.resolve(c.archivo));
});

// Política de privacidad pública (Meta la pide para publicar la app de WhatsApp).
app.get("/privacidad", (_req, res) => {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const nombres = [...locales.values()].map((l) => esc(l.cliente.negocio.nombre)).join(", ") || "el local";
  res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de privacidad · Mostrador</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#222}h1{font-size:24px}h2{font-size:18px;margin-top:28px}</style></head><body>
<h1>Política de privacidad</h1>
<p>Este servicio es el asistente de pedidos por WhatsApp de ${nombres} ("el local"). Explica qué datos usamos cuando nos escribís por WhatsApp y para qué.</p>
<h2>Qué datos recibimos</h2>
<ul><li>Tu número de WhatsApp y el nombre de tu perfil.</li><li>Los mensajes que nos mandás: lo que pedís, tu nombre, la dirección de entrega y la forma de pago.</li><li>Las imágenes que envíes, por ejemplo el comprobante de una transferencia.</li><li>La nota del 1 al 5 que nos dejes después de recibir el pedido.</li></ul>
<h2>Para qué los usamos</h2>
<p>Solo para tomar, preparar, cobrar y entregar tu pedido, y para responder tus consultas. Cuando volvés a escribir, usamos tus pedidos anteriores (tu nombre, la última dirección y lo que pediste) para atenderte más rápido. No los vendemos ni los usamos para publicidad.</p>
<h2>Con quién se comparten</h2>
<p>Con el personal del local que prepara y entrega el pedido. Los mensajes se procesan con WhatsApp (Meta) y con un servicio de inteligencia artificial (Anthropic) que ayuda a interpretar el pedido; ambos actúan como proveedores y no usan tus datos para otros fines.</p>
<h2>Cuánto tiempo se guardan</h2>
<p>Las conversaciones se borran a los 14 días y los comprobantes a los 90 días. El registro del pedido (productos, total, fecha) se conserva para la contabilidad del local.</p>
<h2>Tus derechos</h2>
<p>Podés pedir ver, corregir o borrar tus datos escribiéndonos por el mismo WhatsApp, y lo resolvemos a la brevedad.</p>
</body></html>`);
});

app.get("/salud", (_req, res) =>
  void res.json({
    ok: true,
    locales: [...locales.keys()],
    ia: { enUso: semaforoIA.enUso, enEspera: semaforoIA.enEspera, maximo: semaforoIA.maximo },
    conversacionesEnCurso: [...locales.values()].reduce((a, l) => a + l.bot.turnosEnCurso, 0),
    mensajes: metricas.mensajes,
    errores: metricas.errores,
    respuestaPromedioMs: metricas.mensajes ? Math.round(metricas.msTotal / metricas.mensajes) : 0,
    respuestaMaximaMs: metricas.msMax,
  }),
);

const port = Number(process.env.PORT ?? 3000);
const servidor = app.listen(port, () => console.log(`🚀 Bot de pedidos escuchando en :${port} (${locales.size} locales)`));

// Apagado prolijo (por ejemplo en cada actualización): deja de recibir y termina las respuestas en curso.
let apagando = false;
for (const senal of ["SIGTERM", "SIGINT"] as const) {
  process.on(senal, async () => {
    if (apagando) return;
    apagando = true;
    console.log(`${senal}: terminando las respuestas en curso…`);
    servidor.close();
    const limite = new Promise((r) => setTimeout(r, 25_000));
    await Promise.race([Promise.allSettled([...locales.values()].map((l) => l.bot.terminarPendientes())), limite]);
    process.exit(0);
  });
}
