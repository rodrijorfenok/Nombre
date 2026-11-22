import assert from "node:assert/strict";
import { test } from "node:test";
import { comandaTexto } from "../src/comanda.ts";
import { evaluarComprobante, type DatosComprobante } from "../src/comprobantes.ts";
import { cargarConfig } from "../src/config.ts";
import { agregarLinea, calcularTotales, ErrorPedido, faltantes, modificarLinea, pedidoNuevo, resumenCliente } from "../src/order.ts";
import { estaAbierto, estimarEspera } from "../src/tiempos.ts";

const { menu, negocio } = cargarConfig("clientes/astroburguer");

test("suma precios con opciones, extras y cantidad", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, {
    producto_id: "astro-clasica",
    cantidad: 2,
    opciones: [{ grupo: "tamaño", valor: "doble" }],
    extras: ["bacon"],
    sin_ingredientes: ["cebolla"],
  });
  agregarLinea(menu, p, { producto_id: "pizza-muzza", opciones: [{ grupo: "tamano", valor: "Chica (4 porciones)" }], observacion: "con piso" });
  agregarLinea(menu, p, { producto_id: "coca-15", opciones: [{ grupo: "sabor", valor: "zero" }] });
  const t = calcularTotales(menu, negocio, p);
  assert.equal(t.lineas[0].precioUnitario, 9500 + 2500 + 1500);
  assert.equal(t.lineas[0].subtotal, 27000);
  assert.equal(t.lineas[1].subtotal, 6500);
  assert.equal(t.subtotal, 27000 + 6500 + 4000);
  assert.equal(t.total, t.subtotal);

  p.entrega = { modo: "delivery", direccion: "Calle 123", zonaId: "z2" };
  assert.equal(calcularTotales(menu, negocio, p).total, 37500 + 2500);
  const r = resumenCliente(menu, negocio, p);
  assert.match(r, /TOTAL: \$40\.000/);
  assert.match(r, /Sin: cebolla/);
  assert.match(r, /Obs: con piso/);
});

test("pide opciones obligatorias y rechaza extras no permitidos", () => {
  const p = pedidoNuevo("1");
  assert.throws(() => agregarLinea(menu, p, { producto_id: "mila-napolitana" }), (e: Error) => e instanceof ErrorPedido && /carne.*guarnici/.test(e.message));
  assert.throws(
    () => agregarLinea(menu, p, { producto_id: "big-bang", extras: ["medallon-extra"] }),
    (e: Error) => e instanceof ErrorPedido && /no se puede agregar/.test(e.message),
  );
  assert.throws(() => agregarLinea(menu, p, { producto_id: "inexistente" }), ErrorPedido);
  assert.equal(p.lineas.length, 0);
});

test("modificar línea conserva opciones no tocadas", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, {
    producto_id: "mila-napolitana",
    opciones: [
      { grupo: "carne", valor: "pollo" },
      { grupo: "guarnición", valor: "papas" },
    ],
  });
  modificarLinea(menu, p, { linea: 1, opciones: [{ grupo: "guarnicion", valor: "pure" }], cantidad: 3 });
  const d = calcularTotales(menu, negocio, p).lineas[0];
  assert.deepEqual(d.opciones, ["Pollo", "Puré"]);
  assert.equal(d.subtotal, (13500 - 500) * 3);
});

test("faltantes para confirmar, incluido pedido mínimo", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, { producto_id: "agua" });
  p.entrega = { modo: "delivery" };
  const f = faltantes(menu, negocio, p).join(" | ");
  assert.match(f, /nombre/);
  assert.match(f, /dirección/);
  assert.match(f, /zona/);
  assert.match(f, /pedido mínimo/);
  assert.match(f, /medio de pago/);
});

test("tiempo de espera: categoría más lenta + volumen + cola + viaje", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, { producto_id: "doble-orbita", cantidad: 3 });
  agregarLinea(menu, p, {
    producto_id: "mila-clasica",
    cantidad: 2,
    opciones: [
      { grupo: "carne", valor: "ternera" },
      { grupo: "guarnición", valor: "papas" },
    ],
  });
  agregarLinea(menu, p, { producto_id: "coca-15", opciones: [{ grupo: "sabor", valor: "original" }] });
  p.entrega = { modo: "delivery", zonaId: "z2" };
  // prep 20 (milanesa) + volumen (5-3)*1.5=3 + cola floor(9/4)=2 tandas*12=24 + demora 5 + viaje 18 = 70
  const e = estimarEspera(menu, negocio, p, 9, 5, new Date("2026-11-22T00:00:00Z"));
  assert.equal(e.minutosCocina, 52);
  assert.equal(e.minutosViaje, 18);
  assert.deepEqual(e.rango, [70, 80]);

  const takeAway = pedidoNuevo("2");
  agregarLinea(menu, takeAway, { producto_id: "astro-clasica", opciones: [{ grupo: "tamaño", valor: "simple" }] });
  takeAway.entrega = { modo: "take_away" };
  assert.deepEqual(estimarEspera(menu, negocio, takeAway, 0).rango, [15, 25]);
});

