// Capa única de acceso a Claude. Todos los agentes pasan por acá, así el modelo,
// los fallbacks por rechazo, el caché de prompts, la telemetría y el manejo de
// errores viven en un solo lugar.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "./config.js";
import { registrarPaso } from "./telemetria.js";
import * as mock from "./mock.js";

// Si un clasificador de seguridad rechaza un pedido, la API lo reintenta sola
// con el modelo de respaldo recomendado (fallbacks: "default").
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
// Caché automático: el prompt de sistema (conocimiento de la agencia) se reutiliza
// entre pedidos y se cobra a una fracción del precio.
const CACHE = { cache_control: { type: "ephemeral" } };

export class AgentError extends Error {
  constructor(message, { code = "agent_error", retryable = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 3 });
  return client;
}

function textOf(message) {
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

function checkStop(message) {
  if (message.stop_reason === "refusal") {
    throw new AgentError("El modelo no pudo completar este pedido por sus políticas de seguridad.", { code: "refusal" });
  }
  if (message.stop_reason === "max_tokens") {
    throw new AgentError("La respuesta quedó cortada por longitud. Probá con un pedido más acotado.", { code: "max_tokens" });
  }
  if (message.stop_reason === "pause_turn") {
    throw new AgentError("La investigación web tardó demasiado.", { code: "pause_turn", retryable: true });
  }
}

function translateError(err) {
  if (err instanceof AgentError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AgentError("Falta configurar una API key válida de Anthropic (ANTHROPIC_API_KEY).", { code: "auth" });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AgentError("Límite de uso de la API alcanzado.", { code: "rate_limit", retryable: true });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AgentError(`Pedido inválido a la API: ${err.message}`, { code: "bad_request" });
  }
  if (err instanceof Anthropic.APIError) {
    return new AgentError(`Error de la API (${err.status ?? "red"}): ${err.message}`, { code: "api", retryable: true });
  }
  return new AgentError(err?.message || String(err), { retryable: /network|ECONN|fetch failed|timeout/i.test(String(err?.message)) });
}

/** Mide la llamada y la registra en la traza del trabajo en curso. */
async function medir(agente, tipo, fn) {
  const t0 = Date.now();
  try {
    const { message, ...res } = await fn();
    registrarPaso({ agente, tipo, modelo: message?.model || config.model, usage: message?.usage, ms: Date.now() - t0, ok: true });
    return res;
  } catch (err) {
    const e = translateError(err);
    registrarPaso({ agente, tipo, modelo: config.model, usage: err?.usage, ms: Date.now() - t0, ok: false, error: e.message });
    throw e;
  }
}

/**
 * Respuesta en texto libre (markdown). Admite herramientas del servidor de
 * Anthropic (búsqueda y lectura web), que corren sin código de nuestro lado.
 */
export function runText({ agent, system, prompt, effort = "medium", serverTools = [], tools = [], maxTokens = 32000 }) {
  return medir(agent, "texto", async () => {
    if (config.mock) return mock.runText({ agent, prompt });
    const runner = getClient().beta.messages.toolRunner({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort },
      system,
      tools: [...serverTools, ...tools],
      messages: [{ role: "user", content: prompt }],
      max_iterations: 10,
      // Streaming: los informes largos con razonamiento alto no chocan con el límite de tiempo.
      stream: true,
      ...CACHE,
      ...FALLBACK,
    });
    const message = await runner.runUntilDone();
    checkStop(message);
    return { message, text: textOf(message) };
  });
}

/** Respuesta estructurada, validada contra un esquema Zod. */
export function runStructured({ agent, system, prompt, schema, effort = "medium", maxTokens = 16000 }) {
  return medir(agent, "estructurado", async () => {
    if (config.mock) return mock.runStructured({ agent, prompt, schema });
    // Con streaming: las respuestas largas (un calendario completo) no chocan con los
    // límites de tiempo de una petición común, y el SDK igual devuelve la salida validada.
    const stream = getClient().beta.messages.stream({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: prompt }],
      ...CACHE,
      ...FALLBACK,
    });
    const message = await stream.finalMessage();
    checkStop(message);
    if (!message.parsed_output) throw new AgentError("La respuesta no tuvo el formato esperado.", { code: "parse", retryable: true });
    return { message, data: message.parsed_output };
  });
}

/**
 * Conversación con herramientas propias (por ejemplo, registrar un lead).
 * `history` son los turnos previos en texto; `estado` es un resumen del CRM que
 * se agrega como mensaje de sistema al final, para que el agente recuerde lo que
 * ya hizo en turnos anteriores sin romper el caché del historial.
 */
export function runChat({ agent, system, history, tools, estado = "", effort = "low", maxTokens = 4000 }) {
  return medir(agent, "chat", async () => {
    if (config.mock) return mock.runChat({ agent, history, tools, estado });
    const messages = history.map((t) => ({ role: t.role, content: t.text }));
    if (estado) messages.push({ role: "system", content: estado });
    const runner = getClient().beta.messages.toolRunner({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      max_iterations: 5,
      ...FALLBACK,
    });
    const message = await runner.runUntilDone();
    checkStop(message);
    return { message, text: textOf(message) };
  });
}

export const WEB_TOOLS = {
  fetch: (maxUses = 6) => ({ type: "web_fetch_20260209", name: "web_fetch", max_uses: maxUses }),
  search: (maxUses = 4) => ({ type: "web_search_20260209", name: "web_search", max_uses: maxUses }),
};

/**
 * Bloques de contexto que se agregan al pedido de cualquier agente: memoria del
 * cliente (brief + lecciones aprendidas) y correcciones del revisor de calidad.
 */
export function contextoExtra(input = {}) {
  const partes = [];
  if (input._memoria) partes.push(`<memoria_del_cliente>\n${input._memoria}\n</memoria_del_cliente>\nRespetá estas preferencias y lecciones: vienen de entregas anteriores aprobadas o corregidas por el equipo.`);
  if (input._correcciones) partes.push(`<correcciones_del_revisor>\n${input._correcciones}\n</correcciones_del_revisor>\nTu entrega anterior no pasó el control de calidad. Corregí cada punto y mantené lo que estaba bien.`);
  return partes.length ? `\n\n${partes.join("\n\n")}` : "";
}
