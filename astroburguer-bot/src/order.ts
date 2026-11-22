import type { Menu, Negocio, Producto } from "./config.ts";
import { normalizar, pesos } from "./money.ts";

export type EstadoPedido =
  | "armando"
  | "esperando_pago"
  | "pago_en_revision"
  | "en_cocina"
  | "listo"
  | "en_camino"
  | "entregado"
  | "cancelado";

export const ESTADOS_ACTIVOS: EstadoPedido[] = ["esperando_pago", "pago_en_revision", "en_cocina", "listo", "en_camino"];

export interface LineaPedido {
  linea: number;
  productoId: string;
  cantidad: number;
  /** grupo -> id del valor elegido */
  opciones: Record<string, string>;
  extras: string[];
  sinIngredientes: string[];
  observacion: string;
  /** precio unitario congelado al cargar la línea: si el local cambia precios, los pedidos en curso no cambian */
  precioUnitario?: number;
}

export interface Entrega {
  modo: "delivery" | "take_away";
  direccion?: string;
  entreCalles?: string;
  referencias?: string;
  zonaId?: string;
}

export interface Pago {
  metodo: "transferencia" | "efectivo";
  pagaCon?: number;
}

export interface Pedido {
  id?: number;
  telefono: string;
  cliente?: string;
  lineas: LineaPedido[];
  entrega?: Entrega;
  pago?: Pago;
  observacionGeneral?: string;
  estado: EstadoPedido;
  creadoEn: string;
  confirmadoEn?: string;
  /** ISO, hora estimada de entrega/retiro calculada al confirmar */
  horaEstimada?: string;
  minutosEstimados?: [number, number];
  pagoVerificado?: boolean;
  proximaLinea: number;
}

export function pedidoNuevo(telefono: string, ahora = new Date()): Pedido {
  return { telefono, lineas: [], estado: "armando", creadoEn: ahora.toISOString(), proximaLinea: 1 };
}

export class ErrorPedido extends Error {}

export interface LineaInput {
  producto_id: string;
  cantidad?: number;
  opciones?: { grupo: string; valor: string }[];
  extras?: string[];
  sin_ingredientes?: string[];
  observacion?: string;
}

function buscarProducto(menu: Menu, id: string): Producto {
  const p = menu.productos.find((x) => x.id === id);
  if (!p) throw new ErrorPedido(`No existe el producto "${id}". Usá ver_menu para ver los ids válidos.`);
  if (!p.disponible) throw new ErrorPedido(`"${p.nombre}" está AGOTADO hoy. Ofrecé una alternativa parecida.`);
  return p;
}

function resolverOpciones(p: Producto, input: { grupo: string; valor: string }[] = [], previas: Record<string, string> = {}) {
  const res: Record<string, string> = { ...previas };
  for (const { grupo, valor } of input) {
    const g = p.opciones.find((x) => normalizar(x.grupo) === normalizar(grupo));
    if (!g) {
      throw new ErrorPedido(
        `"${p.nombre}" no tiene la opción "${grupo}". Opciones disponibles: ${p.opciones.map((o) => o.grupo).join(", ") || "ninguna"}.`,
      );
    }
    const v = g.valores.find((x) => x.id === valor || normalizar(x.nombre) === normalizar(valor));
    if (!v) {
      throw new ErrorPedido(
        `Valor "${valor}" inválido para ${g.grupo} de "${p.nombre}". Valores: ${g.valores.map((x) => `${x.id} (${x.nombre})`).join(", ")}.`,
      );
    }
    res[g.grupo] = v.id;
  }
  const faltan = p.opciones.filter((g) => !res[g.grupo]);
  if (faltan.length) {
    throw new ErrorPedido(
      `Falta elegir ${faltan
        .map((g) => `${g.grupo} (${g.valores.map((v) => `${v.id}: ${v.nombre}${v.precio ? ` ${v.precio > 0 ? "+" : ""}${pesos(v.precio)}` : ""}`).join(" / ")})`)
        .join(" y ")} para "${p.nombre}". Preguntale al cliente.`,
    );
  }
  return res;
}

function resolverExtras(menu: Menu, p: Producto, extras: string[] = []) {
  return extras.map((e) => {
    const ex = menu.extras.find((x) => x.id === e || normalizar(x.nombre) === normalizar(e));
    if (ex && !ex.disponible) throw new ErrorPedido(`El extra "${ex.nombre}" está agotado hoy.`);
    if (!ex || !p.extras.includes(ex.id)) {
      const permitidos = p.extras.map((id) => menu.extras.find((x) => x.id === id)!).map((x) => `${x.id} (${x.nombre} ${pesos(x.precio)})`);
      throw new ErrorPedido(`El extra "${e}" no se puede agregar a "${p.nombre}". Extras posibles: ${permitidos.join(", ") || "ninguno"}.`);
    }
    return ex.id;
  });
}

