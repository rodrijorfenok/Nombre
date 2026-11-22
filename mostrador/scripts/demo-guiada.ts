/**
 * Genera la demo guiada de un local: una página que reproduce conversaciones de ejemplo
 * (chat del cliente + WhatsApp del local) sin servidor ni IA, para mostrar el producto gratis.
 *   npm run demo-guiada -- comidas-jn
 *
 * Las situaciones se escriben en clientes/<local>/demo.json. Todo lo que calcula el sistema
 * (carta, precios, totales, tiempos, comandas, avisos, comprobantes, resumen de ventas) sale
 * del motor real del bot; solo las frases libres del asistente están escritas en el guion.
 * Si cambian los precios, se vuelve a correr y la página queda al día.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { Bot, disyuntor } from "../src/bot.ts";
import { cargarConfig, env, type Menu } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { pesos } from "../src/money.ts";
import { agregarLinea, calcularTotales } from "../src/order.ts";
import { comandoStaff } from "../src/staff.ts";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const slug = process.argv[2];
if (!slug) {
  console.error("Uso: npm run demo-guiada -- <local>");
  process.exit(1);
}
const dir = path.join(env.clientesDir, slug);
const archivoDemo = path.join(dir, "demo.json");
if (!fs.existsSync(archivoDemo)) {
  console.error(`Falta ${archivoDemo} con las situaciones de la demo (mirá clientes/comidas-jn/demo.json de ejemplo).`);
  process.exit(1);
}
const { menu, negocio: base } = cargarConfig(dir);
const negocio = { ...base, equipo: { encargados: ["local"], cocina: ["local"] }, integraciones: { webhookPedidos: "" } };
const CLIENTE = "5491100000000";

type Paso = { cliente?: string; foto?: string; local?: string };
type Ia = { herramientas?: [string, unknown][]; texto?: string };
interface Escenario {
  id: string;
  titulo: string;
  desc: string;
  hora: string;
  pasos: Paso[];
  ia: Ia[];
  comprobante?: Record<string, unknown>;
  pedidosPrevios?: boolean;
}
type Ev = { de: "cliente" | "bot" | "cocina" | "encargado"; texto: string; nota?: string; monto?: string };

const ar = (s: string) => new Date(`${s}:00-03:00`);

/** Pedidos de ejemplo de la noche, para que el resumen de ventas muestre números. */
function cargarNocheDeEjemplo(store: Store, m: Menu, inicio: Date) {
  const elegibles = m.productos.filter((p) => p.disponible);
  for (let i = 0; i < 18; i++) {
    const prod = elegibles[[0, 3, 1, 0, 4, 3, 0, 7, 1, 3, 0, 12, 4, 0, 3, 16, 1, 0][i] % elegibles.length];
    const hora = new Date(inicio.getTime() + (5 + i * 11) * 60_000);
    const p = store.crearPedido(`54911000${String(i).padStart(5, "0")}`, hora);
    agregarLinea(m, p, { producto_id: prod.id, cantidad: 1 + (i % 3 === 0 ? 1 : 0), opciones: prod.opciones.map((g) => ({ grupo: g.grupo, valor: g.valores[0].id })) });
    p.entrega = i % 3 === 1 ? { modo: "take_away" } : { modo: "delivery", zonaId: negocio.delivery.zonas[i % Math.max(1, negocio.delivery.zonas.length)]?.id };
    p.pago = i % 2 ? { metodo: "efectivo" } : { metodo: "transferencia" };
    p.pagoVerificado = p.pago.metodo === "transferencia";
    p.confirmadoEn = hora.toISOString();
    p.estado = "entregado";
    store.guardarPedido(p);
  }
}

