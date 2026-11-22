import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, type Mensajero } from "../src/bot.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { comandoStaff } from "../src/staff.ts";

const { menu, negocio } = cargarConfig("clientes/astroburguer");
const CLIENTE = "5491122223333";
const COCINA = "5491199990000";
const STAFF = "5491188880000";
negocio.equipo = { cocina: [COCINA], encargados: [STAFF] };
const dataDir = `${process.env.TMPDIR ?? "/tmp"}/astro-test-${process.pid}`;

/** sábado 21:00 en Argentina: local abierto */
const reloj = () => new Date("2026-11-22T00:00:00Z");

type Paso = { tools?: { name: string; input: unknown }[]; text?: string };

/** Cliente falso: devuelve respuestas guionadas y registra lo que recibe. */
function clienteFalso(guion: Paso[], comprobante: unknown) {
  const llamadas: any[] = [];
  let n = 0;
  const create = async (params: any) => {
    llamadas.push(structuredClone(params));
    const paso = guion.shift();
    if (!paso) throw new Error("el guion se quedó sin pasos");
    if (paso.tools) {
      return {
        stop_reason: "tool_use",
        content: [{ type: "thinking", thinking: "", signature: "x" }, ...paso.tools.map((t) => ({ type: "tool_use", id: `tu_${++n}`, name: t.name, input: t.input }))],
      };
    }
    return { stop_reason: "end_turn", content: [{ type: "text", text: paso.text }] };
  };
  const parse = async () => ({ stop_reason: "end_turn", parsed_output: comprobante });
  return { client: { beta: { messages: { create, parse } } } as unknown as Anthropic, llamadas };
}

function bandeja() {
  const enviados: { tel: string; texto: string }[] = [];
  const m: Mensajero = { enviarTexto: async (tel, texto) => void enviados.push({ tel, texto }) };
  return { m, enviados };
}

test("pedido completo por transferencia: agrega, confirma, verifica comprobante y manda comanda", async () => {
  const guion: Paso[] = [
    // turno 1
    {
      tools: [
        {
          name: "agregar_productos",
          input: {
            items: [
              { producto_id: "doble-orbita", cantidad: 2, sin_ingredientes: ["cebolla caramelizada"], extras: ["huevo"] },
              { producto_id: "pizza-muzza", opciones: [{ grupo: "tamaño", valor: "grande" }], observacion: "con piso" },
            ],
          },
        },
      ],
    },
    { text: "¡Listo! Dos Doble Órbita y una muzza con piso. ¿Delivery o take away?" },
    // turno 2
    {
      tools: [
        { name: "configurar_entrega", input: { modo: "delivery", direccion: "Mitre 1234", entre_calles: "Peron y Belgrano", zona_id: "z1" } },
        { name: "datos_cliente", input: { nombre: "Lucía" } },
        { name: "elegir_pago", input: { metodo: "transferencia" } },
      ],
    },
    { text: "Perfecto Lucía. ¿Confirmamos?" },
    // turno 3
    { tools: [{ name: "confirmar_pedido", input: {} }] },
    { text: "¡Gracias! Te espero con el comprobante 🚀" },
  ];
  const total = (12800 + 1000) * 2 + 10000 + 1500;
  const { client, llamadas } = clienteFalso(guion, {
    es_comprobante: true,
    legible: true,
    monto: total,
    fecha_hora: "2026-11-21T21:03",
    destinatario_nombre: negocio.pago.titular,
    destinatario_alias_cvu: negocio.pago.alias,
    origen_nombre: "Lucía Gómez",
    numero_operacion: "99887766",
    entidad: "Mercado Pago",
    estado: "aprobada",
    signos_de_edicion: false,
    observaciones: "",
  });
  const store = new Store(":memory:");
  const { m, enviados } = bandeja();
  const bot = new Bot({ store, menu, negocio, client, mensajero: m, reloj, dataDir, esperaRafagaMs: 0 });

  await bot.recibir(CLIENTE, { tipo: "texto", texto: "hola! quiero 2 doble orbita sin cebolla con huevo y una muzza grande con piso" });
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "delivery a Mitre 1234 entre Perón y Belgrano, soy Lucía, pago por transferencia" });
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "sí confirmo" });

  const alCliente = enviados.filter((e) => e.tel === CLIENTE).map((e) => e.texto);
  const ticket = alCliente.find((t) => t.includes("TOTAL"))!;
  assert.ok(ticket, "se envió el ticket");
  assert.match(ticket, new RegExp(`TOTAL: \\$${total.toLocaleString("es-AR")}`));
  assert.match(ticket, /Tiempo estimado: \*\d+ a \d+ minutos\*/);
  assert.ok(alCliente.some((t) => t.includes(negocio.pago.alias)), "se envió el alias");
  assert.equal(store.pedido(1)!.estado, "esperando_pago");
  assert.ok(!enviados.some((e) => e.tel === COCINA), "sin pago no va a cocina");

  // el historial se mantiene solo-agregar entre turnos
  const h2 = llamadas[2].messages;
  const h3 = llamadas[4].messages;
  assert.deepEqual(h3.slice(0, h2.length), h2);
  assert.equal(llamadas[0].system[0].text, llamadas[4].system[0].text);

  await bot.recibir(CLIENTE, { tipo: "imagen", datos: Buffer.from("fake"), mime: "image/jpeg" });
  assert.equal(store.pedido(1)!.estado, "en_cocina");
  assert.equal(store.pedido(1)!.pagoVerificado, true);
  const comanda = enviados.find((e) => e.tel === COCINA)?.texto ?? "";
  assert.match(comanda, /COMANDA #0001/);
  assert.match(comanda, /SIN: CEBOLLA CARAMELIZADA/);
  assert.match(comanda, /OBS: con piso/);
  assert.match(comanda, /VERIFICADA/);
  assert.ok(enviados.some((e) => e.tel === CLIENTE && e.texto.includes("Pago recibido")));

  // el mismo comprobante no sirve para otro pedido
  assert.ok(store.operacionYaUsada("99887766", 2));

  // staff marca salida y entrega
  assert.match((await comandoStaff(bot, "pedidos"))!, /#1 🔥 en cocina · Lucía/);
  await comandoStaff(bot, "sale 1");
  assert.ok(enviados.some((e) => e.tel === CLIENTE && e.texto.includes("salió")));
  await comandoStaff(bot, "entregado 1");
  assert.equal(store.pedido(1)!.estado, "entregado");
  assert.equal(guion.length, 0);
});

