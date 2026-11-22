import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, type Mensajero } from "../src/bot.ts";
import { comandaHtml, comandaTexto } from "../src/comanda.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { ejecutarHerramienta, type ContextoHerramientas } from "../src/herramientas.ts";
import { agregarLinea, pedidoNuevo, type Pedido } from "../src/order.ts";
import { estadoPanel, htmlPanel } from "../src/panel.ts";
import { calcularResumen } from "../src/reportes.ts";
import { comandoStaff } from "../src/staff.ts";

const { menu, negocio } = cargarConfig("clientes/comidas-jn");
const CLIENTE = "5491122223333";
const COCINA = "5491199990000";
const STAFF = "5491188880000";
negocio.equipo = { cocina: [COCINA], encargados: [STAFF] };
const dataDir = `${process.env.TMPDIR ?? "/tmp"}/jn-novedades-${process.pid}`;
const ar = (s: string) => new Date(`${s}:00-03:00`);
const SABADO_21 = ar("2026-11-21T21:00"); // abierto (viernes a domingo de 20 a 00)
const simple = { grupo: "tamaño", valor: "simple" };
const lata = { grupo: "bebida", valor: "coca" };

type Paso = { tools?: { name: string; input: unknown }[]; text?: string };

function armar(guion: Paso[], desde = SABADO_21) {
  let ahora = desde;
  let n = 0;
  const pedidosALaIA: Anthropic.Beta.MessageCreateParams[] = [];
  const create = async (params: Anthropic.Beta.MessageCreateParams) => {
    pedidosALaIA.push(params);
    const paso = guion.shift();
    if (!paso) throw new Error("el guion se quedó sin pasos");
    if (paso.tools) return { stop_reason: "tool_use", content: paso.tools.map((t) => ({ type: "tool_use", id: `tu_${++n}`, name: t.name, input: t.input })) };
    return { stop_reason: "end_turn", content: [{ type: "text", text: paso.text }] };
  };
  const client = { beta: { messages: { create, parse: async () => ({ parsed_output: null }) } } } as unknown as Anthropic;
  const enviados: { tel: string; texto: string }[] = [];
  const mensajero: Mensajero = { enviarTexto: async (tel, texto) => void enviados.push({ tel, texto }) };
  const store = new Store(":memory:");
  const bot = new Bot({ store, menu, negocio, client, mensajero, reloj: () => ahora, dataDir, esperaRafagaMs: 0 });
  return {
    bot,
    store,
    pedidosALaIA,
    a: (tel: string) => enviados.filter((e) => e.tel === tel).map((e) => e.texto),
    avanzar: (min: number) => void (ahora = new Date(ahora.getTime() + min * 60_000)),
  };
}

const pedidoEnEfectivo = (): Paso[] => [
  {
    tools: [
      { name: "agregar_productos", input: { items: [{ producto_id: "clasica", opciones: [simple, lata] }, { producto_id: "papas-cono" }] } },
      { name: "configurar_entrega", input: { modo: "take_away" } },
      { name: "datos_cliente", input: { nombre: "Rodri Gómez" } },
      { name: "elegir_pago", input: { metodo: "efectivo" } },
      { name: "confirmar_pedido", input: {} },
    ],
  },
  { text: "¡Gracias!" },
];

function contexto(pedido: Pedido, ahora: Date, extra: Partial<ContextoHerramientas> = {}): ContextoHerramientas {
  return {
    menu,
    negocio,
    pedido,
    cargaCocina: () => 0,
    demoraExtra: () => 0,
    abiertoManual: () => null,
    crearPedido: () => pedidoNuevo(pedido.telefono),
    ahora: () => ahora,
    salida: [],
    efectos: [],
    ...extra,
  };
}

