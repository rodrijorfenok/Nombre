import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, type Mensajero } from "../src/bot.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { agregarLinea, calcularTotales, pedidoNuevo } from "../src/order.ts";
import { systemPrompt } from "../src/prompt.ts";
import { detectarIntencion, respuestaRapida } from "../src/rapidas.ts";
import { comandoStaff } from "../src/staff.ts";
import { proximaApertura } from "../src/tiempos.ts";

const { menu, negocio } = cargarConfig("clientes/astroburguer");
const SABADO_21 = new Date("2026-11-22T00:00:00Z");
const LUNES_20 = new Date("2026-11-23T23:00:00Z");
const dataDir = `${process.env.TMPDIR ?? "/tmp"}/astro-prod-${process.pid}`;

function armar(opts: { reloj?: () => Date; esperaRafagaMs?: number; respuestas?: string[] } = {}) {
  const llamadas: any[] = [];
  const respuestas = [...(opts.respuestas ?? [])];
  const client = {
    beta: {
      messages: {
        create: async (p: any) => {
          llamadas.push(structuredClone(p));
          return { stop_reason: "end_turn", content: [{ type: "text", text: respuestas.shift() ?? "ok" }] };
        },
      },
    },
  } as unknown as Anthropic;
  const enviados: string[] = [];
  const mensajero: Mensajero = { enviarTexto: async (_t, x) => void enviados.push(x) };
  const store = new Store(":memory:");
  const bot = new Bot({ store, menu, negocio, client, mensajero, reloj: opts.reloj ?? (() => SABADO_21), dataDir, esperaRafagaMs: opts.esperaRafagaMs ?? 0 });
  return { bot, store, llamadas, enviados };
}

test("detecta solo preguntas puras; lo demás va a la IA", () => {
  for (const [t, i] of [
    ["Holaaa", "saludo"],
    ["buenas noches!", "saludo"],
    ["me pasás la carta porfa?", "menu"],
    ["hola, a qué hora cierran hoy?", "horario"],
    ["dónde están?", "direccion"],
    ["pasame el alias", "alias"],
    ["cuánto falta?", "estado"],
    ["genial gracias!!", "gracias"],
  ] as const) {
    assert.equal(detectarIntencion(t), i, t);
  }
  for (const t of ["hola quiero 2 dobles", "tienen pizza de rúcula?", "menú sin tacc?", "una coca", "sin cebolla porfa"]) assert.equal(detectarIntencion(t), null, t);
});

test("saludo y carta se contestan al instante, sin llamar a la IA, y quedan en el historial", async () => {
  const { bot, store, llamadas, enviados } = armar({ respuestas: ["Dale, ¿cuál querés?"] });
  await bot.recibir("1", { tipo: "texto", texto: "Hola!" });
  await bot.recibir("1", { tipo: "texto", texto: "me pasas la carta?" });
  assert.equal(llamadas.length, 0);
  assert.match(enviados[0], /Astroburguer/);
  assert.match(enviados[1], /\*HAMBURGUESAS\*/);
  assert.match(enviados[1], /Doble Órbita\* — \$12\.800/);

  await bot.recibir("1", { tipo: "texto", texto: "quiero algo con bacon" });
  assert.equal(llamadas.length, 1);
  const hist = llamadas[0].messages.map((m: any) => m.role);
  assert.deepEqual(hist, ["user", "assistant", "user", "assistant", "user"]);
  assert.ok(store.conversacion("1")!.mensajes.length === 6);
});

test("con el local cerrado el saludo avisa cuándo abre", () => {
  const p = pedidoNuevo("1");
  const r = respuestaRapida("buenas", { menu, negocio, pedido: p, primerMensaje: true, abierto: false, ahora: LUNES_20, azar: () => 0 })!;
  assert.match(r[0], /cerrados, abrimos mañana a las 19:30/);
  assert.equal(proximaApertura(negocio, new Date("2026-11-22T18:00:00Z")), "hoy a las 19:30");
});

