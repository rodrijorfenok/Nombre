import qrcode from "qrcode-generator";
import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, horaObjetivoCocina, unidades, type Pedido } from "./order.ts";
import { horaLocal } from "./tiempos.ts";

const SEP = "--------------------------------";

/** Datos extra que no están en el pedido (salen de la base). */
export interface InfoComanda {
  /** pedidos anteriores concretados de este cliente */
  pedidosPrevios?: number;
}

export interface Item {
  cantidad: number;
  nombre: string;
  sumado: boolean;
  /** líneas de preparación: promo, extras, sin, cambios, observación */
  detalles: { tipo: "promo" | "extra" | "sin" | "cambio" | "obs"; texto: string }[];
}

export interface Modelo {
  titulo: string;
  subtitulo?: string;
  numero: string;
  modo: "delivery" | "take_away";
  /** "LISTO 21:40" o "SALE 21:30 · LLEGA 21:45" */
  objetivo?: string;
  programado?: string;
  meta: string;
  cliente: string;
  categorias: { titulo: string; items: Item[] }[];
  obsGeneral?: string;
  direccion?: { linea: string; extra: string[]; mapa?: string };
  pago: { texto: string; fuerte: boolean }[];
}

/** Link de Google Maps para el repartidor (la ciudad del local ayuda a que no busque en otro lado). */
export function linkMapa(negocio: Negocio, direccion: string): string {
  const q = [direccion, negocio.delivery.ciudad].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Todo lo que lleva la comanda, ya armado (lo usan el texto, el ticket impreso y el panel). */
export function modeloComanda(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number, info: InfoComanda = {}): Modelo {
  const todo = calcularTotales(menu, negocio, pedido);
  const lineas = tanda ? todo.lineas.filter((d) => d.tanda === tanda) : todo.lineas;
  const tz = negocio.zonaHoraria;
  const agregado = tanda ? pedido.agregados?.find((a) => a.tanda === tanda) : undefined;
  const entro = new Date(agregado?.en ?? pedido.enCocinaDesde ?? pedido.confirmadoEn ?? pedido.creadoEn);
  const numero = String(pedido.id ?? 0).padStart(4, "0");
  const modo = pedido.entrega?.modo === "delivery" ? "delivery" : "take_away";

  let objetivo: string | undefined;
  const listo = horaObjetivoCocina(negocio, pedido);
  if (listo && pedido.horaEstimada) {
    objetivo =
      modo === "delivery"
        ? `SALE ${horaLocal(listo, tz)} · LLEGA ${horaLocal(new Date(pedido.horaEstimada), tz)}`
        : `LISTO ${horaLocal(listo, tz)}`;
  }

  const categorias: Modelo["categorias"] = [];
  for (const cat of menu.categorias) {
    const ls = lineas.filter((d) => d.categoria === cat.id);
    if (!ls.length) continue;
    categorias.push({
      titulo: `${cat.emoji} ${cat.nombre.toUpperCase()}`,
      items: ls.map((d) => {
        const detalles: Item["detalles"] = [];
        // promos y combos: qué hay que preparar, con las opciones elegidas
        const linea = pedido.lineas.find((l) => l.linea === d.linea);
        const prod = menu.productos.find((p) => p.id === linea?.productoId);
        if (prod?.comanda && linea) {
          const texto = prod.comanda.replace(/\{([^}]+)\}/g, (_, grupo: string) => {
            const g = prod.opciones.find((o) => o.grupo === grupo);
            return g?.valores.find((v) => v.id === linea.opciones[grupo])?.nombre ?? grupo;
          });
          detalles.push({ tipo: "promo", texto: texto.toUpperCase() });
        }
        for (const e of d.extras) detalles.push({ tipo: "extra", texto: e.nombre });
        if (d.sin.length) detalles.push({ tipo: "sin", texto: d.sin.join(", ").toUpperCase() });
        for (const c of d.cambios) detalles.push({ tipo: "cambio", texto: `${c.quitar.toUpperCase()} → ${c.poner.toUpperCase()}` });
        if (d.observacion) detalles.push({ tipo: "obs", texto: d.observacion });
        return {
          cantidad: d.cantidad,
          nombre: `${d.nombre.toUpperCase()}${d.opciones.length ? ` (${d.opciones.join(", ")})` : ""}`,
          sumado: !tanda && d.tanda > 0,
          detalles,
        };
      }),
    });
  }

  const n = unidades(pedido, tanda);
  const previos = info.pedidosPrevios;
  const fidelidad = previos === undefined ? "" : previos === 0 ? " · 🆕 primera vez" : ` · ⭐ ${previos + 1}° pedido`;
  const m: Modelo = {
    titulo: tanda ? `➕ AGREGADO ${tanda} AL PEDIDO #${numero}` : `🚀 ${negocio.nombre.toUpperCase()} — COMANDA #${numero}`,
    subtitulo: tanda ? "SALE JUNTO CON EL PEDIDO" : undefined,
    numero,
    modo,
    objetivo,
    programado: pedido.programadoPara ? `🕘 PROGRAMADO PARA LAS ${horaLocal(new Date(pedido.programadoPara), tz)} — NO ADELANTAR` : undefined,
    meta: `Entró ${horaLocal(entro, tz)} · ${n} ${n === 1 ? "unidad" : "unidades"}`,
    cliente: `Cliente: ${pedido.cliente ?? "-"} · ${pedido.telefono}${fidelidad}`,
    categorias,
    obsGeneral: pedido.observacionGeneral,
    pago: lineasPago(menu, negocio, pedido, tanda),
  };
  if (modo === "delivery" && pedido.entrega) {
    const e = pedido.entrega;
    const extra: string[] = [];
    if (e.entreCalles) extra.push(`Entre: ${e.entreCalles}`);
    if (e.referencias) extra.push(`Ref: ${e.referencias}`);
    if (todo.zona) extra.push(todo.zona.nombre);
    m.direccion = { linea: e.direccion ?? "-", extra, mapa: e.direccion ? linkMapa(negocio, e.direccion) : undefined };
  }
  return m;
}