test("cliente que vuelve: lo saluda por el nombre, la IA recibe su ficha y repite 'lo de siempre'", async () => {
  const guion = pedidoEnEfectivo();
  const { bot, store, a, avanzar, pedidosALaIA } = armar(guion);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica simple con coca y un cono, retiro, efectivo, soy Rodri" });
  assert.equal(store.pedido(1)!.estado, "en_cocina");
  await comandoStaff(bot, "listo 1");
  await comandoStaff(bot, "entregado 1");
  assert.match(a(CLIENTE).at(-1)!, /del \*1 al 5\*/);

  // la nota se guarda y no arranca una charla nueva
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "5" });
  assert.equal(store.pedido(1)!.calificacion?.nota, 5);
  assert.match(a(CLIENTE).at(-1)!, /Gracias por el 5/);

  // al otro día
  avanzar(24 * 60);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "hola" });
  assert.match(a(CLIENTE).at(-1)!, /Rodri/);
  const conv = store.conversacion(CLIENTE)!;
  assert.equal(conv.pedidoId, 2);
  assert.equal(store.pedido(2)!.cliente, "Rodri Gómez");
  assert.match(conv.ficha!, /Hamburguesa Clásica/);

  guion.push({ tools: [{ name: "repetir_pedido_anterior", input: { entrega: true } }] }, { text: "Listo, te cargué lo mismo de la otra vez." });
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "lo de siempre" });
  const p2 = store.pedido(2)!;
  assert.deepEqual(p2.lineas.map((l) => l.productoId), ["clasica", "papas-cono"]);
  assert.equal(p2.entrega?.modo, "take_away");
  // la ficha viaja como un bloque aparte, después del system prompt que queda en caché
  const system = pedidosALaIA.at(-1)!.system as { text: string }[];
  assert.equal(system.length, 2);
  assert.match(system[1].text, /ya nos compró antes/);
});

test("nota baja: le pregunta qué pasó y le pasa la charla al encargado", async () => {
  const { bot, a } = armar(pedidoEnEfectivo());
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica y un cono, retiro, efectivo, Rodri" });
  await comandoStaff(bot, "entregado 1");
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "2" });
  assert.match(a(CLIENTE).at(-1)!, /qué fue lo que no te gustó/i);
  assert.ok(a(STAFF).some((t) => /Te necesitan/.test(t) && /2\/5/.test(t)));
  assert.ok(bot.enAtencionHumana(CLIENTE));
});

test("un número suelto que no responde a un pedido de nota va a la IA como siempre", async () => {
  const { bot, a } = armar([{ text: "¿2 de qué? Contame qué querés pedir 🙂" }]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "2" });
  assert.match(a(CLIENTE).at(-1)!, /2 de qué/);
});

test("pedido programado: se confirma para esa hora y la comanda dice que no se adelante", async () => {
  const { bot, store, a } = armar([
    {
      tools: [
        { name: "agregar_productos", input: { items: [{ producto_id: "clasica", opciones: [simple, lata] }] } },
        { name: "configurar_entrega", input: { modo: "take_away" } },
        { name: "datos_cliente", input: { nombre: "Ana" } },
        { name: "elegir_pago", input: { metodo: "efectivo" } },
        { name: "programar_pedido", input: { hora: "23:00" } },
        { name: "confirmar_pedido", input: {} },
      ],
    },
    { text: "¡Agendado!" },
  ]);
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica para las 23, retiro, efectivo, Ana" });
  const p = store.pedido(1)!;
  assert.equal(p.programadoPara, ar("2026-11-21T23:00").toISOString());
  assert.equal(p.horaEstimada, p.programadoPara);
  assert.ok(a(CLIENTE).some((t) => /Programado para las 23:00/.test(t)));
  assert.match(a(COCINA).at(-1)!, /PROGRAMADO PARA LAS 23:00 — NO ADELANTAR/);
  assert.match(a(COCINA).at(-1)!, /LISTO 23:00/);
  // hasta media hora antes de prepararlo todavía se le pueden sumar cosas
  assert.match(ejecutarHerramienta("estado_pedido", {}, contexto(p, ar("2026-11-21T21:40"))), /se le pueden sumar/);
});

