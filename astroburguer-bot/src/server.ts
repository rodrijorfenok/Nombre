import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { Bot } from "./bot.ts";
import { comandaHtml } from "./comanda.ts";
import { cargarClientes, env, type Cliente } from "./config.ts";
import { Store } from "./db.ts";
import { pesos } from "./money.ts";
import { calcularTotales } from "./order.ts";
import { comandoStaff } from "./staff.ts";
import { horaLocal } from "./tiempos.ts";
import { aEntrante, firmaValida, parsearWebhook, WhatsAppCloud } from "./whatsapp.ts";

interface Local {
  cliente: Cliente;
  bot: Bot;
  wa: WhatsAppCloud;
  store: Store;
}

// Un solo servidor atiende a todos los locales de clientes/: cada uno con su número, su base y su panel.
const anthropic = new Anthropic();
const locales = new Map<string, Local>(); // slug -> local
const porNumero = new Map<string, Local>(); // phoneNumberId -> local

for (const cliente of cargarClientes()) {
  const { slug, negocio, menu } = cliente;
  if (!negocio.whatsapp.phoneNumberId || !negocio.whatsapp.token) {
    console.warn(`⚠️  ${slug}: falta whatsapp.phoneNumberId o whatsapp.token en negocio.json, lo salteo`);
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

// Verificación del webhook (Meta hace un GET al configurarlo). Un solo webhook para todos los locales.
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
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
    if (!local.store.marcarProcesado(m.id)) continue;
    void local.wa.marcarLeido(m.id);
    void (async () => {
      try {
        if (local.cliente.negocio.equipo.encargados.includes(m.from) && m.tipo === "text") {
          const r = await comandoStaff(local.bot, m.texto ?? "");
          if (r) return void (await local.wa.enviarTexto(m.from, r));
        }
        await local.bot.recibir(m.from, await aEntrante(local.wa, m));
      } catch (e) {
        console.error(`[webhook ${local.cliente.slug}]`, e);
      }
    })();
  }
});

// ------------------- panel de cada local -------------------
function localAutorizado(req: express.Request): Local | null {
  const local = locales.get(String(req.params.slug));
  const token = local?.cliente.negocio.panel.token;
  return local && token && req.query.token === token ? local : null;
}

app.get("/panel/:slug", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const { store, cliente } = local;
  const { menu: _m, negocio, slug } = cliente;
  const menu = local.bot.menu;
  const tk = encodeURIComponent(negocio.panel.token);
  const filas = store
    .pedidosActivos()
    .map((p) => {
      const tot = calcularTotales(menu, negocio, p).total;
      const comps = store
        .comprobantesDePedido(p.id!)
        .map((c) => `<a href="/comprobante/${slug}/${c.id}?token=${tk}" target="_blank">🧾 ${c.veredicto}</a>`)
        .join(" ");
      const boton = (cmd: string, label: string) =>
        `<form method="post" action="/panel/${slug}/cmd?token=${tk}"><input type="hidden" name="cmd" value="${cmd} ${p.id}"><button>${label}</button></form>`;
      return `<tr><td><b>#${p.id}</b></td><td>${p.estado.replace(/_/g, " ")}</td><td>${p.cliente ?? ""}<br><small>${p.telefono}</small></td>
        <td>${p.entrega?.modo === "delivery" ? `🛵 ${p.entrega.direccion ?? ""}` : "🏃 take away"}</td><td>${pesos(tot)}<br><small>${p.pago?.metodo ?? ""}</small> ${comps}</td>
        <td>${p.horaEstimada ? horaLocal(new Date(p.horaEstimada), negocio.zonaHoraria) : ""}</td>
        <td class="acc"><a href="/comanda/${slug}/${p.id}?token=${tk}" target="_blank">🖨️ comanda</a>
        ${["esperando_pago", "pago_en_revision"].includes(p.estado) ? boton("pago ok", "✅ pago ok") : ""}
        ${p.estado === "en_cocina" ? boton("listo", "🔔 listo") : ""}
        ${p.entrega?.modo === "delivery" && ["en_cocina", "listo"].includes(p.estado) ? boton("sale", "🛵 salió") : ""}
        ${boton("entregado", "📦 entregado")}</td></tr>`;
    })
    .join("");
  res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20"><title>${negocio.nombre} · Pedidos</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;background:#111318;color:#f3f3f7}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #333;padding:8px;vertical-align:top;text-align:left}a{color:#ffb547}form{display:inline}
button{margin:2px;padding:6px 10px;border-radius:6px;border:0;background:#ffb547;font-weight:600}.acc{white-space:nowrap}
@media(max-width:700px){td,th{display:block;border:0;padding:2px 0}tr{display:block;border-bottom:1px solid #333;padding:8px 0}th{display:none}}</style></head>
<body><h2>${negocio.nombre} — pedidos activos</h2><p><small>Se actualiza cada 20 s · demora extra: ${store.ajuste("demora_extra") ?? 0} min</small></p>
<table><tr><th>#</th><th>Estado</th><th>Cliente</th><th>Entrega</th><th>Total</th><th>Hora</th><th></th></tr>${filas || '<tr><td colspan="7">Sin pedidos activos</td></tr>'}</table></body></html>`);
});

app.post("/panel/:slug/cmd", express.urlencoded({ extended: false }), async (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  await comandoStaff(local.bot, String(req.body?.cmd ?? ""));
  res.redirect(`/panel/${local.cliente.slug}?token=${encodeURIComponent(local.cliente.negocio.panel.token)}`);
});

app.get("/comanda/:slug/:id", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const p = local.store.pedido(Number(req.params.id));
  if (!p) return void res.sendStatus(404);
  res.type("html").send(comandaHtml(local.bot.menu, local.cliente.negocio, p));
});

app.get("/comprobante/:slug/:id", (req, res) => {
  const local = localAutorizado(req);
  if (!local) return void res.sendStatus(401);
  const c = local.store.comprobante(Number(req.params.id));
  if (!c?.archivo || !fs.existsSync(c.archivo)) return void res.sendStatus(404);
  res.sendFile(path.resolve(c.archivo));
});

app.get("/salud", (_req, res) => void res.json({ ok: true, locales: [...locales.keys()] }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`🚀 Bot de pedidos escuchando en :${port} (${locales.size} locales)`));
