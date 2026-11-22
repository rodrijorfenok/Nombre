import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, type Mensajero } from "../src/bot.ts";
import { comandaTexto } from "../src/comanda.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { agregarLinea, calcularTotales, cuentas, pedidoNuevo, resumenCliente } from "../src/order.ts";
import { systemPrompt } from "../src/prompt.ts";
import { calcularResumen } from "../src/reportes.ts";
import { comandoCocina, comandoStaff } from "../src/staff.ts";

const { menu, negocio } = cargarConfig("clientes/comidas-jn");
const CLIENTE = "5491122223333";
const COCINA = "5491199990000";
const STAFF = "5491188880000";
negocio.equipo = { cocina: [COCINA], encargados: [STAFF] };
const dataDir = `${process.env.TMPDIR ?? "/tmp"}/jn-mejoras-${process.pid}`;
const SABADO_21 = new Date("2026-11-22T00:00:00Z"); // sábado 21:00 en Argentina: abierto
const lata = { grupo: "bebida", valor: "coca" };
const simple = { grupo: "tamaño", valor: "simple" };

type Paso = { tools?: { name: string; input: unknown }[]; text?: string };

function armar(guion: Paso[], comprobantes: unknown[] = []) {
  let ahora = SABADO_21;
  let n = 0;
  const create = async () => {
    const paso = guion.shift();
    if (!paso) throw new Error("el guion se quedó sin pasos");
    if (paso.tools) return { stop_reason: "tool_use", content: paso.tools.map((t) => ({ type: "tool_use", id: `tu_${++n}`, name: t.name, input: t.input })) };
    return { stop_reason: "end_turn", content: [{ type: "text", text: paso.text }] };
  };
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: comprobantes.shift() ?? null });
  const client = { beta: { messages: { create, parse } } } as unknown as Anthropic;
  const enviados: { tel: string; texto: string }[] = [];
  const mensajero: Mensajero = { enviarTexto: async (tel, texto) => void enviados.push({ tel, texto }) };
  const store = new Store(":memory:");
  const bot = new Bot({ store, menu, negocio, client, mensajero, reloj: () => ahora, dataDir, esperaRafagaMs: 0 });
  return {
    bot,
    store,
    enviados,
    a: (tel: string) => enviados.filter((e) => e.tel === tel).map((e) => e.texto),
    avanzar: (min: number) => void (ahora = new Date(ahora.getTime() + min * 60_000)),
    ahora: () => ahora,
  };
}

const comprobante = (monto: number, op: string) => ({
  es_comprobante: true,
  legible: true,
  monto,
  fecha_hora: "2026-11-21T21:05",
  destinatario_nombre: negocio.pago.titular,
  destinatario_alias_cvu: negocio.pago.alias,
  origen_nombre: "Cliente",
  numero_operacion: op,
  entidad: "Mercado Pago",
  estado: "aprobada",
  signos_de_edicion: false,
  observaciones: "",
});
const imagen = { tipo: "imagen" as const, datos: Buffer.from("x"), mime: "image/jpeg" as const };

/** Pedido take away en efectivo confirmado (queda en cocina). */
const pedidoEnEfectivo: Paso[] = [
  {
    tools: [
      { name: "agregar_productos", input: { items: [{ producto_id: "clasica", opciones: [simple, lata] }] } },
      { name: "configurar_entrega", input: { modo: "take_away" } },
      { name: "datos_cliente", input: { nombre: "Rodri" } },
      { name: "elegir_pago", input: { metodo: "efectivo" } },
      { name: "confirmar_pedido", input: {} },
    ],
  },
  { text: "¡Gracias!" },
];