test("horario que cruza la medianoche", () => {
  // Horario: mar a dom 19:30–00:30 (hora argentina, UTC-3)
  assert.equal(estaAbierto(negocio, new Date("2026-11-22T00:00:00Z")), true, "sábado 21:00");
  assert.equal(estaAbierto(negocio, new Date("2026-11-23T03:15:00Z")), true, "lunes 00:15 (sigue el turno del domingo)");
  assert.equal(estaAbierto(negocio, new Date("2026-11-23T03:45:00Z")), false, "lunes 00:45");
  assert.equal(estaAbierto(negocio, new Date("2026-11-23T23:00:00Z")), false, "lunes 20:00, cerrado");
  assert.equal(estaAbierto(negocio, new Date("2026-11-22T18:00:00Z")), false, "domingo 15:00");
});

test("comanda muestra modificaciones para cocina", () => {
  const p = pedidoNuevo("5491111111111");
  p.id = 12;
  p.cliente = "Juan";
  agregarLinea(menu, p, { producto_id: "pizza-napo", opciones: [{ grupo: "tamaño", valor: "grande" }], observacion: "con piso" });
  agregarLinea(menu, p, { producto_id: "astro-clasica", opciones: [{ grupo: "tamaño", valor: "simple" }], sin_ingredientes: ["tomate"], observacion: "poca cebolla" });
  p.entrega = { modo: "delivery", direccion: "Mitre 500", entreCalles: "Belgrano y Sarmiento", zonaId: "z1" };
  p.pago = { metodo: "efectivo", pagaCon: 30000 };
  p.observacionGeneral = "tocar timbre 2B";
  const c = comandaTexto(menu, negocio, p);
  assert.match(c, /COMANDA #0012/);
  assert.match(c, /OBS: con piso/);
  assert.match(c, /SIN: TOMATE/);
  assert.match(c, /OBS: poca cebolla/);
  assert.match(c, /tocar timbre 2B/);
  assert.match(c, /COBRAR \$23\.000.*vuelto \$7\.000/);
});

const base: DatosComprobante = {
  es_comprobante: true,
  legible: true,
  monto: 25000,
  fecha_hora: "2026-11-21T21:10",
  destinatario_nombre: negocio.pago.titular,
  destinatario_alias_cvu: null,
  origen_nombre: "Juan Pérez",
  numero_operacion: "123456789",
  entidad: "Mercado Pago",
  estado: "Aprobada",
  signos_de_edicion: false,
  observaciones: "",
};
const opts = { total: 25000, negocio, pedidoCreadoEn: new Date("2026-11-22T00:05:00Z"), ahora: new Date("2026-11-22T00:12:00Z") };

test("comprobante válido se aprueba", () => {
  assert.equal(evaluarComprobante(base, opts).veredicto, "aprobado");
  assert.equal(evaluarComprobante({ ...base, destinatario_nombre: null, destinatario_alias_cvu: negocio.pago.alias.toLowerCase() }, opts).veredicto, "aprobado");
});

test("comprobante con monto menor, otra cuenta, viejo o duplicado se rechaza", () => {
  // monto corto pero comprobante válido: pago parcial, se espera el resto
  const menor = evaluarComprobante({ ...base, monto: 20000 }, opts);
  assert.equal(menor.veredicto, "parcial");
  assert.match(menor.mensajeCliente, /faltan \*\$5\.000\*/i);
  // monto corto Y a otra cuenta: rechazado
  assert.equal(evaluarComprobante({ ...base, monto: 20000, destinatario_nombre: "Pedro Gómez" }, opts).veredicto, "rechazado");
  assert.equal(evaluarComprobante({ ...base, destinatario_nombre: "Pedro Gómez" }, opts).veredicto, "rechazado");
  assert.equal(evaluarComprobante({ ...base, fecha_hora: "2026-11-10T21:10" }, opts).veredicto, "rechazado");
  assert.equal(evaluarComprobante(base, { ...opts, operacionDuplicada: true }).veredicto, "rechazado");
  assert.equal(evaluarComprobante({ ...base, es_comprobante: false }, opts).veredicto, "rechazado");
});

test("comprobante dudoso pasa a revisión humana", () => {
  assert.equal(evaluarComprobante({ ...base, signos_de_edicion: true }, opts).veredicto, "revisar");
  assert.equal(evaluarComprobante({ ...base, estado: "En proceso" }, opts).veredicto, "revisar");
  assert.equal(evaluarComprobante({ ...base, monto: null }, opts).veredicto, "revisar");
  assert.equal(evaluarComprobante(null, opts).veredicto, "revisar");
});
