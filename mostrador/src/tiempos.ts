import type { Menu, Negocio } from "./config.ts";
import type { Pedido } from "./order.ts";

export interface EstimacionEspera {
  minutosCocina: number;
  minutosViaje: number;
  /** rango redondeado a múltiplos de 5 */
  rango: [number, number];
  horaEstimada: Date;
  detalle: string;
}

const redondear5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

/**
 * Tiempo de espera = preparación (categoría más lenta del pedido + recargo por volumen)
 *                  + cola de cocina (tandas de pedidos activos delante)
 *                  + demora manual cargada por el staff
 *                  + viaje según zona (solo delivery).
 */
export function estimarEspera(
  menu: Menu,
  negocio: Negocio,
  pedido: Pedido,
  pedidosEnCocina: number,
  demoraExtraMin = 0,
  ahora = new Date(),
): EstimacionEspera {
  const c = negocio.cocina;
  let prep = 0;
  let unidades = 0;
  for (const l of pedido.lineas) {
    const p = menu.productos.find((x) => x.id === l.productoId);
    const cat = menu.categorias.find((x) => x.id === p?.categoria);
    if (cat && cat.prepMin > 0) {
      prep = Math.max(prep, cat.prepMin);
      unidades += l.cantidad;
    }
  }
  const recargoVolumen = Math.max(0, unidades - c.unidadesSinRecargo) * c.minutosPorUnidadExtra;
  const tandasDelante = Math.floor(pedidosEnCocina / c.pedidosEnParalelo);
  const cola = tandasDelante * c.minutosPorTanda;
  const minutosCocina = prep + recargoVolumen + cola + demoraExtraMin;

  let minutosViaje = 0;
  if (pedido.entrega?.modo === "delivery") {
    const z = negocio.delivery.zonas.find((x) => x.id === pedido.entrega?.zonaId);
    minutosViaje = z?.minutos ?? 20;
  }
  const min = redondear5(minutosCocina + minutosViaje);
  const max = min + 10;
  const horaEstimada = new Date(ahora.getTime() + max * 60_000);
  const detalle = [
    `preparación ${prep} min`,
    recargoVolumen ? `volumen +${recargoVolumen} min` : "",
    cola ? `cola de cocina +${cola} min (${pedidosEnCocina} pedidos en curso)` : "",
    demoraExtraMin ? `demora del local +${demoraExtraMin} min` : "",
    minutosViaje ? `viaje ${minutosViaje} min` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return { minutosCocina, minutosViaje, rango: [min, max], horaEstimada, detalle };
}

export function horaLocal(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function fechaHoraLocal(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function partesLocales(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { dia: dias.indexOf(get("weekday")), minutos: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

const aMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function fechaLocal(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Tramos de apertura de una fecha: los del día de la semana + el horario de feriado si corresponde. */
function tramosDelDia(negocio: Negocio, fecha: string, diaSemana: number): { abre: number; cierra: number }[] {
  const tramos = negocio.horarios.filter((h) => h.dias.includes(diaSemana)).map((h) => ({ abre: aMin(h.abre), cierra: aMin(h.cierra) }));
  if (negocio.feriados?.fechas.includes(fecha)) tramos.push({ abre: aMin(negocio.feriados.abre), cierra: aMin(negocio.feriados.cierra) });
  return tramos;
}

/** Soporta horarios que cruzan la medianoche (20:00 a 00:00, 19:30 a 01:00) y feriados. */
export function estaAbierto(negocio: Negocio, ahora = new Date()): boolean {
  const tz = negocio.zonaHoraria;
  const { dia, minutos } = partesLocales(ahora, tz);
  for (const t of tramosDelDia(negocio, fechaLocal(ahora, tz), dia)) {
    if (t.cierra > t.abre ? minutos >= t.abre && minutos < t.cierra : minutos >= t.abre) return true;
  }
  // tramo de ayer que sigue después de medianoche
  const ayer = new Date(ahora.getTime() - 86_400_000);
  for (const t of tramosDelDia(negocio, fechaLocal(ayer, tz), (dia + 6) % 7)) {
    if (t.cierra <= t.abre && minutos < t.cierra) return true;
  }
  return false;
}

export function textoHorarios(negocio: Negocio): string {
  const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const base = negocio.horarios.map((h) => `${h.dias.map((d) => nombres[d]).join(", ")}: ${h.abre} a ${h.cierra}`).join("; ");
  return negocio.feriados ? `${base}; feriados: ${negocio.feriados.abre} a ${negocio.feriados.cierra}` : base;
}

/** "hoy a las 20:00", "mañana a las 20:00", "el viernes a las 20:00" o null si no hay horarios. */
export function proximaApertura(negocio: Negocio, ahora = new Date()): string | null {
  const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const tz = negocio.zonaHoraria;
  const { dia, minutos } = partesLocales(ahora, tz);
  for (let d = 0; d < 8; d++) {
    const fecha = new Date(ahora.getTime() + d * 86_400_000);
    const diaSemana = (dia + d) % 7;
    const aperturas = tramosDelDia(negocio, fechaLocal(fecha, tz), diaSemana)
      .map((t) => t.abre)
      .filter((abre) => d > 0 || abre > minutos)
      .sort((a, b) => a - b);
    if (aperturas.length) {
      const cuando = d === 0 ? "hoy" : d === 1 ? "mañana" : `el ${nombres[diaSemana]}`;
      const hh = `${String(Math.floor(aperturas[0] / 60)).padStart(2, "0")}:${String(aperturas[0] % 60).padStart(2, "0")}`;
      return `${cuando} a las ${hh}`;
    }
  }
  return null;
}

/** Próxima vez que el reloj del local marca HH:MM (dentro de las próximas 24 h). */
export function proximaHoraLocal(hhmm: string, ahora: Date, tz: string): Date | null {
  const m = hhmm.trim().match(/^(\d{1,2})[:.hs ]*(\d{2})?\s*(?:hs?)?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59) return null;
  const { minutos } = partesLocales(ahora, tz);
  let diff = ((h % 24) * 60 + min) - minutos;
  if (diff <= 0) diff += 1440;
  const base = new Date(ahora);
  base.setUTCSeconds(0, 0);
  return new Date(base.getTime() + diff * 60_000);
}
