// Verifica que la capa ai.js arma bien los pedidos a la API de Anthropic usando
// un servidor falso (sin costo): modelo, fallbacks, effort, salida estructurada y herramientas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";

const pedidos = [];
let respuestas = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    pedidos.push({ headers: req.headers, body: JSON.parse(body) });
    const content = respuestas.shift();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
      content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
});

let ai;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ESCALA_MOCK;
  ai = await import("../src/ai.js");
});
after(() => server.close());

test("runStructured: usa el modelo, fallbacks y formato JSON", async () => {
  respuestas = [[{ type: "text", text: JSON.stringify({ puntaje: 80 }) }]];
  const { data } = await ai.runStructured({ agent: "x", system: "s", prompt: "p", schema: z.object({ puntaje: z.number() }), effort: "low" });
  assert.deepEqual(data, { puntaje: 80 });
  const p = pedidos.at(-1);
  assert.equal(p.body.model, "claude-opus-5-5");
  assert.equal(p.body.fallbacks, "default");
  assert.match(p.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(p.body.output_config.effort, "low");
  assert.equal(p.body.output_config.format.type, "json_schema");
});

test("runText: envía las herramientas web del servidor", async () => {
  respuestas = [[{ type: "text", text: "# Informe" }]];
  const { text } = await ai.runText({ agent: "x", system: "s", prompt: "p", serverTools: [ai.WEB_TOOLS.fetch(3)] });
  assert.equal(text, "# Informe");
  assert.equal(pedidos.at(-1).body.tools[0].type, "web_fetch_20260209");
});

test("runChat: ejecuta la herramienta propia y devuelve la respuesta final", async () => {
  const { betaZodTool } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  let guardado = null;
  const tool = betaZodTool({ name: "registrar_lead", description: "d", inputSchema: z.object({ nombre: z.string() }), run: async (i) => { guardado = i; return "ok"; } });
  respuestas = [
    [{ type: "tool_use", id: "tu_1", name: "registrar_lead", input: { nombre: "Ana" } }],
    [{ type: "text", text: "¡Listo, Ana!" }],
  ];
  const { text } = await ai.runChat({ agent: "x", system: "s", history: [{ role: "user", text: "hola" }], tools: [tool] });
  assert.equal(text, "¡Listo, Ana!");
  assert.deepEqual(guardado, { nombre: "Ana" });
  const ultimo = pedidos.at(-1).body.messages.at(-1);
  assert.equal(ultimo.content[0].type, "tool_result");
});

test("runChat: el estado del CRM va como mensaje de sistema al final y el prompt se cachea", async () => {
  respuestas = [[{ type: "text", text: "ok" }]];
  await ai.runChat({ agent: "x", system: "s", history: [{ role: "user", text: "hola" }], tools: [], estado: "Estado del CRM: lead registrado." });
  const body = pedidos.at(-1).body;
  assert.deepEqual(body.messages.at(-1), { role: "system", content: "Estado del CRM: lead registrado." });
  assert.equal(body.system[0].cache_control.type, "ephemeral");
});

test("runStructured: activa el caché automático del prompt", async () => {
  respuestas = [[{ type: "text", text: JSON.stringify({ a: 1 }) }]];
  await ai.runStructured({ agent: "x", system: "s", prompt: "p", schema: z.object({ a: z.number() }) });
  assert.equal(pedidos.at(-1).body.cache_control.type, "ephemeral");
});

test("telemetría: calcula el costo con tokens, caché y búsquedas", async () => {
  const { costoDe } = await import("../src/telemetria.js");
  const c = costoDe({ input_tokens: 1e6, output_tokens: 1e5, cache_read_input_tokens: 1e6, server_tool_use: { web_search_requests: 10 } }, "claude-opus-5-5");
  assert.equal(Number(c.toFixed(4)), 4 + 2 + 0.2 + 0.1);
});

test("rechazo del modelo se informa como error claro", async () => {
  respuestas = [[]];
  const orig = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    req.resume(); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: null }, usage: { input_tokens: 1, output_tokens: 0 } }));
    });
  });
  await assert.rejects(ai.runText({ agent: "x", system: "s", prompt: "p" }), (e) => e.code === "refusal");
  server.removeAllListeners("request");
  server.on("request", orig);
});

test("API key inválida se traduce a un mensaje accionable", async () => {
  const orig = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", (req, res) => { req.resume(); req.on("end", () => { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })); }); });
  await assert.rejects(ai.runText({ agent: "x", system: "s", prompt: "p" }), (e) => e.code === "auth");
  server.removeAllListeners("request");
  server.on("request", orig);
});
