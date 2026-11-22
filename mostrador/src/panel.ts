import type { Bot } from "./bot.ts";
import { modeloComanda } from "./comanda.ts";
import { pesos } from "./money.ts";
import { cuentas, horaObjetivoCocina, textoPago, unidades, type Pedido } from "./order.ts";
import { calcularResumen, inicioJornada } from "./reportes.ts";

/**
 * Panel del local: una pantalla de cocina (KDS) que se actualiza sola.
 * El HTML es fijo; los datos llegan cada pocos segundos desde /panel/:slug/estado (JSON).
 */

export interface PedidoPanel {
  id: number;
  estado: Pedido["estado"];
  cliente: string;
  telefono: string;
  modo: "delivery" | "take_away";
  direccion?: string;
  zona?: string;
  mapa?: string;
  total: string;
  pago: string;
  cobrar?: string;
  confirmadoEn?: string;
  enCocinaDesde?: string;
  /** hora a la que la cocina lo tiene que tener listo */
  objetivo?: string;
  /** hora prometida al cliente (llega / retira) */
  horaEstimada?: string;
  programadoPara?: string;
  avisado: boolean;
  unidades: number;
  previos: number;
  items: { cantidad: number; nombre: string; sumado: boolean; detalles: { tipo: string; texto: string }[] }[];
  obsGeneral?: string;
  comprobantes: { id: number; veredicto: string }[];
  agregados: { tanda: number; lista: boolean }[];
  atendiendoPersona: boolean;
}

export interface EstadoPanel {
  local: { nombre: string; tz: string; abierto: boolean; modo: "auto" | "abierto" | "cerrado"; demora: number; botApagado: boolean; ahora: string };
  jornada: { pedidos: number; facturado: string; ticket: string; nota: string | null; aTiempo: number | null; minutosCocina: number | null };
  pedidos: PedidoPanel[];
  atencion: { pedido: number; cliente: string; telefono: string; hasta: string }[];
  stock: { id: string; nombre: string; disponible: boolean; extra: boolean }[];
  impresion: { clave: string; url: string }[];
}