export function agregarLinea(menu: Menu, pedido: Pedido, input: LineaInput): LineaPedido {
  const p = buscarProducto(menu, input.producto_id);
  const cantidad = input.cantidad ?? 1;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw new ErrorPedido("La cantidad debe ser un entero entre 1 y 50.");
  const linea: LineaPedido = {
    linea: pedido.proximaLinea++,
    productoId: p.id,
    cantidad,
    opciones: resolverOpciones(p, input.opciones),
    extras: resolverExtras(menu, p, input.extras),
    sinIngredientes: (input.sin_ingredientes ?? []).map((s) => s.trim()).filter(Boolean),
    observacion: (input.observacion ?? "").trim(),
  };
  linea.precioUnitario = calcularUnitario(menu, linea);
  pedido.lineas.push(linea);
  return linea;
}

export interface CambiosLinea {
  linea: number;
  cantidad?: number;
  opciones?: { grupo: string; valor: string }[];
  extras?: string[];
  sin_ingredientes?: string[];
  observacion?: string;
}

/** Los campos enviados reemplazan a los actuales; los omitidos quedan igual. */
export function modificarLinea(menu: Menu, pedido: Pedido, c: CambiosLinea): LineaPedido {
  const l = pedido.lineas.find((x) => x.linea === c.linea);
  if (!l) throw new ErrorPedido(`No existe la línea ${c.linea} en el pedido.`);
  const p = buscarProducto(menu, l.productoId);
  if (c.cantidad !== undefined) {
    if (!Number.isInteger(c.cantidad) || c.cantidad < 1 || c.cantidad > 50) throw new ErrorPedido("La cantidad debe ser un entero entre 1 y 50.");
    l.cantidad = c.cantidad;
  }
  if (c.opciones) l.opciones = resolverOpciones(p, c.opciones, l.opciones);
  if (c.extras) l.extras = resolverExtras(menu, p, c.extras);
  if (c.sin_ingredientes) l.sinIngredientes = c.sin_ingredientes.map((s) => s.trim()).filter(Boolean);
  if (c.observacion !== undefined) l.observacion = c.observacion.trim();
  if (c.opciones || c.extras) l.precioUnitario = calcularUnitario(menu, l);
  return l;
}

export function quitarLinea(pedido: Pedido, linea: number) {
  const i = pedido.lineas.findIndex((x) => x.linea === linea);
  if (i < 0) throw new ErrorPedido(`No existe la línea ${linea} en el pedido.`);
  pedido.lineas.splice(i, 1);
}

export interface DetalleLinea {
  linea: number;
  cantidad: number;
  nombre: string;
  categoria: string;
  opciones: string[];
  extras: { nombre: string; precio: number }[];
  sin: string[];
  observacion: string;
  precioUnitario: number;
  subtotal: number;
}

export interface Totales {
  lineas: DetalleLinea[];
  subtotal: number;
  envio: number;
  total: number;
  zona?: { id: string; nombre: string; costo: number; minutos: number };
}

function calcularUnitario(menu: Menu, l: LineaPedido): number {
  return detalleLinea(menu, { ...l, precioUnitario: undefined }).precioUnitario;
}

export function detalleLinea(menu: Menu, l: LineaPedido): DetalleLinea {
  const p = menu.productos.find((x) => x.id === l.productoId);
  if (!p) throw new ErrorPedido(`Producto ${l.productoId} ya no existe en el menú.`);
  let unit = p.precio;
  const opciones: string[] = [];
  for (const g of p.opciones) {
    const v = g.valores.find((x) => x.id === l.opciones[g.grupo]);
    if (v) {
      unit += v.precio;
      opciones.push(v.nombre);
    }
  }
  const extras = l.extras.map((id) => {
    const e = menu.extras.find((x) => x.id === id)!;
    unit += e.precio;
    return { nombre: e.nombre, precio: e.precio };
  });
  if (l.precioUnitario !== undefined) unit = l.precioUnitario;
  return {
    linea: l.linea,
    cantidad: l.cantidad,
    nombre: p.nombre,
    categoria: p.categoria,
    opciones,
    extras,
    sin: l.sinIngredientes,
    observacion: l.observacion,
    precioUnitario: unit,
    subtotal: unit * l.cantidad,
  };
}