test("programar: controla que llegue a tiempo y que el local esté abierto", () => {
  const p = pedidoNuevo(CLIENTE);
  agregarLinea(menu, p, { producto_id: "clasica", opciones: [simple, lata] });
  assert.throws(() => ejecutarHerramienta("programar_pedido", { hora: "21:05" }, contexto(p, SABADO_21)), /no llegamos/);
  assert.throws(() => ejecutarHerramienta("programar_pedido", { hora: "02:00" }, contexto(p, SABADO_21)), /no está abierto/);
  assert.throws(() => ejecutarHerramienta("programar_pedido", { hora: "mañana" }, contexto(p, SABADO_21)), /No entiendo la hora/);
});

test("con el local cerrado se puede dejar un pedido anticipado para cuando abre", () => {
  const p = pedidoNuevo(CLIENTE);
  p.id = 9;
  agregarLinea(menu, p, { producto_id: "clasica", opciones: [simple, lata] });
  p.cliente = "Ana";
  p.entrega = { modo: "take_away" };
  p.pago = { metodo: "efectivo" };
  const ahora = ar("2026-11-21T18:30");
  assert.throws(() => ejecutarHerramienta("confirmar_pedido", {}, contexto(p, ahora)), /programar_pedido/);
  ejecutarHerramienta("programar_pedido", { hora: "20:30" }, contexto(p, ahora));
  const ctx = contexto(p, ahora);
  ejecutarHerramienta("confirmar_pedido", {}, ctx);
  assert.equal(p.estado, "en_cocina");
  assert.match(ctx.salida[0], /Programado para las 20:30/);
});

test("pedidos que quedaron abiertos de otro turno se cierran solos; los atrasados avisan una vez", async () => {
  const { bot, store, a, avanzar } = armar([]);
  const crear = (estado: Pedido["estado"], hace: number, hora?: number) => {
    const p = store.crearPedido("549111", new Date(SABADO_21.getTime() - hace * 60_000));
    agregarLinea(menu, p, { producto_id: "papas-cono" });
    p.estado = estado;
    p.confirmadoEn = p.enCocinaDesde = new Date(SABADO_21.getTime() - hace * 60_000).toISOString();
    p.horaEstimada = new Date(SABADO_21.getTime() + (hora ?? -hace + 30) * 60_000).toISOString();
    p.entrega = { modo: "take_away" };
    p.pago = { metodo: estado === "esperando_pago" ? "transferencia" : "efectivo" };
    store.guardarPedido(p);
    return p.id!;
  };
  const viejo = crear("en_cocina", 24 * 60);
  const sinPagar = crear("esperando_pago", 24 * 60);
  const atrasado = crear("en_cocina", 40, -10); // tenía que estar a las 20:50
  await bot.tareaPeriodica();
  assert.equal(store.pedido(viejo)!.estado, "entregado");
  assert.equal(store.pedido(sinPagar)!.estado, "cancelado");
  assert.ok(store.pedido(viejo)!.cerradoAutomatico);
  assert.ok(a(STAFF).some((t) => /Cerré 2 pedidos/.test(t)));
  assert.equal(a(STAFF).filter((t) => t.includes(`#${atrasado}`) && /atrasado/.test(t)).length, 1);
  avanzar(1);
  await bot.tareaPeriodica();
  assert.equal(a(STAFF).filter((t) => /atrasado/.test(t)).length, 1, "el aviso de atraso sale una sola vez");
  // al cliente no le llega nada de los pedidos que se cerraron solos
  assert.equal(a("549111").length, 0);
});

