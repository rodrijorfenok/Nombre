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
  /** cambiar un ingrediente por otro que el local ya usa: "cebolla caramelizada" → "cebolla brunoise" */
  reemplazos?: Reemplazo[];
  /** 0/undefined = pedido original; 1, 2… = agregado después de que entró a cocina */
  tanda?: number;
  /** precio unitario congelado al cargar la línea: si el local cambia precios, los pedidos en curso no cambian */
  precioUnitario?: number;
}

export interface Reemplazo {
  quitar: string;
  poner: string;
}

export interface Entrega {
  modo: "delivery" | "take_away";
  direccion?: string;
  entreCalles?: string;
  referencias?: string;
  zonaId?: string;
}

export interface Pago {
  /** mixto = una parte en efectivo (montoEfectivo) y el resto por transferencia */
  metodo: "transferencia" | "efectivo" | "mixto";
  /** billete con el que paga la parte en efectivo, para llevar el vuelto */
  pagaCon?: number;
  /** solo mixto: cuánto paga en efectivo */
  montoEfectivo?: number;
}

/** Productos sumados a un pedido que ya estaba en cocina. */
export interface Agregado {
  tanda: number;
  /** ISO */
  en: string;
  monto: number;
  pago: "efectivo" | "transferencia";
  /** transferencia acreditada (en efectivo se cobra al entregar) */
  pagado: boolean;
  /** pagos parciales por transferencia de este agregado */
  pagadoParcial?: number;
  /** ya se mandó la comanda de este agregado a cocina */
  comandaEnviada: boolean;
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
  /** ISO: cuándo entró a cocina (para el plazo en que se le pueden sumar cosas) */
  enCocinaDesde?: string;
  agregados?: Agregado[];
  /** ISO: la cocina avisó al cliente que faltan ~5 minutos */
  avisoCasiListo?: string;
  /** ISO: el cliente pidió que esté para esa hora (pedido programado) */
  programadoPara?: string;
  /** cuándo pasó cada cosa (para medir cuánto tarda la cocina de verdad) */
  tiempos?: { listo?: string; enCamino?: string; entregado?: string };
  /** avisos automáticos ya mandados (cada uno una sola vez) */
  avisos?: { recordatorioPago?: string; sinPago?: string; atraso?: string; pedidoCalificacion?: string };
  /** nota del cliente después de recibirlo (1 a 5) */
  calificacion?: { nota: number; en: string };
  /** lo cerró el sistema porque quedó abierto de un día anterior */
  cerradoAutomatico?: boolean;
  proximaLinea: number;
}

/** Hora a la que la cocina tiene que tenerlo listo: la prometida, menos el viaje si es delivery. */
export function horaObjetivoCocina(negocio: Negocio, pedido: Pedido): Date | null {
  if (!pedido.horaEstimada) return null;
  const viaje =
    pedido.entrega?.modo === "delivery" ? (negocio.delivery.zonas.find((z) => z.id === pedido.entrega?.zonaId)?.minutos ?? 20) : 0;
  return new Date(new Date(pedido.horaEstimada).getTime() - viaje * 60_000);
}

/** Unidades que hay que preparar (para la comanda y el panel). */
export function unidades(pedido: Pedido, tanda?: number): number {
  return pedido.lineas.filter((l) => tanda === undefined || (l.tanda ?? 0) === tanda).reduce((a, l) => a + l.cantidad, 0);
}

