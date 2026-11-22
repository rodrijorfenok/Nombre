/**
 * Prueba la lectura de comprobantes con la IA real, con capturas o PDFs de verdad.
 *   npm run probar-comprobante -- <local> <total del pedido> <archivo> [archivo…]
 *   npm run probar-comprobante -- comidas-jn 23500 captura.jpg
 *
 * Muestra lo que leyó la IA y el veredicto de las reglas (aprobado / revisar / rechazado).
 * Supone que el pedido se creó hace 10 minutos.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MediaType } from "../src/bot.ts";
import { evaluarComprobante, extraerDatosComprobante } from "../src/comprobantes.ts";
import { cargarConfig, env } from "../src/config.ts";
import { pesos } from "../src/money.ts";

const [slug, totalTxt, ...archivos] = process.argv.slice(2);
if (!slug || !totalTxt || !archivos.length) {
  console.error("Uso: npm run probar-comprobante -- <local> <total> <archivo> [archivo…]");
  process.exit(1);
}
const total = Number(totalTxt.replace(/\D/g, ""));
const { negocio } = cargarConfig(path.join(env.clientesDir, slug));
const client = new Anthropic({ maxRetries: 3 });
const tipos: Record<string, MediaType> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };

console.log(`Local: ${negocio.nombre} · cuenta ${negocio.pago.alias} (${negocio.pago.titular}) · total esperado ${pesos(total)} · modelo ${env.model}`);
for (const archivo of archivos) {
  const mime = tipos[path.extname(archivo).toLowerCase()];
  if (!mime) {
    console.log(`\n${archivo}: formato no soportado`);
    continue;
  }
  const t0 = Date.now();
  const datos = await extraerDatosComprobante(client, fs.readFileSync(archivo), mime);
  const r = evaluarComprobante(datos, { total, negocio, pedidoCreadoEn: new Date(Date.now() - 10 * 60_000) });
  const icono = { aprobado: "✅", revisar: "🔎", rechazado: "❌", parcial: "➗" }[r.veredicto];
  console.log(`\n${icono} ${path.basename(archivo)} → ${r.veredicto.toUpperCase()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`   Leído: monto ${datos?.monto ?? "?"} · fecha ${datos?.fecha_hora ?? "?"} · para ${datos?.destinatario_nombre ?? "?"} (${datos?.destinatario_alias_cvu ?? "?"}) · operación ${datos?.numero_operacion ?? "?"} · estado ${datos?.estado ?? "?"}`);
  console.log(`   Motivos: ${r.motivos.join("; ")}`);
  console.log(`   Al cliente: ${r.mensajeCliente}`);
}
