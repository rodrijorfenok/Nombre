import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, disyuntor, pideHumano } from "../src/bot.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { comandoStaff } from "../src/staff.ts";

const { menu, negocio: base } = cargarConfig("clientes/comidas-jn");
const negocio = { ...base, equipo: { encargados: ["5491100000001"], cocina: [] } };
const SABADO_21 = new Date("2026-11-22T00:00:00Z");
const ENCARGADO = "5491100000001";

function armar(create: (p: any) => Promise<unknown>) {
  const enviados: { tel: string; texto: string }[] = [];
  const store = new Store(":memory:");
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  const bot = new Bot({
    store,
    menu,
    negocio,
    client,
    mensajero: { enviarTexto: async (tel, texto) => void enviados.push({ tel, texto }) },
    reloj: () => SABADO_21,
    dataDir: `${process.env.TMPDIR ?? "/tmp"}/seg-${process.pid}`,
    esperaRafagaMs: 0,
  });
  return { bot, store, enviados, alEncargado: () => enviados.filter((e) => e.tel === ENCARGADO).map((e) => e.texto) };
}

beforeEach(() => {
  disyuntor.abiertoHasta = 0;
  disyuntor.erroresSeguidos = 0;
});

test("detecta cuando el cliente pide una persona o se frustra", () => {
  for (const t of ["quiero hablar con una persona", "me pasás con el encargado?", "HUMANO", "no entendés nada", "necesito una persona"]) assert.ok(pideHumano(t), t);
  for (const t of ["quiero una pizza para 2 personas", "hola", "sos un bot?", "la persona que retira es mi hermano"]) assert.equal(pideHumano(t), false, t);
});

test("si el cliente pide una persona, se deriva sin pasar por la IA", async () => {
  let llamadas = 0;
  const { bot, enviados, alEncargado } = armar(async () => (llamadas++, { stop_reason: "end_turn", content: [] }));
  await bot.recibir("549111", { tipo: "texto", texto: "quiero hablar con una persona" });
  assert.equal(llamadas, 0);
  assert.match(enviados.find((e) => e.tel === "549111")!.texto, /alguien del local/);
  assert.match(alEncargado()[0], /pidió hablar con una persona/);
  assert.ok(bot.enAtencionHumana("549111"));
});

test("si la IA se cae, el cliente pasa a una persona y tras 3 fallas el bot entra en modo seguro", async () => {
  let llamadas = 0;
  const { bot, enviados, alEncargado } = armar(async () => {
    llamadas++;
    throw new Error("503 servicio no disponible");
  });
  await bot.recibir("549111", { tipo: "texto", texto: "quiero 2 cuartos de libra" });
  // al primer error el cliente no queda colgado: se lo atiende una persona y su mensaje llega al encargado
  assert.match(enviados.find((e) => e.tel === "549111")!.texto, /te responde alguien del local/);
  assert.ok(alEncargado().some((t) => t.includes("quiero 2 cuartos de libra")));

  await bot.recibir("549222", { tipo: "texto", texto: "una muzza" });
  await bot.recibir("549333", { tipo: "texto", texto: "una calabresa" });
  assert.ok(disyuntor.abierto(), "modo seguro activado");
  assert.ok(alEncargado().some((t) => t.includes("modo seguro")));

  // en modo seguro ni se intenta llamar a la IA: va directo al local
  const antes = llamadas;
  await bot.recibir("549444", { tipo: "texto", texto: "hola, tienen jyq?" });
  assert.equal(llamadas, antes);
  assert.ok(alEncargado().some((t) => t.includes("tienen jyq")));
});

test("si no logra cargar el pedido (errores repetidos), se frena y deriva", async () => {
  const malo = { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "agregar_productos", input: { items: [{ producto_id: "no-existe" }] } }] };
  let n = 0;
  const { bot, enviados, alEncargado } = armar(async () => ({ ...malo, content: [{ ...malo.content[0], id: `x${++n}` }] }));
  await bot.recibir("549111", { tipo: "texto", texto: "quiero la hamburguesa de la foto" });
  assert.match(enviados.find((e) => e.tel === "549111")!.texto, /Para no equivocarme/);
  assert.ok(alEncargado().some((t) => t.includes("freno automático")));
  assert.ok(bot.enAtencionHumana("549111"));
});

test("botón de apagado: 'bot off' pasa todo al local y 'bot on' lo devuelve", async () => {
  let llamadas = 0;
  const { bot, alEncargado } = armar(async () => (llamadas++, { stop_reason: "end_turn", content: [{ type: "text", text: "¡Hola!" }] }));
  assert.match((await comandoStaff(bot, "bot off"))!, /Bot apagado/);
  await bot.recibir("549111", { tipo: "texto", texto: "quiero una pizza jn" });
  assert.equal(llamadas, 0);
  assert.ok(alEncargado().some((t) => t.includes("quiero una pizza jn")));
  assert.match((await comandoStaff(bot, "bot on"))!, /Bot prendido/);
  await bot.recibir("549555", { tipo: "texto", texto: "quiero una pizza jn" });
  assert.equal(llamadas, 1);
});
