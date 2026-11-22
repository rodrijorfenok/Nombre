import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { normalizarTelefono } from "./telefonos.ts";

/** Lista de teléfonos: acepta un array o un texto separado por comas (útil con "env:VARIABLE"). */
const Telefonos = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",") : v),
  z.array(z.string()).transform((xs) => xs.map((x) => x.trim()).filter(Boolean).map((x) => normalizarTelefono(x))),
);

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
  /** palabras con que la gente lo pide: "napo", "muzza", "la de bacon" */
  apodos: z.array(z.string()).default([]),
  /** detalle para la cocina (promos y combos): qué hay que preparar. {grupo} se reemplaza por la opción elegida */
  comanda: z.string().default(""),
});
const Categoria = z.object({
  id: z.string(),
  nombre: z.string(),
  emoji: z.string().default(""),
  prepMin: z.number(),
});
const Extra = z.object({ id: z.string(), nombre: z.string(), precio: z.number(), disponible: z.boolean().default(true) });

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
  rubro: z.string().default("hamburguesería y rotisería"),
  zonaHoraria: z.string().default("America/Argentina/Buenos_Aires"),
  direccionLocal: z.string(),
  horarios: z.array(Horario),
  /** feriados en que el local abre (aunque no sea un día habitual), con su horario */
  feriados: z
    .object({
      fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
      abre: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
      cierra: z.string().regex(/^\d{2}:\d{2}$/).default("00:00"),
    })
    .nullable()
    .default(null),
  asistente: z
    .object({
      /** nombre con el que se presenta el asistente; vacío = habla como "el local" */
      nombre: z.string().default(""),
      tono: z.enum(["canchero", "cordial", "formal"]).default("canchero"),
      emojis: z.boolean().default(true),
      /** datos sueltos que el asistente puede contar: "hacemos todo casero", "las papas son caseras" */
      datosExtra: z.array(z.string()).default([]),
      /** producto para sugerir una sola vez si el cliente no pidió bebida ni acompañamiento */
      sugerencia: z.string().default("una bebida o unas papas"),
      /** situaciones en las que NO responde la IA sino una persona del local */
      derivarCuando: z.array(z.string()).default([]),
      /** minutos que el bot queda en pausa con ese cliente después de derivarlo a una persona */
      minutosAtencionHumana: z.number().default(30),
      /** situaciones que ya pasaron en el local y cómo se resolvieron (salen del análisis de chats viejos) */
      casos: z.array(z.object({ situacion: z.string(), respuesta: z.string() })).default([]),
      /** al marcar entregado, pedirle al cliente una nota del 1 al 5 (las bajas le llegan al encargado) */
      pedirCalificacion: z.boolean().default(true),
    })
    .default({
      nombre: "",
      tono: "canchero",
      emojis: true,
      datosExtra: [],
      sugerencia: "una bebida o unas papas",
      derivarCuando: [],
      minutosAtencionHumana: 30,
      casos: [],
      pedirCalificacion: true,
    }),
  /** coordenadas del local (para calcular la zona cuando el cliente comparte su ubicación) */
  ubicacion: z.object({ lat: z.number(), lng: z.number() }).nullable().default(null),
  pago: z.object({
    alias: z.string(),
    cvu: z.string().default(""),
    titular: z.string(),
    banco: z.string().default(""),
    aceptaEfectivo: z.boolean().default(true),
    comandaAntesDelPago: z.boolean().default(false),
    minutosValidezComprobante: z.number().default(180),
    /** minutos sin comprobante después de confirmar para recordarle al cliente que transfiera (0 = no recordar) */
    minutosRecordatorioPago: z.number().default(10),
  }),
  delivery: z.object({
    pedidoMinimo: z.number().default(0),
    /** localidad que se agrega a la dirección en el link de Maps del repartidor, ej "José C. Paz, Buenos Aires" */
    ciudad: z.string().default(""),
    zonas: z.array(
      z.object({
        id: z.string(),
        nombre: z.string(),
        referencia: z.string().default(""),
        /** límite de la zona en cuadras desde el local (1 cuadra ≈ 100 m) */
        hastaCuadras: z.number().optional(),
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
    /** minutos desde que el pedido entró a cocina en los que el cliente todavía puede sumarle productos */
    minutosParaAgregar: z.number().default(10),
  }),
  equipo: z
    .object({
      /** reciben avisos y pueden mandar comandos (pago ok, precio, agotado…) */
      encargados: Telefonos.default([]),
      /** reciben las comandas */
      cocina: Telefonos.default([]),
    })
    .default({ encargados: [], cocina: [] }),
  whatsapp: z
    .object({
      phoneNumberId: z.string().default(""),
      token: z.string().default(""),
    })
    .default({ phoneNumberId: "", token: "" }),
  panel: z.object({ token: z.string().default("") }).default({ token: "" }),
  integraciones: z
    .object({
      /** URL que recibe un POST con el pedido cada vez que cambia de estado (webhook de n8n, Make, etc.) */
      webhookPedidos: z.string().default(""),
    })
    .default({ webhookPedidos: "" }),
});

export type Menu = z.infer<typeof MenuSchema>;
export type Producto = z.infer<typeof Producto>;
export type Negocio = z.infer<typeof NegocioSchema>;

export interface Cliente {
  /** nombre de la carpeta en clientes/ */
  slug: string;
  menu: Menu;
  negocio: Negocio;
}

/** Reemplaza "env:NOMBRE" por process.env.NOMBRE para no guardar secretos en el JSON. */
function resolverEnv(v: unknown): unknown {
  if (typeof v === "string" && v.startsWith("env:")) return process.env[v.slice(4)] ?? "";
  if (Array.isArray(v)) return v.map(resolverEnv);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolverEnv(x)]));
  return v;
}

export function cargarConfig(dir: string): Cliente {
  const leer = (f: string) => resolverEnv(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const menu = MenuSchema.parse(leer("menu.json"));
  const negocio = NegocioSchema.parse(leer("negocio.json"));
  validarReferencias(menu);
  return { slug: path.basename(path.resolve(dir)), menu, negocio };
}

/** Carga todos los locales de clientes/ (una carpeta por local). */
export function cargarClientes(dir = env.clientesDir): Cliente[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && fs.existsSync(path.join(dir, d.name, "negocio.json")))
    .map((d) => cargarConfig(path.join(dir, d.name)));
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
  model: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",
  effort: (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  clientesDir: process.env.CLIENTES_DIR ?? "clientes",
  dataDir: process.env.DATA_DIR ?? "data",
  publicUrl: process.env.PUBLIC_URL ?? "",
  /** milisegundos que se espera para juntar mensajes seguidos del mismo cliente */
  esperaRafagaMs: Number(process.env.ESPERA_RAFAGA_MS ?? 1500),
  /** consultas a la IA en paralelo como máximo (entre todos los locales); el resto hace fila */
  iaEnParalelo: Number(process.env.IA_EN_PARALELO ?? 40),
};

/** Los fallbacks del servidor solo existen para algunos modelos (Haiku no los tiene). */
export function soportaFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}
