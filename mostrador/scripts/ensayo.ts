/**
 * Ensayo con la IA real: simula clientes típicos contra el bot y verifica que el pedido quede bien.
 * Usa la clave de Claude (ANTHROPIC_API_KEY) y gasta unos pocos centavos de dólar por corrida.
 *   npm run ensayo                 (local comidas-jn)
 *   npm run ensayo -- comidas-jn
 *
 * Cada caso muestra la conversación completa y al final un ✅/❌ por cada verificación.
 * Las verificaciones miran el pedido guardado (productos, opciones, total, derivaciones), no el texto,
 * así que no dependen de cómo redacte la IA.
 */
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Bot, disyuntor } from "../src/bot.ts";
import { cargarConfig, env } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { calcularTotales, type Pedido } from "../src/order.ts";

const slug = process.argv[2] ?? "comidas-jn";
const { menu, negocio: base } = cargarConfig(path.join(env.clientesDir, slug));
const negocio = { ...base, equipo: { encargados: ["local"], cocina: ["local"] } };
const CLIENTE = "5491100000000";

interface Caso {
  nombre: string;
  mensajes: string[];
  verificar: (p: Pedido, ctx: { derivado: boolean; respuestas: string[] }) => [string, boolean][];
}

const tiene = (p: Pedido, id: string, f: (l: Pedido["lineas"][number]) => boolean = () => true) => p.lineas.some((l) => l.productoId === id && f(l));
const total = (p: Pedido) => calcularTotales(menu, negocio, p).total;

const CASOS: Record<string, Caso[]> = {
  "comidas-jn": [
    {
      nombre: "Pedido completo, take away, efectivo",
      mensajes: [
        "hola! quiero 2 cuartos de libra dobles, uno con coca y otro con sprite, el de sprite sin cebolla",
        "lo paso a buscar yo, soy Lucas, pago en efectivo con 30 mil",
        "sí, confirmo",
      ],
      verificar: (p) => [
        ["2 Cuarto de Libra dobles cargados", p.lineas.filter((l) => l.productoId === "cuarto-de-libra" && l.opciones["tamaño"] === "doble").reduce((a, l) => a + l.cantidad, 0) === 2],
        ["uno con Coca y otro con Sprite", tiene(p, "cuarto-de-libra", (l) => l.opciones.bebida === "coca") && tiene(p, "cuarto-de-libra", (l) => l.opciones.bebida === "sprite")],
        ["el de Sprite sin cebolla", tiene(p, "cuarto-de-libra", (l) => l.opciones.bebida === "sprite" && l.sinIngredientes.some((s) => /cebolla/i.test(s)))],
        ["take away, efectivo, nombre", p.entrega?.modo === "take_away" && p.pago?.metodo === "efectivo" && /lucas/i.test(p.cliente ?? "")],
        ["confirmado y en cocina", p.estado === "en_cocina"],
        ["total $27.000", total(p) === 27000],
      ],
    },
    {
      nombre: "Promo con pizza especial y pizza con piso",
      mensajes: ["buenas, una promo 1 con la de calabresa, la muzza con piso porfa", "delivery a 5 cuadras, Marconi 1200. soy Ana. transferencia"],
      verificar: (p) => [
        ["Promo N°1 con calabresa", tiene(p, "promo-1", (l) => l.opciones["pizza especial"] === "calabresa")],
        ['observación "con piso"', tiene(p, "promo-1", (l) => /piso/i.test(l.observacion))],
        ["delivery zona 1", p.entrega?.modo === "delivery" && p.entrega.zonaId === "z1"],
        ["todavía no confirmado (espera el sí del cliente)", p.estado === "armando"],
      ],
    },
    {
      nombre: "Agregado en hamburguesa: debe derivar",
      mensajes: ["hola, una super americana simple con coca y agregale cheddar extra"],
      verificar: (_p, c) => [["derivó a una persona", c.derivado]],
    },
    {
      nombre: "Pregunta de precio sin pedir",
      mensajes: ["cuánto sale la pizza jn?"],
      verificar: (p, c) => [
        ["menciona $15.000", c.respuestas.some((r) => /15\.000/.test(r))],
        ["no cargó nada sin que lo pida", p.lineas.length === 0],
      ],
    },
    {
      nombre: "Escritura rápida con errores",
      mensajes: ["kiero 2 muzzas y una napo comen 2"],
      verificar: (p) => [
        ["2 pizzas muzzarella (o la Promo N°2 no)", tiene(p, "pizza-muzzarella", (l) => l.cantidad === 2) || p.lineas.filter((l) => l.productoId === "pizza-muzzarella").length === 2],
        ['Napolitana "Comen 2"', tiene(p, "napo-comen-2")],
      ],
    },
  ],
};

const genericos: Caso[] = [
  { nombre: "Pide hablar con una persona", mensajes: ["quiero hablar con una persona"], verificar: (_p, c) => [["derivó a una persona", c.derivado]] },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("Falta ANTHROPIC_API_KEY (cargala en .env). El ensayo usa la IA real.");
    process.exit(1);
  }
  const client = new Anthropic({ maxRetries: 3 });
  const casos = [...(CASOS[slug] ?? []), ...genericos];
  let ok = 0;
  let totalChecks = 0;
  for (const caso of casos) {
    disyuntor.abiertoHasta = 0;
    const respuestas: string[] = [];
    let derivado = false;
    const store = new Store(":memory:");
    store.setAjuste("abierto_manual", "1");
    const bot = new Bot({
      store,
      menu,
      negocio,
      client,
      esperaRafagaMs: 0,
      dataDir: path.join(env.dataDir, "ensayo"),
      mensajero: {
        enviarTexto: async (tel, texto) => {
          if (tel === CLIENTE) respuestas.push(texto);
          else if (/Te necesitan/.test(texto)) derivado = true;
        },
      },
    });
    console.log(`\n━━━ ${caso.nombre} ━━━`);
    const t0 = Date.now();
    for (const m of caso.mensajes) {
      console.log(`\n👤 ${m}`);
      const antes = respuestas.length;
      await bot.recibir(CLIENTE, { tipo: "texto", texto: m });
      for (const r of respuestas.slice(antes)) console.log(`🤖 ${r.replace(/\n/g, "\n   ")}`);
    }
    const conv = store.conversacion(CLIENTE)!;
    const pedido = store.pedido(conv.pedidoId!)!;
    console.log(`\n   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const [nombre, paso] of caso.verificar(pedido, { derivado, respuestas })) {
      totalChecks++;
      if (paso) ok++;
      console.log(`   ${paso ? "✅" : "❌"} ${nombre}`);
    }
  }
  console.log(`\nResultado: ${ok}/${totalChecks} verificaciones bien.`);
  process.exit(ok === totalChecks ? 0 : 1);
}

main();
