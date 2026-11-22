import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, type Pedido } from "./order.ts";
import { fechaHoraLocal, horaLocal } from "./tiempos.ts";

const SEP = "--------------------------------";

/**
 * Comanda de cocina en texto (para WhatsApp o impresora térmica de 32 columnas).
 * Con `tanda`, solo lo que el cliente sumó después de que el pedido entró a cocina.
 */
export function comandaTexto(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number): string {
  const todo = calcularTotales(menu, negocio, pedido);
  const t = tanda ? { ...todo, lineas: todo.lineas.filter((d) => d.tanda === tanda) } : todo;
  const tz = negocio.zonaHoraria;
  const agregado = tanda ? pedido.agregados?.find((a) => a.tanda === tanda) : undefined;
  const confirmado = new Date(agregado?.en ?? pedido.confirmadoEn ?? pedido.creadoEn);
  const out: string[] = [];
  const numero = String(pedido.id ?? 0).padStart(4, "0");
  if (tanda) {
    out.push(`➕ AGREGADO ${tanda} AL PEDIDO #${numero}`);
    out.push("SALE JUNTO CON EL PEDIDO");
  } else out.push(`🚀 ${negocio.nombre.toUpperCase()} — COMANDA #${numero}`);
  out.push(`${fechaHoraLocal(confirmado, tz)} · ${pedido.entrega?.modo === "delivery" ? "🛵 DELIVERY" : "🏃 TAKE AWAY"}`);
  out.push(`Cliente: ${pedido.cliente ?? "-"} · ${pedido.telefono}`);
  out.push(SEP);

  const porCategoria = new Map<string, typeof t.lineas>();
  for (const d of t.lineas) {
    if (!porCategoria.has(d.categoria)) porCategoria.set(d.categoria, []);
    porCategoria.get(d.categoria)!.push(d);
  }
  for (const cat of menu.categorias) {
    const ls = porCategoria.get(cat.id);
    if (!ls) continue;
    out.push(`${cat.emoji} ${cat.nombre.toUpperCase()}`);
    for (const d of ls) {
      out.push(`${!tanda && d.tanda ? "➕ " : ""}${d.cantidad}x ${d.nombre.toUpperCase()}${d.opciones.length ? ` (${d.opciones.join(", ")})` : ""}`);
      // promos y combos: qué hay que preparar, con las opciones elegidas
      const linea = pedido.lineas.find((l) => l.linea === d.linea);
      const prod = menu.productos.find((p) => p.id === linea?.productoId);
      if (prod?.comanda && linea) {
        const texto = prod.comanda.replace(/\{([^}]+)\}/g, (_, grupo: string) => {
          const g = prod.opciones.find((o) => o.grupo === grupo);
          return g?.valores.find((v) => v.id === linea.opciones[grupo])?.nombre ?? grupo;
        });
        out.push(`   ➜ ${texto.toUpperCase()}`);
      }
      for (const e of d.extras) out.push(`   + ${e.nombre}`);
      if (d.sin.length) out.push(`   ❌ SIN: ${d.sin.join(", ").toUpperCase()}`);
      for (const c of d.cambios) out.push(`   🔁 CAMBIAR: ${c.quitar.toUpperCase()} → ${c.poner.toUpperCase()}`);
      if (d.observacion) out.push(`   ⚠️ OBS: ${d.observacion}`);
    }
    out.push("");
  }
  if (pedido.observacionGeneral) out.push(`⚠️ OBS. GENERAL: ${pedido.observacionGeneral}`);
  out.push(SEP);
  if (pedido.entrega?.modo === "delivery") {
    out.push(`📍 ${pedido.entrega.direccion ?? "-"}`);
    if (pedido.entrega.entreCalles) out.push(`   Entre: ${pedido.entrega.entreCalles}`);
    if (pedido.entrega.referencias) out.push(`   Ref: ${pedido.entrega.referencias}`);
    if (t.zona) out.push(`   ${t.zona.nombre}`);
  }
  out.push(...lineasPago(menu, negocio, pedido, tanda));
  if (pedido.horaEstimada) {
    out.push(`⏱️ Prometido al cliente: ${horaLocal(new Date(pedido.horaEstimada), tz)}`);
  }
  return out.join("\n");
}

/** Cómo se cobra: lo que ya está transferido y lo que hay que cobrar en efectivo al entregar. */
function lineasPago(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number): string[] {
  const c = cuentas(menu, negocio, pedido);
  const verificada = (ok: boolean | undefined) => (ok ? "✅ VERIFICADA" : "⏳ SIN VERIFICAR");
  const out: string[] = [];
  if (tanda) {
    const ag = pedido.agregados?.find((a) => a.tanda === tanda);
    if (ag?.pago === "transferencia") out.push(`💳 Agregado por transferencia ${pesos(ag.monto)} ${verificada(ag.pagado)}`);
    else if (ag) out.push(`💵 Agregado: +${pesos(ag.monto)} en efectivo`);
    if (c.efectivo > 0) out.push(`💵 COBRAR EN EFECTIVO EN TOTAL: ${pesos(c.efectivo)}`);
    out.push(`TOTAL DEL PEDIDO: ${pesos(c.total)}`);
    return out;
  }
  const m = pedido.pago?.metodo;
  if (m === "transferencia" || m === "mixto") out.push(`💳 Transferencia ${pesos(c.transferenciaBase)} ${verificada(pedido.pagoVerificado)}`);
  for (const a of pedido.agregados ?? []) if (a.pago === "transferencia") out.push(`💳 Agregado ${a.tanda} por transferencia ${pesos(a.monto)} ${verificada(a.pagado)}`);
  if (c.efectivo > 0) {
    const vuelto = pedido.pago?.pagaCon && pedido.pago.pagaCon > c.efectivo ? ` · paga con ${pesos(pedido.pago.pagaCon)} · llevar vuelto ${pesos(pedido.pago.pagaCon - c.efectivo)}` : "";
    out.push(`💵 Efectivo — COBRAR ${pesos(c.efectivo)}${vuelto}`);
  }
  out.push(`TOTAL: ${pesos(c.total)}`);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Comanda imprimible en ticket de 80 mm (se imprime desde el navegador del local). */
export function comandaHtml(menu: Menu, negocio: Negocio, pedido: Pedido, tanda?: number): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda #${pedido.id}${tanda ? ` (agregado ${tanda})` : ""}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font: 15px/1.35 ui-monospace, Menlo, Consolas, monospace; width: 74mm; margin: 0 auto; color: #000; background: #fff; }
  pre { white-space: pre-wrap; margin: 0; }
  button { margin: 8px 0; padding: 8px 14px; font-size: 15px; }
  @media print { button { display: none; } }
</style></head><body>
<button onclick="window.print()">🖨️ Imprimir</button>
<pre>${esc(comandaTexto(menu, negocio, pedido, tanda))}</pre>
<script>if (location.search.includes("print=1")) window.print();</script>
</body></html>`;
}
