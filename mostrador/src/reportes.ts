import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, type Pedido } from "./order.ts";

/**
 * Reporte de ventas por jornada. Una jornada va de las 06:00 de un día a las 06:00 del siguiente,
 * así el turno de noche (20 a 00, o hasta la madrugada) queda en un solo reporte.
 */

const HORA_CORTE = 6;

/** Inicio (UTC) de la jornada que contiene `fecha`, en la zona horaria del local. */
export function inicioJornada(fecha: Date, tz: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value]),
  );
  // offset de la zona en ese momento (Argentina: -03:00 fijo, pero lo calculamos igual)
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour);
  const offsetMs = local - Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), fecha.getUTCHours());
  let inicio = Date.UTC(+p.year, +p.month - 1, +p.day, HORA_CORTE) - offsetMs;
  if (+p.hour < HORA_CORTE) inicio -= 86_400_000;
  return new Date(inicio);
}

export interface ResumenVentas {
  pedidos: number;
  facturado: number;
  ticketPromedio: number;
  delivery: number;
  takeAway: number;
  transferencia: number;
  efectivo: number;
  cancelados: number;
  sinConfirmar: number;
  top: { nombre: string; unidades: number }[];
  horaPico: string | null;
}

const VALIDOS = new Set(["esperando_pago", "pago_en_revision", "en_cocina", "listo", "en_camino", "entregado"]);

export function calcularResumen(menu: Menu, negocio: Negocio, pedidos: Pedido[]): ResumenVentas {
  const validos = pedidos.filter((p) => VALIDOS.has(p.estado) && (p.pago?.metodo === "efectivo" || p.pagoVerificado || p.estado === "entregado"));
  const r: ResumenVentas = {
    pedidos: validos.length,
    facturado: 0,
    ticketPromedio: 0,
    delivery: 0,
    takeAway: 0,
    transferencia: 0,
    efectivo: 0,
    cancelados: pedidos.filter((p) => p.estado === "cancelado" && p.confirmadoEn).length,
    sinConfirmar: pedidos.filter((p) => p.estado === "armando" && p.lineas.length > 0).length,
    top: [],
    horaPico: null,
  };
  const unidades = new Map<string, number>();
  const porHora = new Map<string, number>();
  for (const p of validos) {
    const t = calcularTotales(menu, negocio, p);
    const efectivo = cuentas(menu, negocio, p).efectivo;
    r.facturado += t.total;
    if (p.entrega?.modo === "delivery") r.delivery++;
    else r.takeAway++;
    r.efectivo += efectivo;
    r.transferencia += t.total - efectivo;
    for (const l of t.lineas) unidades.set(l.nombre, (unidades.get(l.nombre) ?? 0) + l.cantidad);
    const hora = new Intl.DateTimeFormat("es-AR", { timeZone: negocio.zonaHoraria, hour: "2-digit", hourCycle: "h23" }).format(new Date(p.confirmadoEn ?? p.creadoEn));
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
  }
  r.ticketPromedio = r.pedidos ? Math.round(r.facturado / r.pedidos) : 0;
  r.top = [...unidades].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, u]) => ({ nombre, unidades: u }));
  const pico = [...porHora].sort((a, b) => b[1] - a[1])[0];
  r.horaPico = pico ? `${pico[0]}:00 a ${String((+pico[0] + 1) % 24).padStart(2, "0")}:00 (${pico[1]} pedidos)` : null;
  return r;
}

export function textoResumen(titulo: string, r: ResumenVentas): string {
  if (!r.pedidos && !r.cancelados && !r.sinConfirmar) return `📊 *${titulo}*\nSin pedidos.`;
  const lineas = [
    `📊 *${titulo}*`,
    `🧾 Pedidos: *${r.pedidos}* · Facturado: *${pesos(r.facturado)}*`,
    `💵 Ticket promedio: ${pesos(r.ticketPromedio)}`,
    `🛵 Delivery: ${r.delivery} · 🏃 Take away: ${r.takeAway}`,
    `💳 Transferencia: ${pesos(r.transferencia)} · 💵 Efectivo: ${pesos(r.efectivo)}`,
  ];
  if (r.top.length) lineas.push(`🔥 Lo más pedido: ${r.top.map((t) => `${t.nombre} (${t.unidades})`).join(", ")}`);
  if (r.horaPico) lineas.push(`⏰ Hora pico: ${r.horaPico}`);
  if (r.cancelados) lineas.push(`❌ Cancelados después de confirmar: ${r.cancelados}`);
  if (r.sinConfirmar) lineas.push(`🛒 Pedidos armados que no se confirmaron: ${r.sinConfirmar}`);
  return lineas.join("\n");
}
