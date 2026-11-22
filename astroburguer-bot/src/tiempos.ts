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

/** Soporta horarios que cruzan la medianoche (19:30 a 00:30). */
export function estaAbierto(negocio: Negocio, ahora = new Date()): boolean {
  const { dia, minutos } = partesLocales(ahora, negocio.zonaHoraria);
  for (const h of negocio.horarios) {
    const abre = aMin(h.abre);
    const cierra = aMin(h.cierra);
    if (cierra > abre) {
      if (h.dias.includes(dia) && minutos >= abre && minutos < cierra) return true;
    } else {
      // cruza medianoche: tramo del mismo día desde "abre", y tramo del día siguiente hasta "cierra"
      if (h.dias.includes(dia) && minutos >= abre) return true;
      const ayer = (dia + 6) % 7;
      if (h.dias.includes(ayer) && minutos < cierra) return true;
    }
  }
  return false;
}

export function textoHorarios(negocio: Negocio): string {
  const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return negocio.horarios.map((h) => `${h.dias.map((d) => nombres[d]).join(", ")}: ${h.abre} a ${h.cierra}`).join("; ");
}
