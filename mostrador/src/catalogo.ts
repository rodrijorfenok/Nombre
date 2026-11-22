import type { Menu } from "./config.ts";
import type { Store } from "./db.ts";
import { normalizar } from "./money.ts";

/**
 * Menú vigente = menu.json + cambios que el local hizo por WhatsApp (precios y faltantes).
 * Los cambios viven en la base, así que el dueño no toca archivos para el día a día.
 */
export function menuVigente(base: Menu, store: Store): Menu {
  const precios = store.ajustesConPrefijo("precio:");
  const agotados = new Set(Object.keys(store.ajustesConPrefijo("agotado:")));
  return {
    ...base,
    productos: base.productos.map((p) => ({
      ...p,
      precio: precios[p.id] !== undefined ? Number(precios[p.id]) : p.precio,
      disponible: p.disponible && !agotados.has(p.id),
    })),
    extras: base.extras.map((e) => ({
      ...e,
      precio: precios[e.id] !== undefined ? Number(precios[e.id]) : e.precio,
      disponible: e.disponible && !agotados.has(e.id),
    })),
  };
}

export type ItemEncontrado = { tipo: "producto" | "extra"; id: string; nombre: string; precio: number };

/** Busca un producto o extra por id, nombre o apodo (para los comandos del local). */
export function buscarItem(menu: Menu, texto: string): ItemEncontrado[] {
  const q = normalizar(texto);
  if (!q) return [];
  const todos: (ItemEncontrado & { claves: string[] })[] = [
    ...menu.productos.map((p) => ({ tipo: "producto" as const, id: p.id, nombre: p.nombre, precio: p.precio, claves: [p.id, p.nombre, ...p.apodos] })),
    ...menu.extras.map((e) => ({ tipo: "extra" as const, id: e.id, nombre: e.nombre, precio: e.precio, claves: [e.id, e.nombre] })),
  ];
  const exactos = todos.filter((i) => i.claves.some((c) => normalizar(c) === q));
  if (exactos.length) return exactos.map(({ claves: _c, ...i }) => i);
  const palabras = q.split(" ");
  return todos
    .filter((i) => i.claves.some((c) => palabras.every((w) => normalizar(c).includes(w))))
    .map(({ claves: _c, ...i }) => i);
}
