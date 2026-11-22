/**
 * Simulador de WhatsApp en la terminal, para probar el bot sin Meta.
 *   npm run chat
 * Comandos:  /foto <ruta>   envía una imagen (comprobante)
 *            /ubicacion     envía una ubicación de prueba
 *            /staff <cmd>   ejecuta un comando del local (ej: /staff pedidos)
 *            /salir
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { Bot, type MediaType, type Mensajero } from "./bot.ts";
import { cargarConfig, env } from "./config.ts";
import { Store } from "./db.ts";
import { comandoStaff } from "./staff.ts";

const CLIENTE = "5491100000000";

const consola: Mensajero = {
  async enviarTexto(tel, texto) {
    const quien = tel === CLIENTE ? "🤖 Astroburguer" : `📟 a ${tel}`;
    console.log(`\n\x1b[36m${quien}:\x1b[0m\n${texto}\n`);
  },
};

const { menu, negocio } = cargarConfig();
const store = new Store(process.env.DB_PATH ?? "data/simulador.db");
const bot = new Bot(store, menu, negocio, new Anthropic(), consola);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Simulador de ${negocio.nombre} (modelo ${env.model}). Escribí como si fueras un cliente. /salir para terminar.\n`);
for (;;) {
  const linea = (await rl.question("\x1b[33m👤 Vos:\x1b[0m ")).trim();
  if (!linea) continue;
  if (linea === "/salir") break;
  if (linea.startsWith("/foto ")) {
    const ruta = linea.slice(6).trim();
    const ext = ruta.split(".").pop()!.toLowerCase();
    const mime = (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg") as MediaType;
    await bot.recibir(CLIENTE, { tipo: "imagen", datos: fs.readFileSync(ruta), mime });
  } else if (linea === "/ubicacion") {
    await bot.recibir(CLIENTE, { tipo: "ubicacion", lat: -34.543, lng: -58.712, direccion: "Ubicación de prueba" });
  } else if (linea.startsWith("/staff ")) {
    console.log((await comandoStaff(bot, linea.slice(7))) ?? "Comando no reconocido. Probá /staff ayuda");
  } else {
    await bot.recibir(CLIENTE, { tipo: "texto", texto: linea });
  }
}
rl.close();
