import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { Bot } from "./bot.ts";
import { comandaHtml } from "./comanda.ts";
import { cargarConfig, env } from "./config.ts";
import { Store } from "./db.ts";
import { pesos } from "./money.ts";
import { calcularTotales } from "./order.ts";
import { comandoStaff } from "./staff.ts";
import { horaLocal } from "./tiempos.ts";
import { aEntrante, firmaValida, parsearWebhook, WhatsAppCloud } from "./whatsapp.ts";

const { menu, negocio } = cargarConfig();
const store = new Store(env.dbPath);
const wa = new WhatsAppCloud();
const bot = new Bot(store, menu, negocio, new Anthropic(), wa);

const app = express();

// Verificación del webhook (Meta hace un GET al configurarlo).
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(String(req.query["hub.challenge"]));
  } else res.sendStatus(403);
});

app.post("/webhook", express.raw({ type: "*/*", limit: "5mb" }), (req, res) => {
  const cuerpo = req.body as Buffer;
  if (!firmaValida(cuerpo, req.header("x-hub-signature-256"))) {
    res.sendStatus(401);
    return;
  }
  // Responder rápido: Meta reintenta si tardamos.
  res.sendStatus(200);
  let body: unknown;
  try {
    body = JSON.parse(cuerpo.toString("utf8"));
  } catch {
    return;
  }
  for (const m of parsearWebhook(body)) {
    if (!store.marcarProcesado(m.id)) continue;
    void wa.marcarLeido(m.id);
    void (async () => {
      try {
        if (env.staffNumbers.includes(m.from) && m.tipo === "text") {
          const r = await comandoStaff(bot, m.texto ?? "");
          if (r) return void (await wa.enviarTexto(m.from, r));
        }
        await bot.recibir(m.from, await aEntrante(wa, m));
      } catch (e) {
        console.error("[webhook]", e);
      }
    })();
  }
});

// ------------------- panel del local -------------------
const autorizado = (req: express.Request) => Boolean(env.panelToken) && req.query.token === env.panelToken;

app.get("/panel", (req, res) => {
  if (!autorizado(req)) return void res.sendStatus(401);
  const tk = encodeURIComponent(env.panelToken);
  const filas = store
    .pedidosActivos()
    .map((p) => {
      const tot = calcularTotales(menu, negocio, p).total;
      const comps = store
        .comprobantesDePedido(p.id!)
        .map((c) => `<a href="/comprobante/${c.id}?token=${tk}" target="_blank">🧾 ${c.veredicto}</a>`)
        .join(" ");
      const boton = (cmd: string, label: string) =>
        `<form method="post" action="/panel/cmd?token=${tk}"><input type="hidden" name="cmd" value="${cmd} ${p.id}"><button>${label}</button></form>`;
      return `<tr><td><b>#${p.id}</b></td><td>${p.estado.replace(/_/g, " ")}</td><td>${p.cliente ?? ""}<br><small>${p.telefono}</small></td>
        <td>${p.entrega?.modo === "delivery" ? `🛵 ${p.entrega.direccion ?? ""}` : "🏃 take away"}</td><td>${pesos(tot)}<br><small>${p.pago?.metodo ?? ""}</small> ${comps}</td>
        <td>${p.horaEstimada ? horaLocal(new Date(p.horaEstimada), negocio.zonaHoraria) : ""}</td>
        <td class="acc"><a href="/comanda/${p.id}?token=${tk}" target="_blank">🖨️ comanda</a>
        ${["esperando_pago", "pago_en_revision"].includes(p.estado) ? boton("pago ok", "✅ pago ok") : ""}
        ${p.estado === "en_cocina" ? boton("listo", "🔔 listo") : ""}
        ${p.entrega?.modo === "delivery" && ["en_cocina", "listo"].includes(p.estado) ? boton("sale", "🛵 salió") : ""}
        ${boton("entregado", "📦 entregado")}</td></tr>`;
    })
    .join("");
  res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20"><title>${negocio.nombre} · Pedidos</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;background:#0f1020;color:#f3f3f7}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #333;padding:8px;vertical-align:top;text-align:left}a{color:#ffb547}form{display:inline}
button{margin:2px;padding:6px 10px;border-radius:6px;border:0;background:#ffb547;font-weight:600}.acc{white-space:nowrap}</style></head>
<body><h2>🚀 ${negocio.nombre} — pedidos activos</h2><p><small>Se actualiza cada 20 s · demora extra: ${store.ajuste("demora_extra") ?? 0} min</small></p>
<table><tr><th>#</th><th>Estado</th><th>Cliente</th><th>Entrega</th><th>Total</th><th>Hora</th><th></th></tr>${filas || '<tr><td colspan="7">Sin pedidos activos</td></tr>'}</table></body></html>`);
});

app.post("/panel/cmd", express.urlencoded({ extended: false }), async (req, res) => {
  if (!autorizado(req)) return void res.sendStatus(401);
  await comandoStaff(bot, String(req.body?.cmd ?? ""));
  res.redirect(`/panel?token=${encodeURIComponent(env.panelToken)}`);
});

app.get("/comanda/:id", (req, res) => {
  if (!autorizado(req)) return void res.sendStatus(401);
  const p = store.pedido(Number(req.params.id));
  if (!p) return void res.sendStatus(404);
  res.type("html").send(comandaHtml(menu, negocio, p));
});

app.get("/comprobante/:id", (req, res) => {
  if (!autorizado(req)) return void res.sendStatus(401);
  const c = store.comprobante(Number(req.params.id));
  if (!c?.archivo || !fs.existsSync(c.archivo)) return void res.sendStatus(404);
  res.sendFile(path.resolve(c.archivo));
});

app.get("/salud", (_req, res) => void res.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`🚀 ${negocio.nombre} bot escuchando en :${port} (webhook: /webhook, panel: /panel?token=...)`));
