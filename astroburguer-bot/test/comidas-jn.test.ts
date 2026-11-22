import assert from "node:assert/strict";
import { test } from "node:test";
import { buscarItem } from "../src/catalogo.ts";
import { cargarConfig } from "../src/config.ts";
import { agregarLinea, calcularTotales, pedidoNuevo } from "../src/order.ts";

const { menu, negocio } = cargarConfig("clientes/comidas-jn");

test("Comidas JN: precios iguales a la carta", () => {
  const p = pedidoNuevo("1");
  const lata = (v: string) => ({ grupo: "bebida", valor: v });
  agregarLinea(menu, p, { producto_id: "super-americana", opciones: [{ grupo: "tamaño", valor: "doble" }, lata("coca")] }); // 13.500
  agregarLinea(menu, p, { producto_id: "cuarto-de-libra", opciones: [{ grupo: "tamaño", valor: "triple" }, lata("sprite")] }); // 14.500
  agregarLinea(menu, p, { producto_id: "clasica", opciones: [{ grupo: "tamaño", valor: "simple" }, lata("coca")], sin_ingredientes: ["tomate"] }); // 11.500
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
  assert.throws(() => agregarLinea(menu, pedidoNuevo("1"), { producto_id: "clasica", opciones: [{ grupo: "tamaño", valor: "simple" }] }), /bebida.*Coca-Cola.*Sprite/s);
  assert.throws(
    () => agregarLinea(menu, pedidoNuevo("1"), { producto_id: "clasica", opciones: [{ grupo: "tamaño", valor: "simple" }, { grupo: "bebida", valor: "coca" }], extras: ["bacon"] }),
    /no se puede agregar/,
  );
});

test("Comidas JN: el local encuentra los productos por apodo para cambiar precios", () => {
  assert.deepEqual(buscarItem(menu, "jyq").map((i) => i.id), ["pizza-jamon-y-queso"]);
  assert.deepEqual(buscarItem(menu, "comen 2").map((i) => i.id), ["napo-comen-2"]);
  assert.deepEqual(buscarItem(menu, "americana").map((i) => i.id), ["super-americana"]);
  assert.deepEqual(buscarItem(menu, "muzza").map((i) => i.id), ["pizza-muzzarella"]);
});

test("Comidas JN: el prompt pide derivar los agregados en hamburguesas y conoce las zonas por cuadras", async () => {
  const { systemPrompt } = await import("../src/prompt.ts");
  const sp = systemPrompt(menu, negocio);
  assert.match(sp, /agregados \(cheddar, bacon u otro\) en una hamburguesa/);
  assert.match(sp, /hasta 50 cuadras del local/);
  assert.match(sp, /Más de 50 cuadras queda fuera/);
});

test("zona según la ubicación compartida por el cliente", async () => {
  const { zonaPorUbicacion } = await import("../src/bot.ts");
  const n = { ...negocio, ubicacion: { lat: -34.5, lng: -58.7 } };
  // ~0,5 km en línea recta ≈ 6-7 cuadras de recorrido → zona 1
  assert.match(zonaPorUbicacion(n, -34.5045, -58.7), /zona z1/);
  // ~3 km → ~39 cuadras → zona 4
  assert.match(zonaPorUbicacion(n, -34.527, -58.7), /zona z4/);
  // ~6 km → fuera
  assert.match(zonaPorUbicacion(n, -34.554, -58.7), /FUERA/);
  assert.equal(zonaPorUbicacion(negocio, -34.5, -58.7), "", "sin ubicación del local no calcula");
});