test("cambiar un ingrediente por otro que el local usa: queda en el resumen y en la comanda", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, {
    producto_id: "super-americana",
    opciones: [simple, lata],
    reemplazos: [{ quitar: "caramelizada", poner: "cebolla brunoise" }],
  });
  assert.deepEqual(p.lineas[0].reemplazos, [{ quitar: "cebolla caramelizada", poner: "cebolla brunoise" }]);
  assert.match(resumenCliente(menu, negocio, p), /Cambio: cebolla caramelizada → cebolla brunoise/);
  p.id = 7;
  assert.match(comandaTexto(menu, negocio, p), /🔁 CAMBIAR: CEBOLLA CARAMELIZADA → CEBOLLA BRUNOISE/);
  // sin costo
  assert.equal(calcularTotales(menu, negocio, p).total, 11500);
});

test("no se puede cambiar por algo que el local no tiene, ni sacar algo que el producto no lleva", () => {
  const linea = (reemplazos: { quitar: string; poner: string }[]) => () =>
    agregarLinea(menu, pedidoNuevo("1"), { producto_id: "super-americana", opciones: [simple, lata], reemplazos });
  assert.throws(linea([{ quitar: "cebolla caramelizada", poner: "palta" }]), /no trabaja con "palta"/);
  assert.throws(linea([{ quitar: "pepino", poner: "tomate" }]), /no lleva "pepino"/);
});

test("pago mixto: transfiere el resto, el comprobante es por esa parte y la comanda cobra el efectivo", async () => {
  const total = 11500 * 2;
  const { bot, store, a } = armar(
    [
      {
        tools: [
          { name: "agregar_productos", input: { items: [{ producto_id: "clasica", cantidad: 2, opciones: [simple, lata] }] } },
          { name: "configurar_entrega", input: { modo: "take_away" } },
          { name: "datos_cliente", input: { nombre: "Rodri" } },
          { name: "elegir_pago", input: { metodo: "mixto", monto_efectivo: 10000, paga_con: 20000 } },
          { name: "confirmar_pedido", input: {} },
        ],
      },
      { text: "¡Listo!" },
    ],
    [comprobante(total - 10000, "111")],
  );
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "2 clásicas simples con coca, pago 10 mil en efectivo y el resto transferencia, retiro yo, soy Rodri" });
  const alias = a(CLIENTE).find((t) => t.includes("Alias"))!;
  assert.match(alias, /transferí \*\$\s?13\.000\*/);
  assert.match(alias, /\$\s?10\.000\* los pagás en efectivo cuando retirás/);

  await bot.recibir(CLIENTE, imagen);
  const p = store.pedido(store.conversacion(CLIENTE)!.pedidoId!)!;
  assert.equal(p.estado, "en_cocina");
  assert.ok(p.pagoVerificado);
  const comanda = a(COCINA).at(-1)!;
  assert.match(comanda, /Transferencia \$\s?13\.000 ✅ VERIFICADA/);
  assert.match(comanda, /Efectivo — COBRAR \$\s?10\.000 · paga con \$\s?20\.000 · llevar vuelto \$\s?10\.000/);

  // las ventas separan lo transferido de lo cobrado en efectivo
  const r = calcularResumen(menu, negocio, [p]);
  assert.equal(r.transferencia, 13000);
  assert.equal(r.efectivo, 10000);
});

test("pago mixto con más efectivo que el total no se puede confirmar", () => {
  const p = pedidoNuevo("1");
  agregarLinea(menu, p, { producto_id: "clasica", opciones: [simple, lata] });
  p.pago = { metodo: "mixto", montoEfectivo: 20000 };
  assert.equal(cuentas(menu, negocio, p).transferenciaBase, 0);
});

