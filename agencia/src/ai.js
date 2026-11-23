// Capa única de acceso a Claude. Todos los agentes pasan por acá, así el modelo,
// los fallbacks por rechazo y el manejo de errores viven en un solo lugar.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "./config.js";
import * as mock from "./mock.js";

// Si un clasificador de seguridad rechaza un pedido, la API lo reintenta sola
// con el modelo de respaldo recomendado (fallbacks: "default").
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

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
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function checkStop(message) {
  if (message.stop_reason === "refusal") {
    throw new AgentError("El modelo no pudo completar este pedido por sus políticas de seguridad.", { code: "refusal" });
  }
  if (message.stop_reason === "max_tokens") {
    throw new AgentError("La respuesta quedó cortada por longitud. Probá con un pedido más acotado.", { code: "max_tokens", retryable: true });
  }
}

function translateError(err) {
  if (err instanceof AgentError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AgentError("Falta configurar una API key válida de Anthropic (ANTHROPIC_API_KEY).", { code: "auth" });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AgentError("Límite de uso de la API alcanzado. Reintentá en unos minutos.", { code: "rate_limit", retryable: true });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AgentError(`Pedido inválido a la API: ${err.message}`, { code: "bad_request" });
  }
  if (err instanceof Anthropic.APIError) {
    return new AgentError(`Error de la API (${err.status ?? "red"}): ${err.message}`, { code: "api", retryable: true });
  }
  return new AgentError(err?.message || String(err));
}

/**
 * Respuesta en texto libre (markdown). Admite herramientas del servidor de
 * Anthropic (búsqueda y lectura web), que corren sin código de nuestro lado.
 */
export async function runText({ agent, system, prompt, effort = "medium", serverTools = [], maxTokens = 16000 }) {
  if (config.mock) return mock.runText({ agent, prompt });
  try {
    const runner = getClient().beta.messages.toolRunner({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort },
      system,
      tools: serverTools,
      messages: [{ role: "user", content: prompt }],
      max_iterations: 8,
      ...FALLBACK,
    });
    const message = await runner.runUntilDone();
    checkStop(message);
    if (message.stop_reason === "pause_turn") {
      throw new AgentError("La investigación web tardó demasiado. Reintentá el trabajo.", { code: "pause_turn", retryable: true });
    }
    return { text: textOf(message), usage: message.usage };
  } catch (err) {
    throw translateError(err);
  }
}

/** Respuesta estructurada, validada contra un esquema Zod. */
export async function runStructured({ agent, system, prompt, schema, effort = "medium", maxTokens = 16000 }) {
  if (config.mock) return mock.runStructured({ agent, prompt, schema });
  try {
    const message = await getClient().beta.messages.parse({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: prompt }],
      ...FALLBACK,
    });
    checkStop(message);
    if (!message.parsed_output) throw new AgentError("La respuesta no tuvo el formato esperado.", { code: "parse", retryable: true });
    return { data: message.parsed_output, usage: message.usage };
  } catch (err) {
    throw translateError(err);
  }
}

/**
 * Conversación con herramientas propias (por ejemplo, registrar un lead).
 * `history` es la lista de turnos previos en texto; `tools` son betaZodTool.
 */
export async function runChat({ agent, system, history, tools, effort = "low", maxTokens = 4000 }) {
  if (config.mock) return mock.runChat({ agent, history, tools });
  try {
    const runner = getClient().beta.messages.toolRunner({
      model: config.model,
      max_tokens: maxTokens,
      output_config: { effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages: history.map((t) => ({ role: t.role, content: t.text })),
      max_iterations: 5,
      ...FALLBACK,
    });
    const message = await runner.runUntilDone();
    checkStop(message);
    return { text: textOf(message), usage: message.usage };
  } catch (err) {
    throw translateError(err);
  }
}

export const WEB_TOOLS = {
  fetch: (maxUses = 6) => ({ type: "web_fetch_20260209", name: "web_fetch", max_uses: maxUses }),
  search: (maxUses = 4) => ({ type: "web_search_20260209", name: "web_search", max_uses: maxUses }),
};
