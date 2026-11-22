import assert from "node:assert/strict";
import { test } from "node:test";
import { Bot } from "../src/bot.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { agregarLinea } from "../src/order.ts";
import { inicioJornada } from "../src/reportes.ts";
import { comandoStaff } from "../src/staff.ts";

const { menu, negocio: base } = cargarConfig("clientes/comidas-jn");
const negocio = { ...base, equipo: { encargados: ["5491100000001"], cocina: [] } };
const ar = (s: string) => new Date(`${s}:00-03:00`);

test("la jornada va de 6 a 6: el turno de noche queda junto", () => {
  assert.equal(inicioJornada(ar("2026-11-27T23:30"), negocio.zonaHoraria).toISOString(), ar("2026-11-27T06:00").toISOString());
  assert.equal(inicioJornada(ar("2026-11-28T00:40"), negocio.zonaHoraria).toISOString(), ar("2026-11-27T06:00").toISOString());
  assert.equal(inicioJornada(ar("2026-11-28T07:00"), negocio.zonaHoraria).toISOString(), ar("2026-11-28T06:00").toISOString());
});

function cargarPedidos(store: Store) {
  const crear = (hora: string, f: (p: ReturnType<Store["crearPedido"]>) => void, estado: "entregado" | "cancelado" | "armando" | "esperando_pago") => {
    const p = store.crearPedido("549", ar(hora));
    f(p);
    p.estado = estado;
    if (estado !== "armando") p.confirmadoEn = ar(hora).toISOString();
    store.guardarPedido(p);
  };
  // 2 entregados, 1 cancelado, 1 abandonado, 1 transferencia sin pagar (no cuenta como venta)
  crear("2026-11-27T21:10", (p) => {
    agregarLinea(menu, p, { producto_id: "promo-2" });
    p.entrega = { modo: "delivery", zonaId: "z1" };
    p.pago = { metodo: "efectivo" };
  }, "entregado");
  crear("2026-11-27T21:40", (p) => {
    agregarLinea(menu, p, { producto_id: "cuarto-de-libra", cantidad: 2, opciones: [{ grupo: "tamaño", valor: "doble" }, { grupo: "bebida", valor: "coca" }] });
    p.entrega = { modo: "take_away" };
    p.pago = { metodo: "transferencia" };
    p.pagoVerificado = true;
  }, "entregado");
  crear("2026-11-27T22:00", (p) => agregarLinea(menu, p, { producto_id: "pizza-muzzarella" }), "cancelado");
  crear("2026-11-27T22:30", (p) => agregarLinea(menu, p, { producto_id: "papas-cono" }), "armando");
  crear("2026-11-27T23:00", (p) => {
    agregarLinea(menu, p, { producto_id: "pizza-jn" });
    p.pago = { metodo: "transferencia" };
  }, "esperando_pago");
}

test("resumen de la jornada: pedidos, facturado, medios de pago y lo más pedido", async () => {
  const store = new Store(":memory:");
  cargarPedidos(store);
  const bot = new Bot({ store, menu, negocio, client: {} as never, mensajero: { enviarTexto: async () => {} }, reloj: () => ar("2026-11-28T00:30"), esperaRafagaMs: 0 });
  const r = (await comandoStaff(bot, "resumen"))!;
  assert.match(r, /Pedidos: \*2\* · Facturado: \*\$55\.500\*/); // 27.000 + 1.500 envío + 27.000
  assert.match(r, /Delivery: 1 · 🏃 Take away: 1/);
  assert.match(r, /Transferencia: \$27\.000 · 💵 Efectivo: \$28\.500/);
  assert.match(r, /Lo más pedido: Cuarto de Libra \(2\), Promo N°2 \(1\)/);
  assert.match(r, /Cancelados después de confirmar: 1/);
  assert.match(r, /no se confirmaron: 1/);
  assert.match((await comandoStaff(bot, "resumen ayer"))!, /Sin pedidos/);
});

test("al cerrar, manda el resumen solo una vez", async () => {
  const store = new Store(":memory:");
  cargarPedidos(store);
  const enviados: string[] = [];
  let ahora = ar("2026-11-27T23:30"); // abierto: no manda
  const alCliente: string[] = [];
  const mensajero = { enviarTexto: async (t: string, x: string) => void (t === negocio.equipo.encargados[0] ? enviados : alCliente).push(x) };
  const bot = new Bot({ store, menu, negocio, client: {} as never, mensajero, reloj: () => ahora, esperaRafagaMs: 0 });
  await bot.tareaPeriodica();
  assert.equal(enviados.length, 0);
  // la transferencia sin comprobante (confirmada 23:00) recibe un recordatorio, una sola vez
  await bot.tareaPeriodica();
  assert.equal(alCliente.length, 1);
  assert.match(alCliente[0], /Pudiste hacer la transferencia/);
  ahora = ar("2026-11-28T00:20"); // cerró
  await bot.tareaPeriodica();
  await bot.tareaPeriodica();
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /Facturado: \*\$55\.500\*/);
});
