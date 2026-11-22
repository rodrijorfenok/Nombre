import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ValorOpcion = z.object({ id: z.string(), nombre: z.string(), precio: z.number() });
const GrupoOpcion = z.object({ grupo: z.string(), valores: z.array(ValorOpcion).min(1) });
const Producto = z.object({
  id: z.string(),
  categoria: z.string(),
  nombre: z.string(),
  descripcion: z.string().default(""),
  precio: z.number(),
  ingredientes: z.array(z.string()).default([]),
  opciones: z.array(GrupoOpcion).default([]),
  extras: z.array(z.string()).default([]),
  disponible: z.boolean().default(true),
});
const Categoria = z.object({
  id: z.string(),
  nombre: z.string(),
  emoji: z.string().default(""),
  prepMin: z.number(),
});
const Extra = z.object({ id: z.string(), nombre: z.string(), precio: z.number() });

export const MenuSchema = z.object({
  moneda: z.string().default("ARS"),
  categorias: z.array(Categoria),
  productos: z.array(Producto),
  extras: z.array(Extra),
});

const Horario = z.object({
  dias: z.array(z.number().int().min(0).max(6)),
  abre: z.string().regex(/^\d{2}:\d{2}$/),
  cierra: z.string().regex(/^\d{2}:\d{2}$/),
});

export const NegocioSchema = z.object({
  nombre: z.string(),
  zonaHoraria: z.string(),
  direccionLocal: z.string(),
  horarios: z.array(Horario),
  pago: z.object({
    alias: z.string(),
    cvu: z.string().default(""),
    titular: z.string(),
    banco: z.string().default(""),
    aceptaEfectivo: z.boolean().default(true),
    comandaAntesDelPago: z.boolean().default(false),
    minutosValidezComprobante: z.number().default(180),
  }),
  delivery: z.object({
    pedidoMinimo: z.number().default(0),
    zonas: z.array(
      z.object({
        id: z.string(),
        nombre: z.string(),
        referencia: z.string().default(""),
        costo: z.number(),
        minutos: z.number(),
      }),
    ),
  }),
  cocina: z.object({
    pedidosEnParalelo: z.number().int().min(1),
    minutosPorTanda: z.number(),
    minutosPorUnidadExtra: z.number(),
    unidadesSinRecargo: z.number().int(),
  }),
});

export type Menu = z.infer<typeof MenuSchema>;
export type Producto = z.infer<typeof Producto>;
export type Negocio = z.infer<typeof NegocioSchema>;

export function cargarConfig(dir = process.env.CONFIG_DIR ?? "config"): { menu: Menu; negocio: Negocio } {
  const leer = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const menu = MenuSchema.parse(leer("menu.json"));
  const negocio = NegocioSchema.parse(leer("negocio.json"));
  validarReferencias(menu);
  return { menu, negocio };
}

function validarReferencias(menu: Menu) {
  const cats = new Set(menu.categorias.map((c) => c.id));
  const extras = new Set(menu.extras.map((e) => e.id));
  const ids = new Set<string>();
  for (const p of menu.productos) {
    if (ids.has(p.id)) throw new Error(`Producto duplicado en menu.json: ${p.id}`);
    ids.add(p.id);
    if (!cats.has(p.categoria)) throw new Error(`Categoría inexistente "${p.categoria}" en ${p.id}`);
    for (const e of p.extras) if (!extras.has(e)) throw new Error(`Extra inexistente "${e}" en ${p.id}`);
  }
}

export const env = {
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  effort: (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high" | "xhigh" | "max",
  dbPath: process.env.DB_PATH ?? "data/astroburguer.db",
  dataDir: process.env.DATA_DIR ?? "data",
  staffNumbers: (process.env.STAFF_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  kitchenNumbers: (process.env.KITCHEN_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  panelToken: process.env.PANEL_TOKEN ?? "",
  publicUrl: process.env.PUBLIC_URL ?? "",
};
