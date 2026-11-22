import type Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { Bot, type MediaType, type Mensajero } from "./bot.ts";
import type { Cliente } from "./config.ts";
import { Store } from "./db.ts";
import { comandoStaff } from "./staff.ts";

/**
 * Demo web: un link que se le pasa al dueño del local para que pruebe SU bot desde el celular,
 * como si fuera un cliente de WhatsApp, y vea en otra pestaña cómo le llegan la comanda y los avisos.
 * No necesita Meta ni número aprobado: solo la clave de Claude.
 *
 * Cada visitante tiene su propia sesión aislada (base en memoria). El local está forzado como
 * "abierto" para que se pueda probar a cualquier hora.
 */

const CLIENTE = "demo-cliente";
const COCINA = "demo-cocina";
const MAX_SESIONES = 200;
const MAX_MENSAJES_POR_SESION = 120;
const VIDA_SESION_MS = 3 * 3_600_000;

interface Sesion {
  bot: Bot;
  chat: { de: "bot" | "cliente"; texto: string }[];
  cocina: { de: "local" | "encargado"; texto: string }[];
  mensajes: number;
  creada: number;
}

export function montarDemo(app: express.Express, clientes: Cliente[], anthropic: Anthropic) {
  const sesiones = new Map<string, Sesion>();
  const porSlug = new Map(clientes.map((c) => [c.slug, c]));
  const token = process.env.DEMO_TOKEN ?? "";

  // Sin DEMO_TOKEN la demo queda abierta solo fuera de producción (para no gastar créditos con links públicos).
  const autorizado = (req: express.Request) =>
    token ? req.query.t === token || req.header("x-demo-token") === token : process.env.NODE_ENV !== "production";

  function sesion(slug: string, id: string): Sesion | null {
    const cliente = porSlug.get(slug);
    if (!cliente || !/^[a-z0-9-]{8,64}$/.test(id)) return null;
    const clave = `${slug}:${id}`;
    let s = sesiones.get(clave);
    if (s) return s;
    // limpiar sesiones viejas
    const ahora = Date.now();
    for (const [k, v] of sesiones) if (ahora - v.creada > VIDA_SESION_MS) sesiones.delete(k);
    if (sesiones.size >= MAX_SESIONES) return null;

    const nueva: Sesion = { bot: undefined as unknown as Bot, chat: [], cocina: [], mensajes: 0, creada: ahora };
    const mensajero: Mensajero = {
      async enviarTexto(tel, texto) {
        if (tel === CLIENTE) nueva.chat.push({ de: "bot", texto });
        else nueva.cocina.push({ de: "local", texto });
      },
    };
    const store = new Store(":memory:");
    store.setAjuste("abierto_manual", "1");
    nueva.bot = new Bot({
      store,
      menu: cliente.menu,
      negocio: { ...cliente.negocio, equipo: { encargados: [COCINA], cocina: [COCINA] }, integraciones: { webhookPedidos: "" } },
      client: anthropic,
      mensajero,
      dataDir: `${process.env.DATA_DIR ?? "data"}/demo`,
      esperaRafagaMs: 0,
      slug,
    });
    sesiones.set(clave, nueva);
    return nueva;
  }

  app.get("/demo/:slug", (req, res) => {
    const cliente = porSlug.get(req.params.slug);
    if (!cliente) return void res.status(404).send("Local no encontrado");
    if (!autorizado(req)) return void res.status(401).send("Link de demo inválido");
    res.type("html").send(paginaDemo(cliente.negocio.nombre, req.params.slug, String(req.query.t ?? "")));
  });

  app.post("/demo/:slug/enviar", express.json({ limit: "8mb" }), async (req, res) => {
    if (!autorizado(req)) return void res.sendStatus(401);
    const s = sesion(req.params.slug, String(req.body?.sesion ?? ""));
    if (!s) return void res.status(429).json({ error: "Demo no disponible ahora, probá en un rato." });
    if (++s.mensajes > MAX_MENSAJES_POR_SESION) return void res.status(429).json({ error: "Llegaste al límite de mensajes de la demo." });
    const { tipo, texto, imagen, mime } = req.body ?? {};
    try {
      if (tipo === "cocina") {
        s.cocina.push({ de: "encargado", texto: String(texto) });
        const r = await comandoStaff(s.bot, String(texto));
        s.cocina.push({ de: "local", texto: r ?? "Comando no reconocido. Escribí *ayuda*." });
      } else if (tipo === "imagen" && typeof imagen === "string") {
        s.chat.push({ de: "cliente", texto: "📷 Imagen enviada" });
        await s.bot.recibir(CLIENTE, { tipo: "imagen", datos: Buffer.from(imagen, "base64"), mime: (mime as MediaType) ?? "image/jpeg" });
      } else if (tipo === "ubicacion") {
        s.chat.push({ de: "cliente", texto: "📍 Ubicación compartida" });
        await s.bot.recibir(CLIENTE, { tipo: "ubicacion", lat: Number(req.body.lat), lng: Number(req.body.lng) });
      } else {
        const t = String(texto ?? "").slice(0, 1000).trim();
        if (!t) return void res.json({ chat: s.chat, cocina: s.cocina });
        s.chat.push({ de: "cliente", texto: t });
        await s.bot.recibir(CLIENTE, { tipo: "texto", texto: t });
      }
    } catch (e) {
      console.error("[demo]", e);
    }
    res.json({ chat: s.chat, cocina: s.cocina });
  });

  app.get("/demo/:slug/estado", (req, res) => {
    if (!autorizado(req)) return void res.sendStatus(401);
    const s = sesiones.get(`${req.params.slug}:${String(req.query.sesion ?? "")}`);
    res.json(s ? { chat: s.chat, cocina: s.cocina } : { chat: [], cocina: [] });
  });
}

