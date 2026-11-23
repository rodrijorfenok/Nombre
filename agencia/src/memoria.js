// Memoria de largo plazo por cliente: brief (quién es, qué vende, tono, objetivos)
// y lecciones aprendidas del feedback del equipo. Se inyecta en cada pedido a los
// agentes para que las entregas sean consistentes mes a mes y no repitan errores.
import { store } from "./store.js";

const MAX_LECCIONES = 40;
const LECCIONES_EN_CONTEXTO = 15;

export const CAMPOS_CLIENTE = ["marca", "rubro", "url", "redes", "publico", "tono", "productos", "objetivo", "plan", "contacto"];

export function crearCliente(datos) {
  const limpio = Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, typeof datos[k] === "string" ? datos[k].trim().slice(0, 1000) : ""]));
  if (!limpio.marca) throw new Error("El cliente necesita al menos la marca.");
  return store.insert("clientes", {
    ...limpio,
    activo: true,
    leadId: datos.leadId || null,
    automatizaciones: { contenido: true, creativos: Boolean(limpio.productos), reauditoria: Boolean(limpio.url), ...(datos.automatizaciones || {}) },
    lecciones: [],
  });
}

export function agregarLeccion(clienteId, texto, origen) {
  const cliente = store.get("clientes", clienteId);
  if (!cliente || !texto?.trim()) return null;
  const lecciones = [...(cliente.lecciones || []), { texto: texto.trim().slice(0, 600), origen, fecha: new Date().toISOString() }].slice(-MAX_LECCIONES);
  return store.update("clientes", clienteId, { lecciones });
}

/** Texto compacto con lo que todo agente debería saber del cliente. */
export function contextoCliente(clienteId) {
  const c = clienteId && store.get("clientes", clienteId);
  if (!c) return "";
  const brief = CAMPOS_CLIENTE.filter((k) => c[k]).map((k) => `- ${k}: ${c[k]}`).join("\n");
  const lecciones = (c.lecciones || []).slice(-LECCIONES_EN_CONTEXTO).map((l) => `- ${l.texto}`).join("\n");
  return `Brief del cliente:\n${brief}${lecciones ? `\n\nLecciones de entregas anteriores (más recientes al final):\n${lecciones}` : ""}`;
}

/** Completa los datos de un pedido con el brief del cliente cuando faltan. */
export function completarConCliente(tipo, input, clienteId) {
  const c = clienteId && store.get("clientes", clienteId);
  if (!c) return input;
  const base = {
    auditoria: { url: c.url, redes: c.redes, contexto: c.objetivo },
    contenido: { marca: c.marca, rubro: c.rubro, publico: c.publico, tono: c.tono, productos: c.productos, objetivo: c.objetivo },
    creativos: { producto: c.productos, publico: c.publico },
    reporte: { cliente: c.marca, objetivos: c.objetivo },
    diagnostico: { marca: c.marca, url: c.url, rubro: c.rubro || "a definir", publico: c.publico, objetivo: c.objetivo, redes: c.redes, productos: c.productos },
  }[tipo] || {};
  const completo = { ...input };
  for (const [k, v] of Object.entries(base)) if (v && !completo[k]) completo[k] = v;
  return completo;
}
