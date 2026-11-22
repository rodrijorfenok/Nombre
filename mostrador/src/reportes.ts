import type { Menu, Negocio } from "./config.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, horaObjetivoCocina, type Pedido } from "./order.ts";

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
  /** notas que dejaron los clientes (1 a 5) */
  notas: { promedio: number; cantidad: number; bajas: number } | null;
  /** minutos promedio desde que entró a cocina hasta que estuvo listo */
  minutosCocina: number | null;
  /** % de pedidos que estuvieron listos a la hora que se le prometió al cliente */
  aTiempo: number | null;
  /** clientes que ya habían comprado antes */
  recurrentes: number;
}

const VALIDOS = new Set(["esperando_pago", "pago_en_revision", "en_cocina", "listo", "en_camino", "entregado"]);

export function calcularResumen(menu: Menu, negocio: Negocio, pedidos: Pedido[], esRecurrente?: (p: Pedido) => boolean): ResumenVentas {
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
    notas: null,
    minutosCocina: null,
    aTiempo: null,
    recurrentes: 0,
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
  if (esRecurrente) r.recurrentes = new Set(validos.filter(esRecurrente).map((p) => p.telefono)).size;
  const notas = validos.map((p) => p.calificacion?.nota).filter((n): n is number => typeof n === "number");
  if (notas.length) r.notas = { promedio: notas.reduce((a, b) => a + b, 0) / notas.length, cantidad: notas.length, bajas: notas.filter((n) => n <= 3).length };
  const medidos = validos.filter((p) => p.enCocinaDesde && p.tiempos?.listo && !p.cerradoAutomatico);
  if (medidos.length) {
    const mins = medidos.map((p) => (new Date(p.tiempos!.listo!).getTime() - new Date(p.enCocinaDesde!).getTime()) / 60_000);
    r.minutosCocina = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    const puntuales = medidos.filter((p) => {
      const obj = horaObjetivoCocina(negocio, p);
      return obj && new Date(p.tiempos!.listo!).getTime() <= obj.getTime() + 2 * 60_000;
    });
    r.aTiempo = Math.round((puntuales.length / medidos.length) * 100);
  }
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
  if (r.minutosCocina !== null) lineas.push(`👨‍🍳 Cocina: ${r.minutosCocina} min promedio · ${r.aTiempo}% listos a tiempo`);
  if (r.notas) lineas.push(`⭐ Nota de los clientes: ${r.notas.promedio.toFixed(1)} de 5 (${r.notas.cantidad} ${r.notas.cantidad === 1 ? "nota" : "notas"}${r.notas.bajas ? `, ${r.notas.bajas} de 3 o menos` : ""})`);
  if (r.recurrentes) lineas.push(`🔁 Clientes que volvieron a pedir: ${r.recurrentes}`);
  if (r.cancelados) lineas.push(`❌ Cancelados después de confirmar: ${r.cancelados}`);
  if (r.sinConfirmar) lineas.push(`🛒 Pedidos armados que no se confirmaron: ${r.sinConfirmar}`);
  return lineas.join("\n");
}
