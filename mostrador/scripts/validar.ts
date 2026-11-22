/**
 * Revisa la configuración de cada local antes de ponerlo en marcha.
 *   npm run validar                    todos los locales
 *   npm run validar -- comidas-jn      uno solo
 *   npm run validar -- --solo-estructura   sin revisar variables de entorno (para CI)
 *
 * Errores (❌) impiden arrancar bien; advertencias (⚠️) conviene resolverlas antes de vender.
 */
import fs from "node:fs";
import path from "node:path";
import { cargarConfig, env, type Cliente } from "../src/config.ts";
import { normalizar } from "../src/money.ts";

const args = process.argv.slice(2);
const soloEstructura = args.includes("--solo-estructura");
const filtro = args.find((a) => !a.startsWith("--"));

export interface Reporte {
  slug: string;
  errores: string[];
  avisos: string[];
}

/** Variables "env:NOMBRE" usadas en los JSON del local. */
function variablesUsadas(dir: string): string[] {
  const texto = ["negocio.json", "menu.json"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  return [...new Set([...texto.matchAll(/"env:([A-Z0-9_]+)"/g)].map((m) => m[1]))];
}

export function revisar(c: Cliente, dir: string, conEntorno: boolean): Reporte {
  const r: Reporte = { slug: c.slug, errores: [], avisos: [] };
  const { menu, negocio } = c;
  const crudo = ["negocio.json", "menu.json"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");

  if (/COMPLETAR/.test(crudo)) r.avisos.push(`Hay datos sin completar ("COMPLETAR"): ${[...crudo.matchAll(/"([^"]*COMPLETAR[^"]*)"/g)].map((m) => m[1]).join(" · ")}`);
  if (!negocio.horarios.length && !negocio.feriados?.fechas.length) r.errores.push("No hay horarios: el bot va a decir siempre que está cerrado.");
  if (!negocio.ubicacion) r.avisos.push("Falta 'ubicacion' (lat/lng del local): sin eso el bot no calcula la zona cuando el cliente comparte su ubicación.");
  if (negocio.delivery.zonas.some((z) => z.hastaCuadras === undefined)) r.avisos.push("Hay zonas sin 'hastaCuadras': el bot no puede elegirlas por distancia.");
  if (!negocio.delivery.zonas.length) r.avisos.push("No hay zonas de delivery: solo se va a poder pedir take away.");
  if (negocio.pago.titular.trim().split(/\s+/).length < 2) r.avisos.push("El titular de la cuenta debería tener nombre y apellido: se usa para validar comprobantes.");

  const ids = new Set(menu.productos.map((p) => p.id));
  if (!ids.size) r.errores.push("La carta no tiene productos.");
  for (const p of menu.productos) {
    if (p.precio <= 0) r.errores.push(`${p.id}: precio inválido (${p.precio}).`);
    for (const g of p.opciones) {
      const vals = new Set(g.valores.map((v) => v.id));
      if (vals.size !== g.valores.length) r.errores.push(`${p.id}: valores repetidos en "${g.grupo}".`);
      for (const v of g.valores) if (p.precio + v.precio <= 0) r.errores.push(`${p.id}: "${v.nombre}" queda con precio ${p.precio + v.precio}.`);
    }
    for (const [, grupo] of p.comanda.matchAll(/\{([^}]+)\}/g)) {
      if (!p.opciones.some((g) => g.grupo === grupo)) r.errores.push(`${p.id}: el texto de comanda usa {${grupo}} pero el producto no tiene esa opción.`);
    }
  }
  // apodos que apuntan a dos productos distintos: el bot y los comandos se confunden
  const apodos = new Map<string, string[]>();
  for (const p of menu.productos) for (const a of [p.nombre, ...p.apodos]) {
    const k = normalizar(a);
    apodos.set(k, [...new Set([...(apodos.get(k) ?? []), p.id])]);
  }
  for (const [a, ps] of apodos) if (ps.length > 1) r.avisos.push(`El apodo "${a}" corresponde a varios productos (${ps.join(", ")}).`);

  if (conEntorno) {
    for (const v of variablesUsadas(dir)) if (!process.env[v]) r.avisos.push(`Falta la variable de entorno ${v}.`);
    if (!negocio.whatsapp.phoneNumberId || !negocio.whatsapp.token) r.avisos.push("WhatsApp sin configurar: el local solo va a funcionar en la demo web.");
    if (!negocio.panel.token) r.avisos.push("Sin token de panel: el panel de cocina queda deshabilitado.");
    if (!negocio.equipo.encargados.length) r.errores.push("No hay encargados: nadie recibe las derivaciones ni puede dar comandos.");
    if (!negocio.equipo.cocina.length) r.avisos.push("No hay números de cocina: las comandas solo se ven en el panel.");
  }
  return r;
}

function main() {
  const dirs = fs
    .readdirSync(env.clientesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (filtro ? d.name === filtro : true))
    .map((d) => path.join(env.clientesDir, d.name))
    .filter((d) => fs.existsSync(path.join(d, "negocio.json")));
  if (!dirs.length) {
    console.error(filtro ? `No existe el local "${filtro}".` : "No hay locales en clientes/.");
    process.exit(1);
  }
  let errores = 0;
  for (const dir of dirs) {
    let rep: Reporte;
    try {
      const c = cargarConfig(dir);
      rep = revisar(c, dir, !soloEstructura && !path.basename(dir).startsWith("_"));
      console.log(`\n${rep.errores.length ? "❌" : "✅"} ${c.negocio.nombre} (${c.slug}) — ${c.menu.productos.length} productos, ${c.negocio.delivery.zonas.length} zonas`);
    } catch (e) {
      rep = { slug: path.basename(dir), errores: [String((e as Error).message).slice(0, 800)], avisos: [] };
      console.log(`\n❌ ${rep.slug}: la configuración no se puede leer`);
    }
    for (const x of rep.errores) console.log(`   ❌ ${x}`);
    for (const x of rep.avisos) console.log(`   ⚠️  ${x}`);
    errores += rep.errores.length;
  }
  console.log(errores ? `\n${errores} error(es). Corregilos antes de arrancar.` : "\nTodo en orden.");
  process.exit(errores ? 1 : 0);
}

if (process.argv[1]?.endsWith("validar.ts")) main();
