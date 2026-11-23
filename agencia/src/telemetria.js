// Telemetría y control de costos. Cada llamada a Claude queda registrada como un
// "paso" del trabajo en curso (tokens, costo, duración, modelo que respondió), y
// el gasto del día se acumula para poder frenar si se supera el presupuesto.
import { AsyncLocalStorage } from "node:async_hooks";
import { store } from "./store.js";

const contexto = new AsyncLocalStorage();

// USD por millón de tokens (Claude Opus 5.5). Actualizar si cambia el modelo.
const PRECIOS = {
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLectura: 0.2, cacheEscritura: 5 },
};
const PRECIO_BUSQUEDA_WEB = 10 / 1000; // USD por búsqueda

export function costoDe(usage, modelo) {
  if (!usage) return 0;
  const p = PRECIOS[modelo] || PRECIOS["claude-opus-5-5"];
  const m = 1e6;
  return (
    ((usage.input_tokens || 0) * p.entrada) / m +
    ((usage.output_tokens || 0) * p.salida) / m +
    ((usage.cache_read_input_tokens || 0) * p.cacheLectura) / m +
    ((usage.cache_creation_input_tokens || 0) * p.cacheEscritura) / m +
    (usage.server_tool_use?.web_search_requests || 0) * PRECIO_BUSQUEDA_WEB
  );
}

/** Ejecuta `fn` acumulando los pasos en `traza` (un objeto que el llamador guarda). */
export function conTraza(traza, fn) {
  return contexto.run(traza, fn);
}

export function registrarPaso({ agente, tipo, modelo, usage, ms, ok, error }) {
  const costo = costoDe(usage, modelo);
  const paso = {
    agente, tipo, modelo, ms, ok,
    error: error || undefined,
    tokens_entrada: usage?.input_tokens ?? 0,
    tokens_salida: usage?.output_tokens ?? 0,
    tokens_cache: usage?.cache_read_input_tokens ?? 0,
    costo_usd: Number(costo.toFixed(5)),
  };
  const traza = contexto.getStore();
  if (traza) {
    traza.pasos = traza.pasos || [];
    traza.pasos.push(paso);
    traza.costo_usd = Number(((traza.costo_usd || 0) + costo).toFixed(5));
  }
  if (costo > 0) sumarGasto(costo);
  return paso;
}

const hoy = () => new Date().toISOString().slice(0, 10);

function sumarGasto(usd) {
  const g = store.meta("gastos") || {};
  g[hoy()] = Number(((g[hoy()] || 0) + usd).toFixed(5));
  store.setMeta("gastos", g);
}

export function gastoDeHoy() {
  return (store.meta("gastos") || {})[hoy()] || 0;
}

export function presupuestoAgotado() {
  const limite = Number(process.env.PRESUPUESTO_DIARIO_USD || 0);
  return limite > 0 && gastoDeHoy() >= limite;
}