/** Datos de una línea para volver a cargarla tal cual (repetir un pedido anterior). */
export function lineaComoInput(menu: Menu, l: LineaPedido): LineaInput {
  const p = menu.productos.find((x) => x.id === l.productoId);
  return {
    producto_id: l.productoId,
    cantidad: l.cantidad,
    opciones: Object.entries(l.opciones)
      .filter(([grupo]) => !p || p.opciones.some((g) => g.grupo === grupo))
      .map(([grupo, valor]) => ({ grupo, valor })),
    extras: l.extras,
    sin_ingredientes: l.sinIngredientes,
    observacion: l.observacion,
    reemplazos: l.reemplazos,
  };
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
  reemplazos?: { quitar: string; poner: string }[];
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

/** Ingredientes con los que trabaja el local (los de toda la carta). */
export function ingredientesDelLocal(menu: Menu): string[] {
  return [...new Set(menu.productos.flatMap((p) => p.ingredientes))];
}

function resolverReemplazos(menu: Menu, p: Producto, input: { quitar: string; poner: string }[] = []): Reemplazo[] {
  return input.map(({ quitar, poner }) => {
    const sacar = p.ingredientes.find((i) => normalizar(i) === normalizar(quitar)) ?? p.ingredientes.find((i) => normalizar(i).includes(normalizar(quitar)));
    if (!sacar) {
      throw new ErrorPedido(
        p.ingredientes.length
          ? `"${p.nombre}" no lleva "${quitar}". Ingredientes: ${p.ingredientes.join(", ")}.`
          : `"${p.nombre}" no tiene ingredientes cargados: anotá el pedido en observacion.`,
      );
    }
    const delLocal = ingredientesDelLocal(menu);
    const nuevo = delLocal.find((i) => normalizar(i) === normalizar(poner)) ?? delLocal.find((i) => normalizar(i).includes(normalizar(poner)));
    if (!nuevo) {
      throw new ErrorPedido(
        `El local no trabaja con "${poner}", así que no se puede hacer ese cambio. Ingredientes que sí hay: ${delLocal.join(", ")}. Si el cliente insiste, derivar_a_humano.`,
      );
    }
    if (normalizar(nuevo) === normalizar(sacar)) throw new ErrorPedido(`"${sacar}" ya viene en "${p.nombre}": no hace falta cambiarlo.`);
    return { quitar: sacar, poner: nuevo };
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
  const reemplazos = resolverReemplazos(menu, p, input.reemplazos);
  if (reemplazos.length) linea.reemplazos = reemplazos;
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
  reemplazos?: { quitar: string; poner: string }[];
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
  if (c.reemplazos) {
    const r = resolverReemplazos(menu, p, c.reemplazos);
    l.reemplazos = r.length ? r : undefined;
  }
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
  cambios: Reemplazo[];
  observacion: string;
  tanda: number;
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
    cambios: l.reemplazos ?? [],
    observacion: l.observacion,
    tanda: l.tanda ?? 0,
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
  for (const c of d.cambios) partes.push(`   Cambio: ${c.quitar} → ${c.poner}`);
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
  if (pedido.pago) out.push(`💳 Pago: ${textoPago(menu, negocio, pedido)}`);
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
  if (!pedido.pago) f.push("medio de pago (transferencia, efectivo o una parte de cada uno)");
  if (pedido.pago && pedido.pago.metodo !== "transferencia") {
    const total = calcularTotales(menu, negocio, pedido).total;
    if (pedido.pago.metodo === "mixto") {
      const ef = pedido.pago.montoEfectivo ?? 0;
      if (!(ef > 0)) f.push("cuánto paga en efectivo (el resto va por transferencia)");
      else if (ef >= total) f.push(`la parte en efectivo (${pesos(ef)}) cubre todo el total ${pesos(total)}: entonces es pago en efectivo, no mixto`);
    }
    const efectivo = cuentas(menu, negocio, pedido).efectivo;
    if (pedido.pago.pagaCon !== undefined && pedido.pago.pagaCon < efectivo) f.push(`el billete con el que paga (${pesos(pedido.pago.pagaCon)}) no cubre lo que paga en efectivo ${pesos(efectivo)}`);
  }
  return f;
}

export interface Cuentas {
  total: number;
  /** total del pedido original (sin agregados) */
  base: number;
  /** parte del pedido original que se paga por transferencia */
  transferenciaBase: number;
  /** todo lo que se cobra en efectivo al entregar o retirar (original + agregados en efectivo) */
  efectivo: number;
  /** agregados por transferencia que todavía no se acreditaron */
  agregadosPorTransferir: Agregado[];
}

/** Cuánto se paga de cada forma. Es la única fuente de esos montos. */
export function cuentas(menu: Menu, negocio: Negocio, pedido: Pedido): Cuentas {
  const total = calcularTotales(menu, negocio, pedido).total;
  const agregados = pedido.agregados ?? [];
  const base = total - agregados.reduce((a, x) => a + x.monto, 0);
  const m = pedido.pago?.metodo;
  const efectivoBase = m === "efectivo" ? base : m === "mixto" ? Math.min(base, pedido.pago?.montoEfectivo ?? 0) : 0;
  const transferenciaBase = m === "transferencia" || m === "mixto" ? base - efectivoBase : 0;
  const efectivoAgregados = agregados.filter((a) => a.pago === "efectivo").reduce((s, a) => s + a.monto, 0);
  return {
    total,
    base,
    transferenciaBase,
    efectivo: efectivoBase + efectivoAgregados,
    agregadosPorTransferir: agregados.filter((a) => a.pago === "transferencia" && !a.pagado),
  };
}

/** "Transferencia", "Efectivo (paga con $X, vuelto $Y)", "Transferencia $X + efectivo $Y"… */
export function textoPago(menu: Menu, negocio: Negocio, pedido: Pedido): string {
  if (!pedido.pago) return "sin definir";
  const c = cuentas(menu, negocio, pedido);
  const vuelto = pedido.pago.pagaCon && pedido.pago.pagaCon > c.efectivo ? ` (paga con ${pesos(pedido.pago.pagaCon)}, vuelto ${pesos(pedido.pago.pagaCon - c.efectivo)})` : "";
  switch (pedido.pago.metodo) {
    case "transferencia":
      return "Transferencia";
    case "efectivo":
      return `Efectivo${vuelto}`;
    case "mixto":
      return `Transferencia ${pesos(c.transferenciaBase)} + efectivo ${pesos(pedido.pago.montoEfectivo ?? 0)}${vuelto}`;
  }
}