test("sumar a un pedido en cocina dentro de los 10 minutos: comanda aparte, sale más tarde y se cobra el total en efectivo", async () => {
  const { bot, store, a, avanzar } = armar([
    ...pedidoEnEfectivo,
    { tools: [{ name: "sumar_a_pedido_en_cocina", input: { items: [{ producto_id: "papas-cono" }], pago: "efectivo" } }] },
    { text: "¡Dale!" },
  ]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica simple con coca, efectivo, retiro, Rodri" });
  const id = store.conversacion(CLIENTE)!.pedidoId!;
  const antes = store.pedido(id)!.horaEstimada!;
  avanzar(6);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "me sumás un cono de papas?" });

  const p = store.pedido(id)!;
  assert.equal(p.estado, "en_cocina");
  assert.equal(p.agregados?.length, 1);
  assert.equal(p.agregados![0].monto, 5000);
  assert.ok(new Date(p.horaEstimada!).getTime() > new Date(antes).getTime(), "sale más tarde");
  const msg = a(CLIENTE).find((t) => t.startsWith("➕"))!;
  assert.match(msg, /Nuevo total \*\$\s?16\.500\*/);
  assert.match(msg, /pagás \*\$\s?16\.500\* en efectivo/);
  // la cocina recibe solo lo agregado
  const comanda = a(COCINA).at(-1)!;
  assert.match(comanda, /AGREGADO 1 AL PEDIDO #0*\d+/);
  assert.match(comanda, /1x CONO DE PAPAS/);
  assert.doesNotMatch(comanda, /CLÁSICA/i);
  assert.match(comanda, /COBRAR EN EFECTIVO EN TOTAL: \$\s?16\.500/);
  // la comanda completa marca lo agregado
  assert.match(comandaTexto(menu, negocio, p), /➕ 1x CONO DE PAPAS/);
});

test("pasados los 10 minutos ya no se suma al mismo pedido", async () => {
  const { bot, store, avanzar } = armar([
    ...pedidoEnEfectivo,
    { tools: [{ name: "sumar_a_pedido_en_cocina", input: { items: [{ producto_id: "papas-cono" }], pago: "efectivo" } }] },
    { text: "Ya no llego a sumarlo, ¿te armo otro pedido?" },
  ]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica" });
  avanzar(12);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "me sumás papas?" });
  const p = store.pedido(store.conversacion(CLIENTE)!.pedidoId!)!;
  assert.equal(p.agregados, undefined);
  assert.equal(p.lineas.length, 1);
  const conv = store.conversacion(CLIENTE)!;
  assert.ok(JSON.stringify(conv.mensajes).includes("Pasaron más de 10 minutos"));
});

test("sumar pagando por transferencia: la cocina lo recibe cuando llega el comprobante por lo agregado", async () => {
  const { bot, store, a, avanzar } = armar(
    [
      ...pedidoEnEfectivo,
      { tools: [{ name: "sumar_a_pedido_en_cocina", input: { items: [{ producto_id: "papas-chica", extras: ["cheddar"] }], pago: "transferencia" } }] },
      { text: "¡Joya!" },
    ],
    [comprobante(9500, "222")],
  );
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica" });
  avanzar(3);
  const comandasAntes = a(COCINA).length;
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "sumame unas papas chicas con cheddar, te transfiero" });
  const id = store.conversacion(CLIENTE)!.pedidoId!;
  assert.equal(a(COCINA).length, comandasAntes, "sin pago todavía no va a cocina");
  assert.match(a(CLIENTE).at(-2)!, /Transferí los \*\$\s?9\.500\*/);

  await bot.recibir(CLIENTE, imagen);
  const p = store.pedido(id)!;
  assert.equal(p.agregados![0].pagado, true);
  assert.equal(p.agregados![0].comandaEnviada, true);
  assert.match(a(COCINA).at(-1)!, /AGREGADO 1[\s\S]*Agregado por transferencia \$\s?9\.500 ✅ VERIFICADA/);
  assert.match(a(CLIENTE).at(-1)!, /Recibí el pago de lo que sumaste/);
  // el original se sigue cobrando en efectivo
  assert.equal(cuentas(menu, negocio, p).efectivo, 11500);
});

test("con el pedido en cocina, agregar_productos explica que se puede sumar", async () => {
  const { bot, store } = armar([
    ...pedidoEnEfectivo,
    { tools: [{ name: "agregar_productos", input: { items: [{ producto_id: "papas-cono" }] } }] },
    { text: "ok" },
  ]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica" });
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "y papas" });
  assert.ok(JSON.stringify(store.conversacion(CLIENTE)!.mensajes).includes("usá sumar_a_pedido_en_cocina"));
});