function paginaDemo(nombre: string, slug: string, t: string): string {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(nombre)} · Demo</title>
<style>
:root{--verde:#008069;--fondo:#efeae2;--burbuja:#fff;--mia:#d9fdd3;--texto:#111b21;--gris:#667781;--cocina:#1f2328}
*{box-sizing:border-box}html,body{margin:0;height:100%;font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:var(--texto);background:#d1d7db}
.app{display:flex;flex-direction:column;height:100dvh;max-width:1100px;margin:0 auto;background:var(--fondo)}
header{background:var(--verde);color:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px}
.avatar{width:38px;height:38px;border-radius:50%;background:#fff3;display:grid;place-items:center;font-size:20px}
header b{display:block}header small{opacity:.85}
.tabs{display:flex;background:var(--verde)}.tabs button{flex:1;padding:10px;border:0;background:none;color:#ffffffb0;font-weight:600;font-size:14px;border-bottom:3px solid transparent}
.tabs button.on{color:#fff;border-color:#fff}
.paneles{flex:1;display:flex;min-height:0}
.panel{flex:1;display:flex;flex-direction:column;min-height:0}
.msgs{flex:1;overflow-y:auto;padding:12px 10px;display:flex;flex-direction:column;gap:6px}
.m{max-width:85%;padding:7px 10px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px .5px #0002}
.bot{background:var(--burbuja);align-self:flex-start}.cliente{background:var(--mia);align-self:flex-end}
.escribiendo{align-self:flex-start;color:var(--gris);font-style:italic;padding:4px 10px}
form{display:flex;gap:6px;padding:8px;background:#f0f2f5;align-items:center}
input[type=text]{flex:1;padding:11px 14px;border-radius:22px;border:0;font-size:16px;outline:none}
.btn{border:0;border-radius:50%;width:44px;height:44px;background:var(--verde);color:#fff;font-size:18px;flex:none}
.btn.sec{background:#fff;color:var(--gris)}
.cocina .msgs{background:var(--cocina)}.cocina .m{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.cocina .local{background:#2d333b;color:#e6edf3;align-self:flex-start}.cocina .encargado{background:#ffb547;color:#000;align-self:flex-end}
.ayuda{color:#9aa4ad;font-size:12.5px;padding:8px 12px;background:var(--cocina)}
.sug{display:flex;gap:6px;overflow-x:auto;padding:6px 8px;background:#f0f2f5}.sug button{white-space:nowrap;border:1px solid #d1d7db;background:#fff;border-radius:16px;padding:6px 10px;font-size:13px}
@media(max-width:799px){.panel{display:none}.panel.on{display:flex}}
@media(min-width:800px){.tabs{display:none}.cocina{max-width:420px;border-left:1px solid #0002}}
</style></head><body><div class="app">
<header><div class="avatar">🍔</div><div><b>${esc(nombre)}</b><small id="estado">en línea</small></div></header>
<div class="tabs"><button class="on" data-p="chat">💬 Chat</button><button data-p="cocina">👨‍🍳 Cocina <span id="badge"></span></button></div>
<div class="paneles">
 <section class="panel on" id="chat"><div class="msgs" id="msgs"></div>
  <div class="sug" id="sug"></div>
  <form id="f"><button type="button" class="btn sec" id="adj" title="Enviar comprobante">📎</button><input type="file" id="file" accept="image/*,application/pdf" hidden>
  <input type="text" id="t" placeholder="Escribí como un cliente…" autocomplete="off"><button class="btn">➤</button></form></section>
 <section class="panel cocina" id="cocina"><div class="ayuda">Lo que recibe el local: comandas, avisos y derivaciones. Probá comandos: <b>pedidos</b>, <b>listo 1</b>, <b>sale 1</b>, <b>pago ok 1</b>, <b>r 1 hola</b>, <b>bot 1</b>, <b>precio muzza 10000</b>, <b>agotado napo</b>, <b>bot off</b>.</div>
  <div class="msgs" id="cmsgs"></div>
  <form id="fc"><input type="text" id="tc" placeholder="Comando del local (ej: pedidos)" autocomplete="off"><button class="btn">➤</button></form></section>
</div></div>
<script>
const slug=${JSON.stringify(slug)}, t=${JSON.stringify(t)};
let sesion; try{sesion=localStorage.getItem("demo-"+slug)}catch(e){}
if(!sesion){sesion=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());try{localStorage.setItem("demo-"+slug,sesion)}catch(e){}}
const $=s=>document.querySelector(s); let vistosCocina=0, ocupado=false;
const fmt=x=>x.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])).replace(/\\*([^*\\n]+)\\*/g,"<b>$1</b>").replace(/(^|\\s)_([^_\\n]+)_/g,"$1<i>$2</i>").replace(/(https?:\\/\\/[^\\s]+)/g,'<a href="$1" target="_blank">$1</a>');
function pintar(d){
 $("#msgs").innerHTML=d.chat.map(m=>'<div class="m '+m.de+'">'+fmt(m.texto)+'</div>').join("")+(ocupado?'<div class="escribiendo">escribiendo…</div>':"");
 $("#msgs").scrollTop=1e9;
 $("#cmsgs").innerHTML=d.cocina.map(m=>'<div class="m '+m.de+'">'+fmt(m.texto)+'</div>').join(""); $("#cmsgs").scrollTop=1e9;
 const nuevos=d.cocina.length-vistosCocina; if(!$('[data-p=cocina]').classList.contains("on")&&nuevos>0)$("#badge").textContent="("+nuevos+")";
 if(!d.chat.length)$("#sug").innerHTML=["Hola!","Me pasás la carta?","Quiero 2 cuartos de libra dobles sin cebolla, una con coca y otra con sprite","Una promo 1 con jamón y morrón, la muzza con piso","Delivery a 8 cuadras, pago por transferencia"].map(s=>'<button>'+s+'</button>').join(""); else $("#sug").innerHTML="";
 window._d=d;
}
async function enviar(body){
 ocupado=body.tipo!=="cocina"; $("#estado").textContent=ocupado?"escribiendo…":"en línea";
 if(ocupado&&window._d){window._d.chat.push({de:"cliente",texto:body.texto||"📷 Imagen enviada"});pintar(window._d)}
 try{const r=await fetch("/demo/"+slug+"/enviar"+(t?"?t="+encodeURIComponent(t):""),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sesion,...body})});
  const d=await r.json(); if(d.error)alert(d.error); else {ocupado=false;pintar(d)}}catch(e){alert("No se pudo enviar, probá de nuevo")}
 ocupado=false;$("#estado").textContent="en línea"; if(window._d)pintar(window._d);
}
$("#f").onsubmit=e=>{e.preventDefault();const v=$("#t").value.trim();if(!v||ocupado)return;$("#t").value="";enviar({tipo:"texto",texto:v})};
$("#fc").onsubmit=e=>{e.preventDefault();const v=$("#tc").value.trim();if(!v)return;$("#tc").value="";enviar({tipo:"cocina",texto:v})};
$("#sug").onclick=e=>{if(e.target.tagName==="BUTTON"&&!ocupado)enviar({tipo:"texto",texto:e.target.textContent})};
$("#adj").onclick=()=>$("#file").click();
$("#file").onchange=async()=>{const f=$("#file").files[0];if(!f)return;const b=await f.arrayBuffer();let s="";const u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));enviar({tipo:"imagen",imagen:btoa(s),mime:f.type||"image/jpeg"});$("#file").value=""};
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button,.panel").forEach(x=>x.classList.remove("on"));b.classList.add("on");$("#"+b.dataset.p).classList.add("on");if(b.dataset.p==="cocina"){vistosCocina=(window._d?.cocina.length)||0;$("#badge").textContent=""}});
fetch("/demo/"+slug+"/estado?sesion="+sesion+(t?"&t="+encodeURIComponent(t):"")).then(r=>r.json()).then(pintar);
</script></body></html>`;
}