export function estadoPanel(bot: Bot, slug: string, token: string): EstadoPanel {
  const { store, menu, negocio } = bot;
  const ahora = bot.ahora();
  const tk = encodeURIComponent(token);
  const manual = store.ajuste("abierto_manual");
  const humanos = store.ajustesConPrefijo("humano:");
  const enPersona = (tel: string) => Boolean(humanos[tel] && new Date(humanos[tel]).getTime() > ahora.getTime());

  const pedidos: PedidoPanel[] = store.pedidosActivos().map((p) => {
    const m = modeloComanda(menu, negocio, p);
    const c = cuentas(menu, negocio, p);
    const obj = horaObjetivoCocina(negocio, p);
    return {
      id: p.id!,
      estado: p.estado,
      cliente: p.cliente ?? "",
      telefono: p.telefono,
      modo: p.entrega?.modo === "delivery" ? "delivery" : "take_away",
      direccion: m.direccion ? [m.direccion.linea, ...m.direccion.extra].join(" · ") : undefined,
      mapa: m.direccion?.mapa,
      total: pesos(c.total),
      pago: textoPago(menu, negocio, p),
      cobrar: c.efectivo > 0 ? pesos(c.efectivo) : undefined,
      confirmadoEn: p.confirmadoEn,
      enCocinaDesde: p.enCocinaDesde,
      objetivo: obj?.toISOString(),
      horaEstimada: p.horaEstimada,
      programadoPara: p.programadoPara,
      avisado: Boolean(p.avisoCasiListo),
      unidades: unidades(p),
      previos: bot.infoComanda(p).pedidosPrevios ?? 0,
      items: m.categorias.flatMap((cat) => cat.items),
      obsGeneral: p.observacionGeneral,
      comprobantes: store.comprobantesDePedido(p.id!).map((x) => ({ id: x.id, veredicto: x.veredicto })),
      agregados: (p.agregados ?? []).map((a) => ({ tanda: a.tanda, lista: a.comandaEnviada })),
      atendiendoPersona: enPersona(p.telefono),
    };
  });

  // Charlas que está atendiendo una persona (aunque el pedido no esté confirmado todavía).
  const atencion = Object.entries(humanos)
    .filter(([, hasta]) => new Date(hasta).getTime() > ahora.getTime())
    .map(([tel, hasta]) => {
      const conv = store.conversacion(tel);
      const p = conv?.pedidoId ? store.pedido(conv.pedidoId) : null;
      return p ? { pedido: p.id!, cliente: p.cliente ?? "", telefono: tel, hasta } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const inicio = inicioJornada(ahora, negocio.zonaHoraria);
  const r = calcularResumen(menu, negocio, store.pedidosEntre(inicio.toISOString(), ahora.toISOString()));

  const impresion = store
    .pedidosActivos()
    .filter((p) => p.estado === "en_cocina")
    .flatMap((p) => [
      { clave: String(p.id), url: `/comanda/${slug}/${p.id}?token=${tk}` },
      ...(p.agregados ?? []).filter((a) => a.comandaEnviada).map((a) => ({ clave: `${p.id}-${a.tanda}`, url: `/comanda/${slug}/${p.id}?token=${tk}&tanda=${a.tanda}` })),
    ]);

  return {
    local: {
      nombre: negocio.nombre,
      tz: negocio.zonaHoraria,
      abierto: bot.abierto(),
      modo: manual === null ? "auto" : manual === "1" ? "abierto" : "cerrado",
      demora: Number(store.ajuste("demora_extra") ?? 0),
      botApagado: bot.apagado,
      ahora: ahora.toISOString(),
    },
    jornada: {
      pedidos: r.pedidos,
      facturado: pesos(r.facturado),
      ticket: pesos(r.ticketPromedio),
      nota: r.notas ? r.notas.promedio.toFixed(1) : null,
      aTiempo: r.aTiempo,
      minutosCocina: r.minutosCocina,
    },
    pedidos,
    atencion,
    stock: [
      ...menu.productos.map((p) => ({ id: p.id, nombre: p.nombre, disponible: p.disponible, extra: false })),
      ...menu.extras.map((e) => ({ id: e.id, nombre: e.nombre, disponible: e.disponible, extra: true })),
    ],
    impresion,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** La página del panel. No lleva datos: los pide sola (así se actualiza sin recargar). */
export function htmlPanel(nombre: string, slug: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111318"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<title>${esc(nombre)} · Cocina</title>
<style>
:root{--bg:#0f1115;--card:#1a1d24;--line:#2b2f3a;--txt:#f2f3f7;--dim:#9aa0ad;--acc:#ffb547;--ok:#3ecf7a;--warn:#ffcc33;--bad:#ff5a5a;--blue:#58a6ff}
*{box-sizing:border-box}body{margin:0;font:15px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt)}
header{position:sticky;top:0;z-index:5;background:#0b0d11ee;backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
h1{font-size:18px;margin:0 6px 0 0}.pill{border-radius:99px;padding:3px 10px;font-weight:700;font-size:13px}
.on{background:#173a26;color:var(--ok)}.off{background:#3a1717;color:var(--bad)}.grp{display:flex;gap:4px;align-items:center}
.stat{color:var(--dim);font-size:13px}.stat b{color:var(--txt)}
button,.btn{font:inherit;font-weight:700;border:0;border-radius:8px;padding:7px 11px;background:#2a2f3b;color:var(--txt);cursor:pointer;text-decoration:none;display:inline-block}
button:active{transform:scale(.97)}.pri{background:var(--acc);color:#1a1204}.okb{background:var(--ok);color:#06210f}.badb{background:#5a1f1f;color:#ffd6d6}.sm{padding:4px 8px;font-size:13px}
.sel{outline:2px solid var(--acc)}
main{display:grid;grid-template-columns:repeat(4,minmax(260px,1fr));gap:10px;padding:10px;align-items:start}
@media(max-width:1100px){main{grid-template-columns:repeat(2,minmax(260px,1fr))}}@media(max-width:620px){main{grid-template-columns:1fr}}
.col h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);margin:4px 2px 8px;display:flex;justify-content:space-between}
.card{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px}
.card.nuevo{animation:flash 1s ease-in-out 4}@keyframes flash{50%{background:#3a2f12}}
.card.verde{border-left-color:var(--ok)}.card.amar{border-left-color:var(--warn)}.card.rojo{border-left-color:var(--bad)}.card.azul{border-left-color:var(--blue)}
.cab{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.num{font-size:24px;font-weight:900}
.timer{font-weight:900;font-size:18px;white-space:nowrap}.verde .timer{color:var(--ok)}.amar .timer{color:var(--warn)}.rojo .timer{color:var(--bad)}
.sub{color:var(--dim);font-size:13px;margin:2px 0 6px}.tag{display:inline-block;background:#2a2f3b;border-radius:6px;padding:1px 6px;font-size:12px;margin-right:4px;color:var(--txt)}
.tag.prog{background:#1d2f4d;color:#cfe3ff}.tag.vip{background:#3b3214;color:#ffe08a}.tag.per{background:#4a1d3a;color:#ffc9ec}
ul{list-style:none;margin:6px 0;padding:0}li{padding:3px 0;border-top:1px dashed var(--line)}li:first-child{border-top:0}
.q{font-weight:900;font-size:18px;margin-right:4px}.it{font-weight:700}.det{display:block;margin-left:24px;font-size:14px;color:#dfe3ea}
.det.sin,.det.cambio{color:#fff;background:#5a1f1f;border-radius:4px;padding:0 5px;margin-top:2px;display:inline-block;margin-left:24px;font-weight:800}
.det.obs{color:var(--warn);font-style:italic}.gen{background:#3b3214;color:#ffe08a;border-radius:6px;padding:4px 6px;margin:4px 0;font-weight:700}
.dir{font-size:13px;margin:4px 0}.dir a{color:var(--blue)}.pago{font-size:13px;color:var(--dim)}.cobrar{color:var(--acc);font-weight:800}
.acc{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.acc a{color:var(--blue);font-size:13px;align-self:center}
.resp{display:none;margin-top:6px;gap:5px}.resp.vis{display:flex}.resp input{flex:1;min-width:0;border-radius:8px;border:1px solid var(--line);background:#0f1115;color:var(--txt);padding:7px;font:inherit}
.vacio{color:var(--dim);font-size:13px;padding:8px 4px}
details{margin:0 10px 10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px}summary{cursor:pointer;font-weight:700}
.stock{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.stock button{font-weight:600}.stock .no{background:#5a1f1f;color:#ffd6d6;text-decoration:line-through}
#aten .card{border-left-color:#c050a0}
#toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#000c;color:#fff;padding:9px 14px;border-radius:10px;font-weight:600;display:none;max-width:92vw;white-space:pre-line;z-index:9}
#red{display:none}#red.vis{display:inline}
</style></head><body>
<header>
  <h1>${esc(nombre)}</h1>
  <span id="estadoLocal" class="pill">…</span>
  <span class="grp"><button class="sm" data-cmd="abrir">Abrir</button><button class="sm" data-cmd="cerrar">Cerrar</button><button class="sm" data-cmd="auto">Horario</button></span>
  <span class="grp"><span class="stat">Demora</span><button class="sm" data-demora="-5">−5</button><b id="demora">0</b><button class="sm" data-demora="5">+5</button></span>
  <span class="grp"><button class="sm" id="botBtn">🤖</button></span>
  <span class="stat" id="stats"></span>
  <span class="grp" style="margin-left:auto"><span id="red" class="pill off">sin conexión</span><button class="sm" id="sonido">🔕 Sonido</button><button class="sm" id="imprimir">🖨️ Auto</button><span class="stat" id="impr"></span></span>
</header>
<section id="aten"></section>
<main>
  <div class="col"><h2>💸 Por cobrar <span id="n-pago"></span></h2><div id="c-pago"></div></div>
  <div class="col"><h2>🔥 En cocina <span id="n-cocina"></span></h2><div id="c-cocina"></div></div>
  <div class="col"><h2>✅ Listos <span id="n-listo"></span></h2><div id="c-listo"></div></div>
  <div class="col"><h2>🛵 En camino <span id="n-camino"></span></h2><div id="c-camino"></div></div>
</main>
<details id="stockBox"><summary>📦 Stock de hoy (tocá para marcar agotado / hay)</summary><div class="stock" id="stock"></div></details>
<div id="toast"></div>
<script>
(() => {
  const Q = new URLSearchParams(location.search);
  const TOKEN = Q.get("token") || "";
  const BASE = "/panel/${encodeURIComponent(slug)}";
  const url = (p) => BASE + p + (p.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const guardado = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const KEY = "mostrador-${slug}-";
  let datos = null, conocidos = null, sonido = guardado(KEY + "sonido", false);
  let auto = Q.get("auto") === "1" || guardado(KEY + "auto", false);
  let impresas = guardado("mostrador-impresas-${slug}", []);
  const abiertos = new Set();

  const toast = (t) => { const e = $("toast"); e.textContent = t; e.style.display = "block"; clearTimeout(e._t); e._t = setTimeout(() => (e.style.display = "none"), 3500); };
  const hora = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: datos?.local.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";
  const mins = (iso) => Math.round((new Date(iso).getTime() - Date.now()) / 60000);

  // ---------- sonido (el navegador lo permite recién después de tocar la pantalla) ----------
  let ctx = null;
  const beep = () => {
    if (!sonido) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = i === 2 ? 1175 : 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
      });
      navigator.vibrate?.([200, 100, 200]);
    } catch {}
  };
  const pintarBotones = () => {
    $("sonido").textContent = sonido ? "🔔 Sonido" : "🔕 Sonido"; $("sonido").classList.toggle("sel", sonido);
    $("imprimir").textContent = auto ? "🖨️ Auto: sí" : "🖨️ Auto: no"; $("imprimir").classList.toggle("sel", auto);
  };
  $("sonido").onclick = () => { sonido = !sonido; guardar(KEY + "sonido", sonido); pintarBotones(); if (sonido) beep(); };
  $("imprimir").onclick = () => {
    auto = !auto; guardar(KEY + "auto", auto);
    // al activarla, lo que ya está en cocina se da por impreso: imprime solo lo que entra desde ahora
    if (auto && datos) { impresas = [...new Set([...impresas, ...datos.impresion.map((j) => j.clave)])].slice(-300); guardar("mostrador-impresas-${slug}", impresas); }
    pintarBotones(); toast(auto ? "Impresión automática activada en esta compu" : "Impresión automática desactivada");
  };

  // ---------- pantalla siempre prendida (tablet de cocina) ----------
  let lock = null;
  const despierto = async () => { try { if (!lock && document.visibilityState === "visible") { lock = await navigator.wakeLock?.request("screen"); lock?.addEventListener("release", () => (lock = null)); } } catch {} };
  document.addEventListener("visibilitychange", despierto); document.addEventListener("click", despierto, { once: true });

  // ---------- acciones ----------
  const post = async (path, body) => {
    const r = await fetch(url(path), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  const comando = async (cmd) => {
    try { const r = await post("/cmd", { cmd }); if (r.respuesta) toast(r.respuesta.replace(/\\*/g, "")); } catch (e) { toast("No se pudo: " + e.message); }
    cargar();
  };
  // Las acciones delicadas piden un segundo toque (sin ventanas emergentes).
  const confirmar = (btn) => {
    if (btn.dataset.armado) return true;
    const txt = btn.textContent; btn.dataset.armado = "1"; btn.textContent = "¿Seguro? tocá de nuevo";
    setTimeout(() => { delete btn.dataset.armado; btn.textContent = txt; }, 3000);
    return false;
  };
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.cmd) { if (b.dataset.seguro && !confirmar(b)) return; comando(b.dataset.cmd); }
    else if (b.dataset.demora) comando("demora " + Math.max(0, (datos?.local.demora ?? 0) + Number(b.dataset.demora)));
    else if (b.dataset.resp) { const f = $("resp-" + b.dataset.resp); f.classList.toggle("vis"); if (f.classList.contains("vis")) { abiertos.add(b.dataset.resp); f.querySelector("input").focus(); } else abiertos.delete(b.dataset.resp); }
    else if (b.dataset.enviar) {
      const id = b.dataset.enviar, inp = $("resp-" + id).querySelector("input"), texto = inp.value.trim(); if (!texto) return;
      try { const r = await post("/responder", { pedido: Number(id), texto }); toast(r.respuesta || "Enviado"); inp.value = ""; abiertos.delete(id); } catch (e) { toast("No se pudo enviar: " + e.message); }
      cargar();
    } else if (b.dataset.stock) {
      try { await post("/stock", { id: b.dataset.stock, disponible: b.dataset.disp === "1" }); } catch (e) { toast("No se pudo: " + e.message); }
      cargar();
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches(".resp input")) ev.target.closest(".resp").querySelector("[data-enviar]").click(); });

  // ---------- dibujar ----------
  const color = (p) => {
    if (p.estado === "en_cocina" && p.objetivo) { const m = mins(p.objetivo); return m < 0 ? "rojo" : m <= 5 ? "amar" : "verde"; }
    if (p.estado === "esperando_pago" || p.estado === "pago_en_revision") return p.estado === "pago_en_revision" ? "amar" : "azul";
    return "verde";
  };
  const reloj = (p) => {
    if (p.estado === "en_cocina" && p.objetivo) { const m = mins(p.objetivo); return m < 0 ? "⚠️ " + -m + " min tarde" : m === 0 ? "ahora" : "faltan " + m + " min"; }
    if (p.estado === "esperando_pago" || p.estado === "pago_en_revision") return p.confirmadoEn ? "hace " + -mins(p.confirmadoEn) + " min" : "";
    if (p.estado === "listo") return p.modo === "delivery" ? "esperando repartidor" : "para retirar";
    return p.horaEstimada ? "llega " + hora(p.horaEstimada) : "";
  };
  const boton = (cmd, label, clase = "", seguro = false) => '<button class="sm ' + clase + '" data-cmd="' + esc(cmd) + '"' + (seguro ? ' data-seguro="1"' : "") + ">" + label + "</button>";
  const tarjeta = (p) => {
    const tags = [];
    if (p.programadoPara) tags.push('<span class="tag prog">🕘 para las ' + hora(p.programadoPara) + "</span>");
    if (p.previos >= 2) tags.push('<span class="tag vip">⭐ ' + (p.previos + 1) + "° pedido</span>");
    else if (p.previos === 0) tags.push('<span class="tag">🆕 primera vez</span>');
    if (p.atendiendoPersona) tags.push('<span class="tag per">🙋 lo atiende una persona</span>');
    const items = p.items.map((it) => "<li>" + '<span class="q">' + (it.sumado ? "➕" : "") + it.cantidad + "x</span>" + '<span class="it">' + esc(it.nombre) + "</span>" +
      it.detalles.map((d) => '<span class="det ' + d.tipo + '">' + (d.tipo === "sin" ? "❌ SIN " : d.tipo === "cambio" ? "🔁 " : d.tipo === "obs" ? "⚠️ " : d.tipo === "extra" ? "+ " : "➜ ") + esc(d.texto) + "</span>").join("") + "</li>").join("");
    const acc = [];
    const id = p.id;
    if (p.estado === "esperando_pago" || p.estado === "pago_en_revision") {
      acc.push(boton("pago ok " + id, "✅ Pago ok", "okb"));
      if (p.estado === "pago_en_revision") acc.push(boton("pago no " + id + " no pudimos verificar la transferencia", "❌ Rechazar", "badb", true));
      p.comprobantes.forEach((c) => acc.push('<a target="_blank" href="/comprobante/${encodeURIComponent(slug)}/' + c.id + "?token=" + encodeURIComponent(TOKEN) + '">🧾 ' + esc(c.veredicto) + "</a>"));
    }
    if (p.estado === "en_cocina") {
      if (!p.avisado) acc.push(boton("aviso " + id, "⏰ Faltan 5 min", "pri"));
      acc.push(boton("listo " + id, "🔔 Listo", "okb"));
      acc.push(boton("demorado " + id + " 10", "🕒 +10 min"));
    }
    if (p.modo === "delivery" && (p.estado === "en_cocina" || p.estado === "listo")) acc.push(boton("sale " + id, "🛵 Salió", p.estado === "listo" ? "pri" : ""));
    if (p.estado === "listo" || p.estado === "en_camino" || (p.estado === "en_cocina" && p.modo === "take_away" && p.avisado)) acc.push(boton("entregado " + id, "📦 Entregado", p.estado === "en_cocina" ? "" : "pri"));
    acc.push('<button class="sm" data-resp="' + id + '">💬</button>');
    acc.push('<a target="_blank" href="/comanda/${encodeURIComponent(slug)}/' + id + "?token=" + encodeURIComponent(TOKEN) + '">🖨️</a>');
    p.agregados.filter((a) => a.lista).forEach((a) => acc.push('<a target="_blank" href="/comanda/${encodeURIComponent(slug)}/' + id + "?token=" + encodeURIComponent(TOKEN) + "&tanda=" + a.tanda + '">➕' + a.tanda + "</a>"));
    if (p.estado !== "en_camino") acc.push(boton("cancelar " + id, "✖", "badb", true));
    if (p.atendiendoPersona) acc.push(boton("bot " + id, "🤖 Devolver al bot"));
    return '<div class="card ' + color(p) + (conocidos && !conocidos.has(id) ? " nuevo" : "") + '">' +
      '<div class="cab"><span class="num">#' + id + '</span><span class="timer">' + esc(reloj(p)) + "</span></div>" +
      '<div class="sub">' + (p.modo === "delivery" ? "🛵 " : "🏃 ") + esc(p.cliente || p.telefono) + " · " + p.unidades + " u. · " + esc(p.total) + (p.objetivo && p.estado === "en_cocina" ? " · listo " + hora(p.objetivo) : "") + "</div>" +
      tags.join("") + "<ul>" + items + "</ul>" +
      (p.obsGeneral ? '<div class="gen">⚠️ ' + esc(p.obsGeneral) + "</div>" : "") +
      (p.direccion ? '<div class="dir">📍 ' + esc(p.direccion) + (p.mapa ? ' · <a target="_blank" href="' + esc(p.mapa) + '">mapa</a>' : "") + "</div>" : "") +
      '<div class="pago">' + esc(p.pago) + (p.cobrar ? ' · <span class="cobrar">cobrar ' + esc(p.cobrar) + "</span>" : "") + "</div>" +
      '<div class="acc">' + acc.join("") + "</div>" +
      '<div class="resp' + (abiertos.has(String(id)) ? " vis" : "") + '" id="resp-' + id + '"><input placeholder="Escribile al cliente…" maxlength="900"><button class="sm pri" data-enviar="' + id + '">Enviar</button></div>' +
      "</div>";
  };
  const columna = (id, lista, vacio) => {
    $("n-" + id).textContent = lista.length || "";
    // no pisar lo que alguien está escribiendo
    const escribiendo = document.activeElement?.closest?.("#c-" + id) && document.activeElement.tagName === "INPUT";
    if (!escribiendo) $("c-" + id).innerHTML = lista.length ? lista.map(tarjeta).join("") : '<div class="vacio">' + vacio + "</div>";
  };
  const dibujar = () => {
    const d = datos, L = d.local;
    $("estadoLocal").className = "pill " + (L.abierto ? "on" : "off");
    $("estadoLocal").textContent = (L.abierto ? "ABIERTO" : "CERRADO") + (L.modo === "auto" ? "" : " (manual)");
    $("demora").textContent = L.demora ? "+" + L.demora + "′" : "0";
    $("botBtn").textContent = L.botApagado ? "🤖 Bot APAGADO · prender" : "🤖 Bot prendido";
    $("botBtn").className = "sm " + (L.botApagado ? "badb" : "");
    $("botBtn").dataset.cmd = L.botApagado ? "bot on" : "bot off";
    $("botBtn").dataset.seguro = L.botApagado ? "" : "1";
    const j = d.jornada;
    $("stats").innerHTML = "Hoy <b>" + j.pedidos + "</b> pedidos · <b>" + esc(j.facturado) + "</b> · ticket " + esc(j.ticket) +
      (j.minutosCocina !== null ? " · cocina <b>" + j.minutosCocina + "′</b> (" + j.aTiempo + "% a tiempo)" : "") + (j.nota ? " · ⭐ <b>" + j.nota + "</b>" : "");
    const por = (f) => d.pedidos.filter(f).sort((a, b) => (a.objetivo || a.confirmadoEn || "").localeCompare(b.objetivo || b.confirmadoEn || ""));
    columna("pago", por((p) => p.estado === "esperando_pago" || p.estado === "pago_en_revision"), "Nada pendiente de pago");
    columna("cocina", por((p) => p.estado === "en_cocina"), "Cocina libre 🙌");
    columna("listo", por((p) => p.estado === "listo"), "—");
    columna("camino", por((p) => p.estado === "en_camino"), "—");
    $("aten").innerHTML = d.atencion.filter((a) => !d.pedidos.some((p) => p.id === a.pedido)).map((a) =>
      '<div class="card" style="margin:10px"><b>🙋 ' + esc(a.cliente || a.telefono) + "</b> te necesita (charla #" + a.pedido + ")" +
      '<div class="acc"><button class="sm pri" data-resp="' + a.pedido + '">💬 Responder</button>' + boton("bot " + a.pedido, "🤖 Devolver al bot") + "</div>" +
      '<div class="resp' + (abiertos.has(String(a.pedido)) ? " vis" : "") + '" id="resp-' + a.pedido + '"><input placeholder="Escribile al cliente…" maxlength="900"><button class="sm pri" data-enviar="' + a.pedido + '">Enviar</button></div></div>').join("");
    if (!$("stockBox").open || !$("stock").childElementCount) {
      $("stock").innerHTML = d.stock.map((s) => '<button class="' + (s.disponible ? "" : "no") + '" data-stock="' + esc(s.id) + '" data-disp="' + (s.disponible ? "0" : "1") + '">' + (s.extra ? "+ " : "") + esc(s.nombre) + "</button>").join("");
    } else {
      d.stock.forEach((s) => { const b = document.querySelector('[data-stock="' + CSS.escape(s.id) + '"]'); if (b) { b.className = s.disponible ? "" : "no"; b.dataset.disp = s.disponible ? "0" : "1"; } });
    }
  };

  // ---------- impresión automática: cada comanda que entra a cocina, una sola vez en esta compu ----------
  let imprimiendo = false;
  const imprimir = () => {
    if (!auto || imprimiendo || !datos) { $("impr").textContent = ""; return; }
    const job = datos.impresion.find((j) => !impresas.includes(j.clave));
    if (!job) { $("impr").textContent = "esperando comandas"; return; }
    imprimiendo = true; $("impr").textContent = "imprimiendo #" + job.clave + "…";
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden"; f.src = job.url;
    f.onload = () => {
      try { f.contentWindow.focus(); f.contentWindow.print(); impresas.push(job.clave); guardar("mostrador-impresas-${slug}", impresas.slice(-300)); }
      catch (e) { $("impr").textContent = "no se pudo imprimir #" + job.clave; }
      setTimeout(() => { f.remove(); imprimiendo = false; imprimir(); }, 1500);
    };
    document.body.appendChild(f);
  };

  // ---------- actualizar cada 5 segundos ----------
  const cargar = async () => {
    try {
      const r = await fetch(url("/estado"), { headers: { Accept: "application/json" }, cache: "no-store" });
      if (r.status === 401) { document.body.innerHTML = "<p style='padding:20px'>Link sin permiso: revisá el token del panel.</p>"; return; }
      datos = await r.json();
      $("red").classList.remove("vis");
      const ids = new Set(datos.pedidos.map((p) => p.id));
      const nuevos = conocidos ? datos.pedidos.filter((p) => !conocidos.has(p.id) && (p.estado === "en_cocina" || p.estado === "esperando_pago" || p.estado === "pago_en_revision")) : [];
      dibujar();
      if (nuevos.length) { beep(); document.title = "🔔 " + nuevos.length + " nuevo · Cocina"; setTimeout(() => (document.title = ${JSON.stringify(`${nombre} · Cocina`)}), 8000); }
      conocidos = ids;
      imprimir();
    } catch { $("red").classList.add("vis"); }
  };
  pintarBotones();
  cargar();
  setInterval(cargar, 5000);
  setInterval(() => datos && dibujar(), 30000); // los relojes avanzan aunque no cambie nada
})();
</script></body></html>`;
}