test("demorado N M: corre la hora y le pide disculpas al cliente", async () => {
  const { bot, store, a } = armar(pedidoEnEfectivo());
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica y un cono, retiro, efectivo, Rodri" });
  const antes = new Date(store.pedido(1)!.horaEstimada!).getTime();
  assert.match((await comandoStaff(bot, "demorado 1 15"))!, /\+15 min/);
  assert.equal(new Date(store.pedido(1)!.horaEstimada!).getTime(), antes + 15 * 60_000);
  assert.match(a(CLIENTE).at(-1)!, /Perdón, tu pedido #1 se nos demoró/);
});

test("los comandos no dejan saltar estados que no corresponden", async () => {
  const { bot, store, a } = armar(pedidoEnEfectivo());
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica y un cono, retiro, efectivo, Rodri" });
  assert.match((await comandoStaff(bot, "sale 1"))!, /es take away/);
  await comandoStaff(bot, "cancelar 1 se rompió la plancha");
  const mensajes = a(CLIENTE).length;
  assert.match((await comandoStaff(bot, "listo 1"))!, /solo se marca listo un pedido en cocina/);
  assert.match((await comandoStaff(bot, "entregado 1"))!, /cancelado/);
  assert.equal(store.pedido(1)!.estado, "cancelado");
  assert.equal(a(CLIENTE).length, mensajes, "al cliente no le llegan avisos de un pedido cancelado");
});

test("el resumen mide la cocina, la puntualidad y la nota de los clientes", () => {
  const mk = (min: number, nota?: number): Pedido => {
    const p = pedidoNuevo("1");
    p.id = 1;
    agregarLinea(menu, p, { producto_id: "papas-cono" });
    p.estado = "entregado";
    p.pago = { metodo: "efectivo" };
    p.entrega = { modo: "take_away" };
    p.confirmadoEn = p.enCocinaDesde = SABADO_21.toISOString();
    p.horaEstimada = new Date(SABADO_21.getTime() + 20 * 60_000).toISOString();
    p.tiempos = { listo: new Date(SABADO_21.getTime() + min * 60_000).toISOString() };
    if (nota) p.calificacion = { nota, en: SABADO_21.toISOString() };
    return p;
  };
  const r = calcularResumen(menu, negocio, [mk(15, 5), mk(25, 3)]);
  assert.equal(r.minutosCocina, 20);
  assert.equal(r.aTiempo, 50);
  assert.deepEqual(r.notas, { promedio: 4, cantidad: 2, bajas: 1 });
});

test("comanda: hora objetivo arriba, mapa para el repartidor y aviso si el pago no está confirmado", () => {
  const p = pedidoNuevo(CLIENTE);
  p.id = 3;
  agregarLinea(menu, p, { producto_id: "clasica", cantidad: 2, opciones: [simple, lata] });
  p.entrega = { modo: "delivery", direccion: "Arricau 1234", zonaId: "z1" };
  p.pago = { metodo: "transferencia" };
  p.estado = "en_cocina";
  p.confirmadoEn = SABADO_21.toISOString();
  p.horaEstimada = ar("2026-11-21T21:40").toISOString();
  const t = comandaTexto(menu, negocio, p, undefined, { pedidosPrevios: 0 });
  assert.match(t, /SALE 21:30 · LLEGA 21:40/); // zona 1: 10 minutos de viaje
  assert.match(t, /🆕 primera vez/);
  assert.match(t, /2 unidades/);
  assert.match(t, /maps\/search\/\?api=1&query=Arricau%201234%2C%20Jos%C3%A9%20C\.%20Paz/);
  assert.match(t, /PAGO SIN CONFIRMAR/);
  p.pagoVerificado = true;
  assert.match(comandaTexto(menu, negocio, p), /NO COBRAR: ya está pago/);
  const html = comandaHtml(menu, negocio, p, undefined, { pedidosPrevios: 4 });
  assert.match(html, /<svg/); // QR con la dirección
  assert.match(html, /5° pedido/);
});

test("panel: los datos llegan aparte y la página no lleva el token ni datos de clientes", async () => {
  const { bot, store } = armar(pedidoEnEfectivo());
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una clásica y un cono, retiro, efectivo, Rodri" });
  store.setAjuste("agotado:pizza-jn", "1");
  const e = estadoPanel(bot, "comidas-jn", "secreto");
  assert.equal(e.pedidos.length, 1);
  assert.equal(e.pedidos[0].estado, "en_cocina");
  assert.equal(e.pedidos[0].cliente, "Rodri Gómez");
  assert.equal(e.pedidos[0].unidades, 2);
  assert.ok(e.pedidos[0].objetivo);
  assert.equal(e.stock.find((s) => s.id === "pizza-jn")?.disponible, false);
  assert.deepEqual(e.impresion.map((j) => j.clave), ["1"]);
  const html = htmlPanel(`Comidas <JN>`, "comidas-jn");
  assert.doesNotMatch(html, /secreto|Rodri/);
  assert.match(html, /Comidas &lt;JN&gt;/);
});