test("efectivo va directo a cocina; errores de herramientas vuelven al modelo", async () => {
  const guion: Paso[] = [
    { tools: [{ name: "agregar_productos", input: { items: [{ producto_id: "mila-napolitana" }] } }] },
    { text: "¿De ternera o pollo? ¿Y con qué guarnición?" },
    {
      tools: [
        {
          name: "agregar_productos",
          input: {
            items: [
              {
                producto_id: "mila-napolitana",
                opciones: [
                  { grupo: "carne", valor: "pollo" },
                  { grupo: "guarnición", valor: "pure" },
                ],
              },
            ],
          },
        },
        { name: "configurar_entrega", input: { modo: "take_away" } },
        { name: "datos_cliente", input: { nombre: "Tomás" } },
        { name: "elegir_pago", input: { metodo: "efectivo", paga_con: 20000 } },
        { name: "confirmar_pedido", input: {} },
      ],
    },
    { text: "¡Gracias Tomás!" },
  ];
  const { client, llamadas } = clienteFalso(guion, null);
  const store = new Store(":memory:");
  const { m, enviados } = bandeja();
  const bot = new Bot({ store, menu, negocio, client, mensajero: m, reloj, dataDir, esperaRafagaMs: 0 });

  await bot.recibir(CLIENTE, { tipo: "texto", texto: "una mila napo" });
  const resultado = llamadas[1].messages.at(-1).content[0];
  assert.equal(resultado.is_error, undefined);
  assert.match(resultado.content, /ERRORES.*Falta elegir carne/);

  await bot.recibir(CLIENTE, { tipo: "texto", texto: "pollo con puré, retiro yo, soy Tomás, pago con 20 mil, confirmá" });
  assert.equal(store.pedido(1)!.estado, "en_cocina");
  const comanda = enviados.find((e) => e.tel === COCINA)!.texto;
  assert.match(comanda, /TAKE AWAY/);
  assert.match(comanda, /COBRAR \$13\.000 · paga con \$20\.000 · llevar vuelto \$7\.000/);
});

test("fuera de horario no se puede confirmar", async () => {
  const guion: Paso[] = [
    {
      tools: [
        { name: "agregar_productos", input: { items: [{ producto_id: "agua" }] } },
        { name: "configurar_entrega", input: { modo: "take_away" } },
        { name: "datos_cliente", input: { nombre: "Ana" } },
        { name: "elegir_pago", input: { metodo: "efectivo" } },
        { name: "confirmar_pedido", input: {} },
      ],
    },
    { text: "Estamos cerrados" },
  ];
  const { client, llamadas } = clienteFalso(guion, null);
  const { m } = bandeja();
  const store = new Store(":memory:");
  const bot = new Bot({ store, menu, negocio, client, mensajero: m, reloj: () => new Date("2026-11-23T23:00:00Z"), dataDir, esperaRafagaMs: 0 }); // lunes
  await bot.recibir(CLIENTE, { tipo: "texto", texto: "un agua" });
  const res = llamadas[1].messages.at(-1).content.at(-1);
  assert.equal(res.is_error, true);
  assert.match(res.content, /cerrado/);
  assert.equal(store.pedido(1)!.estado, "armando");
});
