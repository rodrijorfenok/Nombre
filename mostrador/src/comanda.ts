import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import { calcularTotales, type Pedido } from "./order.ts";
import { fechaHoraLocal, horaLocal } from "./tiempos.ts";

const SEP = "--------------------------------";

/** Comanda de cocina en texto (para WhatsApp o impresora térmica de 32 columnas). */
export function comandaTexto(menu: Menu, negocio: Negocio, pedido: Pedido): string {
  const t = calcularTotales(menu, negocio, pedido);
  const tz = negocio.zonaHoraria;
  const confirmado = new Date(pedido.confirmadoEn ?? pedido.creadoEn);
  const out: string[] = [];
  out.push(`🚀 ${negocio.nombre.toUpperCase()} — COMANDA #${String(pedido.id ?? 0).padStart(4, "0")}`);
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
      out.push(`${d.cantidad}x ${d.nombre.toUpperCase()}${d.opciones.length ? ` (${d.opciones.join(", ")})` : ""}`);
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
  const pago =
    pedido.pago?.metodo === "transferencia"
      ? `Transferencia ${pedido.pagoVerificado ? "✅ VERIFICADA" : "⏳ SIN VERIFICAR"}`
      : `Efectivo — COBRAR ${pesos(t.total)}${pedido.pago?.pagaCon ? ` · paga con ${pesos(pedido.pago.pagaCon)} · llevar vuelto ${pesos(pedido.pago.pagaCon - t.total)}` : ""}`;
  out.push(`💳 ${pago}`);
  out.push(`TOTAL: ${pesos(t.total)}`);
  if (pedido.horaEstimada) {
    out.push(`⏱️ Prometido al cliente: ${horaLocal(new Date(pedido.horaEstimada), tz)}`);
  }
  return out.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Comanda imprimible en ticket de 80 mm (se imprime desde el navegador del local). */
export function comandaHtml(menu: Menu, negocio: Negocio, pedido: Pedido): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda #${pedido.id}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font: 15px/1.35 ui-monospace, Menlo, Consolas, monospace; width: 74mm; margin: 0 auto; color: #000; background: #fff; }
  pre { white-space: pre-wrap; margin: 0; }
  button { margin: 8px 0; padding: 8px 14px; font-size: 15px; }
  @media print { button { display: none; } }
</style></head><body>
<button onclick="window.print()">🖨️ Imprimir</button>
<pre>${esc(comandaTexto(menu, negocio, pedido))}</pre>
<script>if (location.search.includes("print=1")) window.print();</script>
</body></html>`;
}