async function correr(e: Escenario): Promise<Ev[]> {
  disyuntor.abiertoHasta = 0;
  const evs: Ev[] = [];
  const guion = [...e.ia];
  let n = 0;
  const reloj = ar(e.hora);
  const total = { valor: 0 };
  const client = {
    beta: {
      messages: {
        create: async (params: { messages: { content: { content?: string }[] }[] }) => {
          const p = guion.shift();
          if (!p) throw new Error(`[${e.id}] el guion de IA se quedó sin pasos`);
          if (p.herramientas) {
            return { stop_reason: "tool_use", content: p.herramientas.map(([name, input]) => ({ type: "tool_use", id: `t${++n}`, name, input })) };
          }
          let texto = p.texto ?? "";
          if (texto === "__RESUMEN__") {
            // el asistente copia el resumen que devolvió ver_pedido y el tiempo de estado_local
            const res = params.messages.at(-1)!.content.map((b) => b.content ?? "").join("\n");
            const resumen = res.slice(res.indexOf("🧾")).split("\n\nTodo listo")[0].split("\n\nFALTA")[0];
            const t = res.match(/Tiempo estimado para este pedido: (\d+)–(\d+) min/);
            texto = `Te paso cómo quedó:\n\n${resumen}\n\n${t ? `⏱️ Tiempo estimado: ${t[1]} a ${t[2]} minutos.\n` : ""}¿Confirmamos?`;
          }
          return { stop_reason: "end_turn", content: [{ type: "text", text: texto }] };
        },
        parse: async () => ({
          stop_reason: "end_turn",
          parsed_output: {
            es_comprobante: true,
            legible: true,
            monto: total.valor,
            fecha_hora: e.hora,
            destinatario_nombre: negocio.pago.titular,
            destinatario_alias_cvu: negocio.pago.alias,
            origen_nombre: "Cliente",
            numero_operacion: "98123456789",
            entidad: "Mercado Pago",
            estado: "Aprobada",
            signos_de_edicion: false,
            observaciones: "",
            ...e.comprobante,
          },
        }),
      },
    },
  } as unknown as Anthropic;
  const store = new Store(":memory:");
  if (e.pedidosPrevios) cargarNocheDeEjemplo(store, menu, ar(`${e.hora.slice(0, 10)}T20:00`));
  const bot = new Bot({
    store,
    menu,
    negocio,
    client,
    reloj: () => reloj,
    esperaRafagaMs: 0,
    dataDir: path.join(env.dataDir, "demo-guiada"),
    mensajero: { enviarTexto: async (tel, texto) => void evs.push({ de: tel === CLIENTE ? "bot" : "cocina", texto }) },
  });
  for (const paso of e.pasos) {
    if (paso.cliente) {
      evs.push({ de: "cliente", texto: paso.cliente });
      await bot.recibir(CLIENTE, { tipo: "texto", texto: paso.cliente });
    } else if (paso.foto !== undefined) {
      const conv = store.conversacion(CLIENTE)!;
      total.valor = calcularTotales(menu, negocio, store.pedido(conv.pedidoId!)!).total;
      evs.push({ de: "cliente", texto: "📷 Comprobante de transferencia", nota: paso.foto, monto: pesos(total.valor) });
      await bot.recibir(CLIENTE, { tipo: "imagen", datos: Buffer.from("x"), mime: "image/jpeg" });
    } else if (paso.local) {
      evs.push({ de: "encargado", texto: paso.local });
      const r = await comandoStaff(bot, paso.local);
      if (r) evs.push({ de: "cocina", texto: r });
    }
  }
  if (guion.length) throw new Error(`[${e.id}] sobraron ${guion.length} pasos de IA en el guion: revisá demo.json`);
  return evs;
}

const demo = JSON.parse(fs.readFileSync(archivoDemo, "utf8")) as { escenarios: Escenario[] };
const datos: Record<string, { titulo: string; desc: string; evs: Ev[] }> = {};
for (const e of demo.escenarios) datos[e.id] = { titulo: e.titulo, desc: e.desc, evs: await correr(e) };

const plantilla = fs.readFileSync(path.join(aqui, "demo-guiada.html"), "utf8");
const html = plantilla.replaceAll("__NOMBRE__", negocio.nombre.replace(/[<>&"]/g, "")).replace("__DATOS__", JSON.stringify(datos).replace(/<\//g, "<\\/"));
const salidas = [path.join("docs", "demo-guiada", `${slug}.html`)];
if (fs.existsSync(path.join("..", "docs"))) salidas.push(path.join("..", "docs", `${slug}.html`));
for (const s of salidas) {
  fs.mkdirSync(path.dirname(s), { recursive: true });
  fs.writeFileSync(s, html);
  console.log(`✅ ${s}`);
}
console.log(`${demo.escenarios.length} situaciones · ${Object.values(datos).reduce((a, d) => a + d.evs.length, 0)} mensajes`);