test("aviso de 5 minutos: la cocina avisa y el cliente recibe 'ya podés venir a retirar' una sola vez", async () => {
  const { bot, store, a } = armar([...pedidoEnEfectivo]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica" });
  const id = store.conversacion(CLIENTE)!.pedidoId!;
  const r = await comandoCocina(bot, `aviso ${id}`);
  assert.match(r!, /Avisado/);
  const msg = a(CLIENTE).at(-1)!;
  assert.match(msg, /casi listo/);
  assert.match(msg, /ya podés venir a retirarlo/);
  assert.match(msg, /Traé \$\s?11\.500 en efectivo/);
  assert.ok(store.pedido(id)!.avisoCasiListo);
  assert.match((await comandoStaff(bot, `5 min ${id}`))!, /ya se le avisó/);
  assert.equal(a(CLIENTE).filter((t) => t.includes("casi listo")).length, 1);
});

test("el teléfono de cocina no puede cambiar precios ni apagar el bot", async () => {
  const { bot, store } = armar([]);
  assert.equal(await comandoCocina(bot, "precio clasica 1"), null);
  assert.equal(await comandoCocina(bot, "bot off"), null);
  assert.equal(await comandoCocina(bot, "pago ok 3"), null);
  assert.equal(store.ajuste("bot_apagado"), null);
  assert.match((await comandoCocina(bot, "pedidos"))!, /No hay pedidos activos/);
});

test("los casos aprendidos de chats viejos entran al prompt", () => {
  const n = structuredClone(negocio);
  n.asistente.casos = [{ situacion: "Pide la hamburguesa sin pan", respuesta: "Se puede al plato, mismo precio" }];
  assert.match(systemPrompt(menu, n), /Situaciones que ya le pasaron al local[\s\S]*Pide la hamburguesa sin pan → Se puede al plato, mismo precio/);
  assert.doesNotMatch(systemPrompt(menu, negocio), /Situaciones que ya le pasaron/);
});

test("chats exportados de WhatsApp (Android y iPhone) quedan anónimos y con quién es quién", async () => {
  const { parsearChat, detectarLocal, chatComoTexto } = await import("../src/chats.ts");
  const android = parsearChat(
    [
      "22/11/26, 21:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
      "22/11/26, 21:01 - Juan Pérez: hola, la super americana me la hacés con cebolla brunoise?",
      "en vez de la caramelizada",
      "22/11/26, 21:02 - Comidas JN: Sí, sin problema, mismo precio",
      "22/11/26, 21:03 - Juan Pérez: <Multimedia omitido>",
      "22/11/26, 21:04 - Juan Pérez: te paso mi cel 11 3639-7582",
    ].join("\n"),
  );
  const iphone = parsearChat(
    ["‎[22/11/26, 9:05:10 p. m.] Comidas JN: Hola!", "[22/11/26, 9:06:00 p. m.] Ana: puedo pagar la mitad en efectivo?", "[22/11/26, 9:06:30 p. m.] Comidas JN: Sí, el resto transferís"].join("\n"),
  );
  assert.equal(android.length, 4);
  assert.match(android[0].texto, /brunoise\?\nen vez de la caramelizada/);
  assert.equal(android[2].texto, "[mandó un archivo o imagen]");
  assert.doesNotMatch(android[3].texto, /3639/);
  assert.equal(iphone[1].quien, "Ana");
  const local = detectarLocal([android, iphone]);
  assert.equal(local, "Comidas JN");
  const texto = chatComoTexto(android, local!);
  assert.match(texto, /^Cliente: hola, la super americana/);
  assert.match(texto, /Local: Sí, sin problema, mismo precio/);
  assert.doesNotMatch(texto, /Juan/);
});