test("respeta el tono formal (usted) y sin emojis", () => {
  const formal = { ...negocio, asistente: { ...negocio.asistente, tono: "formal" as const, emojis: false } };
  const r = respuestaRapida("hola", { menu, negocio: formal, pedido: pedidoNuevo("1"), primerMensaje: true, abierto: true, ahora: SABADO_21, azar: () => 0 })!;
  assert.match(r[0], /le gustaría|Le paso|sabe/);
  assert.doesNotMatch(r[0], /\p{Extended_Pictographic}/u);
});

test("mensajes seguidos se juntan en un solo turno de IA", async () => {
  const { bot, llamadas } = armar({ esperaRafagaMs: 30 });
  await Promise.all([
    bot.recibir("2", { tipo: "texto", texto: "hola" }),
    bot.recibir("2", { tipo: "texto", texto: "quiero 2 dobles" }),
    bot.recibir("2", { tipo: "texto", texto: "y una coca zero" }),
  ]);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].messages[0].content[0].text, "hola\nquiero 2 dobles\ny una coca zero");
});

test("el local cambia precios y faltantes por WhatsApp; los pedidos cargados no cambian", async () => {
  const { bot, store } = armar();
  const p = pedidoNuevo("3");
  agregarLinea(bot.menu, p, { producto_id: "doble-orbita" });

  assert.match((await comandoStaff(bot, "precio doble orbita 13.900"))!, /\$13\.900/);
  assert.equal(bot.menu.productos.find((x) => x.id === "doble-orbita")!.precio, 13900);
  assert.equal(calcularTotales(bot.menu, negocio, p).total, 12800, "la línea ya cargada mantiene su precio");

  // "napo" es el apodo de la milanesa napolitana
  assert.match((await comandoStaff(bot, "agotado napo"))!, /Milanesa Napolitana marcado como agotado/);
  await comandoStaff(bot, "hay napo");
  // "napolitana" a secas coincide con la mila y con la pizza: pide precisión
  assert.match((await comandoStaff(bot, "agotado napol"))!, /coincide con varios/);
  assert.match((await comandoStaff(bot, "agotado pizza napolitana"))!, /Pizza Napolitana marcado como agotado/);
  assert.throws(() => agregarLinea(bot.menu, pedidoNuevo("4"), { producto_id: "pizza-napo", opciones: [{ grupo: "tamaño", valor: "grande" }] }), /AGOTADO/);
  assert.match((await comandoStaff(bot, "carta"))!, /🚫 Pizza Napolitana/);
  await comandoStaff(bot, "hay pizza napolitana");
  assert.equal(bot.menu.productos.find((x) => x.id === "pizza-napo")!.disponible, true);

  await comandoStaff(bot, "precio doble orbita 12800");
  assert.equal(store.ajuste("precio:doble-orbita"), null, "volver al precio base borra el cambio");
});

test("el system prompt no lleva precios: cambiar un precio no lo altera", async () => {
  const { bot } = armar();
  const antes = systemPrompt(bot.menu, negocio);
  await comandoStaff(bot, "precio big bang 99999");
  assert.equal(systemPrompt(bot.menu, negocio), antes);
  assert.doesNotMatch(antes, /12\.800|15\.500|9\.500/);
});

test("estado del pedido confirmado se responde sin IA", async () => {
  const { bot, store, llamadas, enviados } = armar();
  await bot.recibir("5", { tipo: "texto", texto: "hola" });
  const conv = store.conversacion("5")!;
  const p = store.pedido(conv.pedidoId!)!;
  agregarLinea(bot.menu, p, { producto_id: "nuggets" });
  p.entrega = { modo: "take_away" };
  p.estado = "en_cocina";
  p.horaEstimada = new Date(SABADO_21.getTime() + 25 * 60_000).toISOString();
  store.guardarPedido(p);
  await bot.recibir("5", { tipo: "texto", texto: "cuanto falta?" });
  assert.equal(llamadas.length, 0);
  assert.match(enviados.at(-1)!, /21:25/);
});