/** Cómo se cobra: lo que ya está transferido y lo que hay que cobrar en efectivo al entregar. */
function lineasPago(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number): Modelo["pago"] {
  const c = cuentas(menu, negocio, pedido);
  const verificada = (ok: boolean | undefined) => (ok ? "✅ VERIFICADA" : "⏳ SIN VERIFICAR");
  const out: Modelo["pago"] = [];
  if (tanda) {
    const ag = pedido.agregados?.find((a) => a.tanda === tanda);
    if (ag?.pago === "transferencia") out.push({ texto: `💳 Agregado por transferencia ${pesos(ag.monto)} ${verificada(ag.pagado)}`, fuerte: false });
    else if (ag) out.push({ texto: `💵 Agregado: +${pesos(ag.monto)} en efectivo`, fuerte: false });
    if (c.efectivo > 0) out.push({ texto: `💵 COBRAR EN EFECTIVO EN TOTAL: ${pesos(c.efectivo)}`, fuerte: true });
    out.push({ texto: `TOTAL DEL PEDIDO: ${pesos(c.total)}`, fuerte: false });
    return out;
  }
  const m = pedido.pago?.metodo;
  if (m === "transferencia" || m === "mixto") out.push({ texto: `💳 Transferencia ${pesos(c.transferenciaBase)} ${verificada(pedido.pagoVerificado)}`, fuerte: false });
  for (const a of pedido.agregados ?? []) if (a.pago === "transferencia") out.push({ texto: `💳 Agregado ${a.tanda} por transferencia ${pesos(a.monto)} ${verificada(a.pagado)}`, fuerte: false });
  if (c.efectivo > 0) {
    const vuelto = pedido.pago?.pagaCon && pedido.pago.pagaCon > c.efectivo ? ` · paga con ${pesos(pedido.pago.pagaCon)} · llevar vuelto ${pesos(pedido.pago.pagaCon - c.efectivo)}` : "";
    out.push({ texto: `💵 Efectivo — COBRAR ${pesos(c.efectivo)}${vuelto}`, fuerte: true });
  } else if (!pedido.pagoVerificado || c.agregadosPorTransferir.length) {
    out.push({ texto: "⏳ PAGO SIN CONFIRMAR: no entregar hasta que el local lo apruebe", fuerte: true });
  } else out.push({ texto: "✅ NO COBRAR: ya está pago", fuerte: true });
  out.push({ texto: `TOTAL: ${pesos(c.total)}`, fuerte: false });
  return out;
}

/**
 * Comanda de cocina en texto (para WhatsApp o impresora térmica de 32 columnas).
 * Arriba lo que la cocina mira primero: número, modo y para qué hora tiene que estar.
 * Con `tanda`, solo lo que el cliente sumó después de que el pedido entró a cocina.
 */
