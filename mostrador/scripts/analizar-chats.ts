/**
 * Aprende de las charlas viejas del WhatsApp del local.
 *
 * 1. En el celular del local: abrir cada chat de cliente → ⋮ → Más → Exportar chat → "Sin archivos".
 *    (En iPhone se exporta un .zip: descomprimirlo; adentro está el _chat.txt.)
 * 2. Poner todos los .txt en una carpeta y correr:
 *      npm run analizar-chats -- carpeta-de-chats                 → reporte + casos sugeridos
 *      npm run analizar-chats -- carpeta-de-chats --local "Comidas JN"   si no detecta solo quién es el local
 *      npm run analizar-chats -- carpeta-de-chats --aplicar comidas-jn   además los suma a clientes/comidas-jn/negocio.json
 *      npm run analizar-chats -- carpeta-de-chats --solo-texto     solo arma el texto anónimo (sin usar la IA)
 *
 * Los casos ("situación → cómo lo resolvió el local") entran al prompt del bot: cuando pase algo parecido,
 * responde con esa misma idea. Revisalos antes de aplicarlos: el bot los va a tomar como reglas del local.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { chatComoTexto, detectarLocal, enBloques, parsearChat } from "../src/chats.ts";
import { env, soportaFallbacks } from "../src/config.ts";

const args = process.argv.slice(2);
const opcion = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const carpeta = args.find((a, i) => !a.startsWith("--") && !["--local", "--aplicar"].includes(args[i - 1] ?? ""));
if (!carpeta || !fs.existsSync(carpeta)) {
  console.error("Uso: npm run analizar-chats -- <carpeta con los .txt exportados> [--local \"Nombre\"] [--aplicar <local>] [--solo-texto]");
  process.exit(1);
}

const archivos = fs
  .readdirSync(carpeta, { recursive: true, encoding: "utf8" })
  .filter((f) => f.toLowerCase().endsWith(".txt"))
  .map((f) => path.join(carpeta, f));
const chats = archivos.map((f) => parsearChat(fs.readFileSync(f, "utf8"))).filter((c) => c.length >= 2);
const local = detectarLocal(chats, opcion("--local"));
if (!local) {
  console.error('No pude saber cuál es el local. Indicá el nombre con el que figura en los chats: --local "Comidas JN"');
  process.exit(1);
}
const textos = chats.map((c) => chatComoTexto(c, local)).filter((t) => t.includes("Local:") && t.includes("Cliente:"));
const salida = path.join(carpeta, "analisis");
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, "chats-anonimos.txt"), textos.map((t, i) => `### Chat ${i + 1}\n${t}`).join("\n\n"));
console.log(`📥 ${archivos.length} archivos · ${textos.length} chats con cliente y local · el local figura como "${local}"`);
console.log(`📝 Texto anónimo: ${path.join(salida, "chats-anonimos.txt")}`);
if (args.includes("--solo-texto")) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY (en .env) para el análisis. Con --solo-texto se arma solo el texto.");
  process.exit(1);
}

const Caso = z.object({
  situacion: z.string().describe("lo que pasó o pidió el cliente, en general (sin nombres), en una oración corta"),
  respuesta: z.string().describe("cómo lo resolvió el local, en una oración: qué se le dijo o qué se hizo"),
  veces: z.number().int().describe("en cuántos chats aparece algo parecido"),
});
const Analisis = z.object({
  casos: z.array(Caso).describe("problemas o pedidos fuera de lo común y cómo los resolvió el local"),
  preguntas_frecuentes: z.array(z.object({ pregunta: z.string(), respuesta: z.string(), veces: z.number().int() })),
  pedidos_especiales: z.array(z.string()).describe("personalizaciones que piden seguido (cambios de ingredientes, cocción, etc.)"),
  problemas: z.array(z.string()).describe("quejas o cosas que salieron mal, y por qué"),
  sugerencias: z.array(z.string()).describe("qué conviene que el bot haga o diga, según lo visto"),
});
type Analisis = z.infer<typeof Analisis>;

const PROMPT = `Estos son chats reales de WhatsApp entre un local de comida (Local) y sus clientes (Cliente), ya anonimizados.
Buscá patrones útiles para que un asistente que toma pedidos por WhatsApp responda como lo haría el local:
- casos: situaciones que se repiten o que se salen de lo común (cambios de ingredientes, pagos divididos, demoras, reclamos, pedidos que se suman, zonas, horarios, faltantes) y cómo las resolvió el local. Escribí la respuesta como regla general, no como una charla puntual.
- preguntas frecuentes con la respuesta que da el local.
- pedidos especiales que se repiten, problemas y sugerencias.
No inventes nada que no esté en los chats. No incluyas nombres, teléfonos ni direcciones de clientes. Escribí en español rioplatense, corto.`;

const client = new Anthropic();
async function analizar(texto: string, instruccion = PROMPT): Promise<Analisis> {
  const r = await client.beta.messages.parse({
    model: env.model,
    max_tokens: 16000,
    ...(soportaFallbacks(env.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: "medium", format: betaZodOutputFormat(Analisis) },
    messages: [{ role: "user", content: `${instruccion}\n\n${texto}` }],
  });
  if (!r.parsed_output) throw new Error(`La IA no devolvió el análisis (${r.stop_reason}).`);
  return r.parsed_output;
}

const bloques = enBloques(textos);
const parciales: Analisis[] = [];
for (const [i, b] of bloques.entries()) {
  console.log(`🔎 Analizando bloque ${i + 1} de ${bloques.length}…`);
  parciales.push(await analizar(b));
}
const final =
  parciales.length === 1
    ? parciales[0]
    : await analizar(
        JSON.stringify(parciales),
        "Estos son análisis parciales de chats de un local de comida. Unificalos: juntá los casos y preguntas parecidos sumando las veces, sacá los repetidos y ordená de más a menos frecuente. No agregues nada nuevo.",
      );
final.casos.sort((a, b) => b.veces - a.veces);
final.preguntas_frecuentes.sort((a, b) => b.veces - a.veces);

fs.writeFileSync(path.join(salida, "aprendizajes.json"), JSON.stringify(final, null, 2));
const md = [
  `# Lo que se aprende de ${textos.length} chats`,
  "",
  "## Casos y cómo los resolvió el local",
  ...final.casos.map((c) => `- (${c.veces}) **${c.situacion}** → ${c.respuesta}`),
  "",
  "## Preguntas frecuentes",
  ...final.preguntas_frecuentes.map((p) => `- (${p.veces}) **${p.pregunta}** → ${p.respuesta}`),
  "",
  "## Pedidos especiales",
  ...final.pedidos_especiales.map((x) => `- ${x}`),
  "",
  "## Problemas",
  ...final.problemas.map((x) => `- ${x}`),
  "",
  "## Sugerencias para el bot",
  ...final.sugerencias.map((x) => `- ${x}`),
].join("\n");
fs.writeFileSync(path.join(salida, "reporte.md"), md);
console.log(`\n${md}\n\n✅ Reporte: ${path.join(salida, "reporte.md")}`);

const slug = opcion("--aplicar");
if (slug) {
  const f = path.join(env.clientesDir, slug, "negocio.json");
  const negocio = JSON.parse(fs.readFileSync(f, "utf8"));
  negocio.asistente ??= {};
  const previos: { situacion: string; respuesta: string }[] = negocio.asistente.casos ?? [];
  const nuevos = [...final.casos, ...final.preguntas_frecuentes.map((p) => ({ situacion: p.pregunta, respuesta: p.respuesta, veces: p.veces }))]
    .filter((c) => !previos.some((p) => p.situacion.toLowerCase() === c.situacion.toLowerCase()))
    .slice(0, 40)
    .map(({ situacion, respuesta }) => ({ situacion, respuesta }));
  negocio.asistente.casos = [...previos, ...nuevos];
  fs.writeFileSync(f, `${JSON.stringify(negocio, null, 2)}\n`);
  console.log(`📌 Sumé ${nuevos.length} casos a ${f}. Revisalos y publicá para que el bot los use.`);
}
