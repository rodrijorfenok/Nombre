import assert from "node:assert/strict";
import { test } from "node:test";
import { buscarItem } from "../src/catalogo.ts";
import { cargarConfig } from "../src/config.ts";
import { agregarLinea, calcularTotales, pedidoNuevo } from "../src/order.ts";

const { menu, negocio } = cargarConfig("clientes/comidas-jn");

test("Comidas JN: precios iguales a la carta", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, { producto_id: "super-americana", opciones: [{ grupo: "tamaño", valor: "doble" }] }); // 13.500
  agregarLinea(menu, p, { producto_id: "cuarto-de-libra", opciones: [{ grupo: "tamaño", valor: "triple" }] }); // 14.500
  agregarLinea(menu, p, { producto_id: "clasica", opciones: [{ grupo: "tamaño", valor: "simple" }], sin_ingredientes: ["tomate"] }); // 11.500
  agregarLinea(menu, p, { producto_id: "promo-1", opciones: [{ grupo: "pizza especial", valor: "calabresa" }], observacion: "la calabresa con piso" }); // 22.000
  agregarLinea(menu, p, { producto_id: "promo-2" }); // 27.000
  agregarLinea(menu, p, { producto_id: "pizza-jn" }); // 15.000
  agregarLinea(menu, p, { producto_id: "pizza-muzzarella" }); // 9.500
  agregarLinea(menu, p, { producto_id: "napo-familiar" }); // 28.000
  agregarLinea(menu, p, { producto_id: "milas-con-fritas", opciones: [{ grupo: "variedad", valor: "morron" }] }); // 24.000
  agregarLinea(menu, p, { producto_id: "papas-grande", extras: ["cheddar", "bacon"] }); // 10.000 + 5.000
  const t = calcularTotales(menu, negocio, p);
  assert.deepEqual(
    t.lineas.map((l) => l.subtotal),
    [13500, 14500, 11500, 22000, 27000, 15000, 9500, 28000, 24000, 15000],
  );
  assert.equal(t.subtotal, 180000);
});

test("Comidas JN: la promo 1 exige elegir la pizza especial y las milanesas la variedad", () => {
  assert.throws(() => agregarLinea(menu, pedidoNuevo("1"), { producto_id: "promo-1" }), /pizza especial/);
  assert.throws(() => agregarLinea(menu, pedidoNuevo("1"), { producto_id: "milas-con-fritas" }), /variedad/);
  assert.throws(() => agregarLinea(menu, pedidoNuevo("1"), { producto_id: "clasica", opciones: [{ grupo: "tamaño", valor: "simple" }], extras: ["bacon"] }), /no se puede agregar/);
});

test("Comidas JN: el local encuentra los productos por apodo para cambiar precios", () => {
  assert.deepEqual(buscarItem(menu, "jyq").map((i) => i.id), ["pizza-jamon-y-queso"]);
  assert.deepEqual(buscarItem(menu, "comen 2").map((i) => i.id), ["napo-comen-2"]);
  assert.deepEqual(buscarItem(menu, "americana").map((i) => i.id), ["super-americana"]);
  assert.deepEqual(buscarItem(menu, "muzza").map((i) => i.id), ["pizza-muzzarella"]);
});