export function comandaTexto(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number, info?: InfoComanda): string {
  const m = modeloComanda(menu, negocio, pedido, tanda, info);
  const out: string[] = [m.titulo];
  if (m.subtitulo) out.push(m.subtitulo);
  out.push(`${m.modo === "delivery" ? "🛵 DELIVERY" : "🏃 TAKE AWAY"}${m.objetivo ? ` · ⏱️ ${m.objetivo}` : ""}`);
  if (m.programado) out.push(m.programado);
  out.push(m.meta);
  out.push(m.cliente);
  out.push(SEP);
  for (const c of m.categorias) {
    out.push(c.titulo);
    for (const it of c.items) {
      out.push(`${it.sumado ? "➕ " : ""}${it.cantidad}x ${it.nombre}`);
      for (const d of it.detalles) {
        out.push(
          d.tipo === "promo" ? `   ➜ ${d.texto}` : d.tipo === "extra" ? `   + ${d.texto}` : d.tipo === "sin" ? `   ❌ SIN: ${d.texto}` : d.tipo === "cambio" ? `   🔁 CAMBIAR: ${d.texto}` : `   ⚠️ OBS: ${d.texto}`,
        );
      }
    }
    out.push("");
  }
  if (m.obsGeneral) out.push(`⚠️ OBS. GENERAL: ${m.obsGeneral}`);
  out.push(SEP);
  if (m.direccion) {
    out.push(`📍 ${m.direccion.linea}`);
    for (const x of m.direccion.extra) out.push(`   ${x}`);
    if (m.direccion.mapa) out.push(`🗺️ ${m.direccion.mapa}`);
  }
  out.push(...m.pago.map((p) => p.texto));
  return out.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function qrSvg(texto: string): string {
  const q = qrcode(0, "M");
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

/**
 * Comanda imprimible en ticket de 80 mm (se imprime desde el navegador del local).
 * Letra grande para el número, la hora y las cantidades; los "sin" y los cambios van en recuadro
 * para que no se pasen por alto; el delivery lleva un QR con la dirección para el repartidor.
 */
export function comandaHtml(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number, info?: InfoComanda): string {
  const m = modeloComanda(menu, negocio, pedido, tanda, info);
  const items = m.categorias
    .map(
      (c) =>
        `<div class="cat">${esc(c.titulo)}</div>` +
        c.items
          .map(
            (it) =>
              `<div class="item"><span class="q">${it.sumado ? "➕ " : ""}${it.cantidad}x</span> ${esc(it.nombre)}</div>` +
              it.detalles
                .map((d) =>
                  d.tipo === "sin"
                    ? `<div class="mod caja">❌ SIN: ${esc(d.texto)}</div>`
                    : d.tipo === "cambio"
                      ? `<div class="mod caja">🔁 CAMBIAR: ${esc(d.texto)}</div>`
                      : d.tipo === "obs"
                        ? `<div class="mod obs">⚠️ ${esc(d.texto)}</div>`
                        : `<div class="mod">${d.tipo === "promo" ? "➜" : "+"} ${esc(d.texto)}</div>`,
                )
                .join(""),
          )
          .join(""),
    )
    .join("");
  const dir = m.direccion
    ? `<div class="dir"><div><b>📍 ${esc(m.direccion.linea)}</b>${m.direccion.extra.map((x) => `<br>${esc(x)}`).join("")}</div>${m.direccion.mapa ? `<div class="qr">${qrSvg(m.direccion.mapa)}<small>Maps</small></div>` : ""}</div>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda #${pedido.id}${tanda ? ` (agregado ${tanda})` : ""}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font: 14px/1.3 ui-monospace, Menlo, Consolas, monospace; width: 74mm; margin: 0 auto; color: #000; background: #fff; }
  .top { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #000; padding-bottom: 2px; }
  .num { font-size: 30px; font-weight: 900; }
  .modo { font-size: 17px; font-weight: 800; }
  .tit { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .hora { font-size: 19px; font-weight: 900; margin: 4px 0; }
  .prog { border: 3px solid #000; padding: 3px; font-weight: 900; text-align: center; margin: 4px 0; }
  .meta { font-size: 12px; }
  .cat { font-weight: 800; margin-top: 8px; border-bottom: 1px dashed #000; }
  .item { font-size: 17px; font-weight: 700; margin-top: 4px; }
  .q { font-size: 20px; font-weight: 900; }
  .mod { padding-left: 14px; font-size: 14px; }
  .caja { border: 2px solid #000; margin: 2px 0 2px 10px; padding: 1px 4px; font-weight: 900; }
  .obs { font-weight: 700; font-style: italic; }
  .gen { border: 2px dashed #000; padding: 3px; margin-top: 6px; font-weight: 700; }
  hr { border: 0; border-top: 2px solid #000; margin: 8px 0; }
  .dir { display: flex; gap: 6px; justify-content: space-between; align-items: flex-start; }
  .qr { width: 26mm; flex: none; text-align: center; }
  .qr svg { width: 26mm; height: 26mm; display: block; }
  .pago div { margin: 2px 0; }
  .fuerte { font-size: 17px; font-weight: 900; }
  button { margin: 8px 0; padding: 8px 14px; font-size: 15px; }
  @media print { button { display: none; } }
</style></head><body>
<button onclick="window.print()">🖨️ Imprimir</button>
<div class="top"><span class="num">#${m.numero}</span><span class="modo">${m.modo === "delivery" ? "🛵 DELIVERY" : "🏃 TAKE AWAY"}</span></div>
<div class="tit">${esc(m.titulo)}${m.subtitulo ? `<br>${esc(m.subtitulo)}` : ""}</div>
${m.objetivo ? `<div class="hora">⏱️ ${esc(m.objetivo)}</div>` : ""}
${m.programado ? `<div class="prog">${esc(m.programado)}</div>` : ""}
<div class="meta">${esc(m.meta)}<br>${esc(m.cliente)}</div>
${items}
${m.obsGeneral ? `<div class="gen">⚠️ ${esc(m.obsGeneral)}</div>` : ""}
<hr>
${dir}
<div class="pago">${m.pago.map((p) => `<div class="${p.fuerte ? "fuerte" : ""}">${esc(p.texto)}</div>`).join("")}</div>
<script>if (location.search.includes("print=1")) window.print();</script>
</body></html>`;
}
