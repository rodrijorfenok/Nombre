/**
 * Prueba de carga: muchos clientes pidiendo AL MISMO TIEMPO.
 *   npm run carga -- 300 1500     (300 clientes, IA simulada que tarda ~1,5 s por respuesta)
 *
 * La IA es de mentira (no gasta nada), pero tarda lo mismo que la real, así se mide
 * el comportamiento del bot: colas, base de datos, que no se mezclen pedidos ni se pierdan mensajes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, semaforoIA, type Mensajero } from "../src/bot.ts";
import { cargarConfig } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { calcularTotales } from "../src/order.ts";

const CLIENTES = Number(process.argv[2] ?? 300);
const LATENCIA_IA_MS = Number(process.argv[3] ?? 1500);

const { menu, negocio } = cargarConfig("clientes/astroburguer");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carga-"));
const store = new Store(path.join(dir, "pedidos.db"));
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let llamadasIA = 0;
let id = 0;
/** IA falsa: decide qué herramienta usar según el último mensaje, como lo haría la real. */
const iaFalsa = {
  beta: {
    messages: {
      create: async (p: any) => {
        llamadasIA++;
        await espera(LATENCIA_IA_MS * (0.6 + Math.random() * 0.8));
        const ultimo = p.messages.at(-1);
        const texto = typeof ultimo.content === "string" ? ultimo.content : (ultimo.content.find((b: any) => b.type === "text")?.text ?? "");
        const tool = (name: string, input: unknown) => ({ type: "tool_use", id: `t${++id}`, name, input });
        if (ultimo.content?.[0]?.type === "tool_result") return { stop_reason: "end_turn", content: [{ type: "text", text: "¡Listo! 👌" }] };
        if (/quiero/.test(texto))
          return {
            stop_reason: "tool_use",
            content: [
              tool("agregar_productos", {
                items: [
                  { producto_id: "doble-orbita", cantidad: 2, sin_ingredientes: ["cebolla caramelizada"] },
                  { producto_id: "coca-15", opciones: [{ grupo: "sabor", valor: "zero" }] },
                ],
              }),
            ],
          };
        if (/retiro/.test(texto)) {
          const nombre = texto.match(/soy (\w+)/)?.[1] ?? "Cliente";
          return {
            stop_reason: "tool_use",
            content: [tool("configurar_entrega", { modo: "take_away" }), tool("datos_cliente", { nombre }), tool("elegir_pago", { metodo: "efectivo", paga_con: 40000 })],
          };
        }
        if (/confirmo/.test(texto)) return { stop_reason: "tool_use", content: [tool("confirmar_pedido", {})] };
        return { stop_reason: "end_turn", content: [{ type: "text", text: "¿Qué te preparo?" }] };
      },
    },
  },
} as unknown as Anthropic;

const recibidos = new Map<string, string[]>();
const mensajero: Mensajero = {
  async enviarTexto(tel, texto) {
    await espera(80); // lo que tarda la API de WhatsApp
    if (!recibidos.has(tel)) recibidos.set(tel, []);
    recibidos.get(tel)!.push(texto);
  },
};

const bot = new Bot({
  store,
  menu,
  negocio,
  client: iaFalsa,
  mensajero,
  dataDir: dir,
  esperaRafagaMs: 1500,
  reloj: () => new Date("2026-11-22T00:00:00Z"), // sábado 21 h: abierto
});

const tiempos: number[] = [];
async function cliente(n: number) {
  const tel = `54911${String(n).padStart(8, "0")}`;
  const enviar = async (texto: string) => {
    const t0 = Date.now();
    await bot.recibir(tel, { tipo: "texto", texto });
    tiempos.push(Date.now() - t0);
  };
  await espera(Math.random() * 3000); // llegan casi todos juntos, en 3 segundos
  await enviar("hola");
  // ráfaga: dos mensajes seguidos que el bot debe juntar
  await Promise.all([enviar("quiero 2 doble orbita sin cebolla"), espera(300).then(() => enviar("y una coca zero"))]);
  await enviar(`retiro yo, soy Cliente${n}, pago en efectivo`);
  await enviar("confirmo");
  return tel;
}

console.log(`🚦 ${CLIENTES} clientes simultáneos · IA simulada ~${LATENCIA_IA_MS} ms · máximo ${semaforoIA.maximo} consultas a la IA en paralelo\n`);
const inicio = Date.now();
const monitor = setInterval(() => process.stdout.write(`  IA en uso ${semaforoIA.enUso}/${semaforoIA.maximo} · en fila ${semaforoIA.enEspera}        \r`), 500);
const telefonos = await Promise.all(Array.from({ length: CLIENTES }, (_, i) => cliente(i)));
clearInterval(monitor);
const total = (Date.now() - inicio) / 1000;

// Verificación: cada cliente tiene SU pedido, correcto y en cocina.
let ok = 0;
const fallas: string[] = [];
const esperado = 2 * 12800 + 4000;
for (const tel of telefonos) {
  const conv = store.conversacion(tel);
  const p = conv?.pedidoId ? store.pedido(conv.pedidoId) : null;
  const t = p ? calcularTotales(menu, negocio, p).total : 0;
  if (p?.estado === "en_cocina" && t === esperado && p.telefono === tel && p.lineas.length === 2) ok++;
  else fallas.push(`${tel}: estado=${p?.estado} total=${t} lineas=${p?.lineas.length}`);
}
const orden = [...tiempos].sort((a, b) => a - b);
const pct = (q: number) => (orden[Math.floor(q * (orden.length - 1))] / 1000).toFixed(1);

console.log(`\n✅ Pedidos correctos: ${ok}/${CLIENTES}`);
if (fallas.length) console.log(`❌ Fallas:\n${fallas.slice(0, 10).join("\n")}`);
console.log(`⏱️  Tiempo total: ${total.toFixed(1)} s · consultas a la IA: ${llamadasIA} (las ráfagas se juntaron y el saludo no usó IA)`);
console.log(`📨 Espera por mensaje (incluye la IA y la espera de ráfaga de 1,5 s): mediana ${pct(0.5)} s · p95 ${pct(0.95)} s · máximo ${pct(1)} s`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fallas.length ? 1 : 0);
