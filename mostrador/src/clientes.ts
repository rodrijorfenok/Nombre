import type { Menu, Negocio } from "./config.ts";
import type { Store } from "./db.ts";
import { pesos } from "./money.ts";
import { calcularTotales, type Entrega, type Pedido } from "./order.ts";

/**
 * Lo que el local ya sabe de un cliente por sus pedidos anteriores: cómo se llama, adónde se lo
 * mandaron la última vez y qué pidió. Con eso el bot lo atiende como a un conocido ("¿lo de siempre?").
 */
export interface FichaCliente {
  nombre?: string;
  /** pedidos anteriores que se concretaron */
  pedidos: number;
  ultimo?: Pedido;
  ultimaDireccion?: Entrega;
  /** promedio de las notas que dejó (1 a 5) */
  nota?: number;
}

/** Un pedido anterior "cuenta" si se confirmó y no se canceló. */
export function pedidoConcretado(p: Pedido): boolean {
  return Boolean(p.confirmadoEn) && p.estado !== "cancelado" && p.lineas.length > 0;
}

export function fichaCliente(store: Store, telefono: string, excluirId?: number): FichaCliente {
  const previos = store.pedidosDeTelefono(telefono, 30).filter((p) => p.id !== excluirId && pedidoConcretado(p));
  const notas = previos.map((p) => p.calificacion?.nota).filter((n): n is number => typeof n === "number");
  return {
    nombre: previos.find((p) => p.cliente)?.cliente,
    pedidos: previos.length,
    ultimo: previos[0],
    ultimaDireccion: previos.find((p) => p.entrega?.modo === "delivery" && p.entrega.direccion)?.entrega,
    nota: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : undefined,
  };
}

/** "2x Clásica (Simple, Coca-Cola), 1x Cono de papas" */
export function textoProductos(menu: Menu, negocio: Negocio, p: Pedido): string {
  try {
    return calcularTotales(menu, negocio, p)
      .lineas.map((d) => `${d.cantidad}x ${d.nombre}${d.opciones.length ? ` (${d.opciones.join(", ")})` : ""}${d.sin.length ? ` sin ${d.sin.join(", ")}` : ""}`)
      .join(", ");
  } catch {
    return "(productos que ya no están en la carta)";
  }
}

/** Texto para la IA (va como un bloque aparte del system prompt, fijo durante la charla). */
export function textoFicha(menu: Menu, negocio: Negocio, f: FichaCliente): string | undefined {
  if (!f.pedidos) return undefined;
  const tz = negocio.zonaHoraria;
  const out = ["# Este cliente ya nos compró antes"];
  if (f.nombre) out.push(`- Se llama ${f.nombre} (ya quedó cargado en el pedido; si dice otro nombre, actualizalo con datos_cliente).`);
  out.push(`- Pedidos anteriores: ${f.pedidos}.`);
  if (f.ultimo) {
    const cuando = new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "numeric" }).format(new Date(f.ultimo.confirmadoEn ?? f.ultimo.creadoEn));
    let total = "";
    try {
      total = ` (${pesos(calcularTotales(menu, negocio, f.ultimo).total)} en ese momento)`;
    } catch {}
    const entrega = f.ultimo.entrega?.modo === "delivery" ? "delivery" : "take away";
    out.push(`- Último pedido, el ${cuando}: ${textoProductos(menu, negocio, f.ultimo)}. ${entrega}, pagó ${f.ultimo.pago?.metodo ?? "-"}${total}.`);
  }
  if (f.ultimaDireccion?.direccion) {
    const z = negocio.delivery.zonas.find((x) => x.id === f.ultimaDireccion?.zonaId);
    out.push(
      `- Última dirección de delivery: ${f.ultimaDireccion.direccion}${f.ultimaDireccion.entreCalles ? ` (entre ${f.ultimaDireccion.entreCalles})` : ""}${z ? `, ${z.nombre}` : ""}.`,
    );
  }
  if (f.nota !== undefined && f.nota < 3.5) out.push(`- Ojo: la última vez no quedó conforme (nota ${f.nota.toFixed(1)} de 5). Atendelo con especial cuidado.`);
  out.push(
    'Cómo usarlo: tratalo como a un cliente conocido, sin exagerar ni recitarle estos datos. Si pide "lo de siempre", "lo mismo que la otra vez" o "repetime el último", usá repetir_pedido_anterior y contale en una línea qué quedó cargado. Si es delivery, preguntá si va a la misma dirección de la vez pasada en vez de pedírsela de cero; si dice que sí, repetir_pedido_anterior con productos=false y entrega=true. Los precios pueden haber cambiado: el total sale siempre de las herramientas.',
  );
  return out.join("\n");
}