export function calcularTotales(menu: Menu, negocio: Negocio, pedido: Pedido): Totales {
  const lineas = pedido.lineas.map((l) => detalleLinea(menu, l));
  const subtotal = lineas.reduce((a, l) => a + l.subtotal, 0);
  let envio = 0;
  let zona: Totales["zona"];
  if (pedido.entrega?.modo === "delivery" && pedido.entrega.zonaId) {
    const z = negocio.delivery.zonas.find((x) => x.id === pedido.entrega!.zonaId);
    if (z) {
      envio = z.costo;
      zona = { id: z.id, nombre: z.nombre, costo: z.costo, minutos: z.minutos };
    }
  }
  return { lineas, subtotal, envio, total: subtotal + envio, zona };
}

export function textoLinea(d: DetalleLinea): string {
  const partes = [`${d.cantidad}x ${d.nombre}${d.opciones.length ? ` (${d.opciones.join(", ")})` : ""}`];
  for (const e of d.extras) partes.push(`   + ${e.nombre} ${pesos(e.precio)}`);
  if (d.sin.length) partes.push(`   Sin: ${d.sin.join(", ")}`);
  if (d.observacion) partes.push(`   Obs: ${d.observacion}`);
  partes.push(`   ${d.cantidad > 1 ? `${d.cantidad} x ${pesos(d.precioUnitario)} = ` : ""}${pesos(d.subtotal)}`);
  return partes.join("\n");
}

/** Resumen detallado para el cliente. Es la fuente de verdad del total. */
export function resumenCliente(menu: Menu, negocio: Negocio, pedido: Pedido): string {
  const t = calcularTotales(menu, negocio, pedido);
  if (!t.lineas.length) return "El pedido está vacío.";
  const out: string[] = [];
  out.push(`🧾 *Pedido${pedido.id ? ` #${pedido.id}` : ""} — ${negocio.nombre}*`);
  out.push("");
  for (const d of t.lineas) out.push(`[${d.linea}] ${textoLinea(d)}`);
  out.push("");
  out.push(`Subtotal: ${pesos(t.subtotal)}`);
  if (pedido.entrega?.modo === "delivery") {
    out.push(t.zona ? `Envío (${t.zona.nombre}): ${pesos(t.envio)}` : "Envío: falta indicar la zona");
  } else if (pedido.entrega?.modo === "take_away") {
    out.push("Retiro en el local (take away): sin costo");
  }
  out.push(`*TOTAL: ${pesos(t.total)}*`);
  if (pedido.observacionGeneral) out.push(`\nObservaciones: ${pedido.observacionGeneral}`);
  if (pedido.entrega?.modo === "delivery" && pedido.entrega.direccion) {
    out.push(`\n📍 ${pedido.entrega.direccion}${pedido.entrega.entreCalles ? ` (entre ${pedido.entrega.entreCalles})` : ""}`);
    if (pedido.entrega.referencias) out.push(`   ${pedido.entrega.referencias}`);
  }
  if (pedido.pago) {
    out.push(
      `💳 Pago: ${pedido.pago.metodo === "transferencia" ? "Transferencia" : "Efectivo"}${
        pedido.pago.metodo === "efectivo" && pedido.pago.pagaCon ? ` (paga con ${pesos(pedido.pago.pagaCon)}, vuelto ${pesos(pedido.pago.pagaCon - t.total)})` : ""
      }`,
    );
  }
  return out.join("\n");
}

/** Lista lo que falta para poder confirmar. Vacía = listo. */
export function faltantes(menu: Menu, negocio: Negocio, pedido: Pedido): string[] {
  const f: string[] = [];
  if (!pedido.lineas.length) f.push("agregar al menos un producto");
  if (!pedido.cliente) f.push("nombre del cliente");
  if (!pedido.entrega) f.push("elegir delivery o take away");
  if (pedido.entrega?.modo === "delivery") {
    if (!pedido.entrega.direccion) f.push("dirección de entrega");
    if (!pedido.entrega.zonaId) f.push("zona de delivery");
    const t = calcularTotales(menu, negocio, pedido);
    if (t.subtotal < negocio.delivery.pedidoMinimo) {
      f.push(`el pedido mínimo para delivery es ${pesos(negocio.delivery.pedidoMinimo)} (hoy suma ${pesos(t.subtotal)})`);
    }
  }
  if (!pedido.pago) f.push("medio de pago (transferencia o efectivo)");
  if (pedido.pago?.metodo === "efectivo") {
    const t = calcularTotales(menu, negocio, pedido);
    if (pedido.pago.pagaCon !== undefined && pedido.pago.pagaCon < t.total) f.push(`el monto con el que paga (${pesos(pedido.pago.pagaCon)}) no cubre el total ${pesos(t.total)}`);
  }
  return f;
}
