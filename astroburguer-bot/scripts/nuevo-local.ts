/**
 * Crea un local nuevo a partir de la plantilla:
 *   npm run nuevo-local -- la-esquina "La Esquina Rotisería"
 * Después editá clientes/<slug>/negocio.json y menu.json.
 */
import fs from "node:fs";
import path from "node:path";

const [slug, nombre] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Uso: npm run nuevo-local -- <slug-en-minusculas> "Nombre del local"');
  process.exit(1);
}
const destino = path.join("clientes", slug);
if (fs.existsSync(destino)) {
  console.error(`Ya existe ${destino}`);
  process.exit(1);
}
fs.mkdirSync(destino, { recursive: true });
const PREFIJO = slug.toUpperCase().replace(/-/g, "_");
const negocio = fs.readFileSync("clientes/_plantilla/negocio.json", "utf8").replaceAll("SLUG_", `${PREFIJO}_`).replace("NOMBRE DEL LOCAL", nombre ?? slug);
fs.writeFileSync(path.join(destino, "negocio.json"), negocio);
fs.copyFileSync("clientes/_plantilla/menu.json", path.join(destino, "menu.json"));
console.log(`✅ Creado ${destino}
Próximos pasos:
  1. Editá ${destino}/negocio.json (dirección, horarios, alias, titular, zonas, números del equipo).
  2. Editá ${destino}/menu.json (productos, precios, combos, apodos).
  3. Agregá al .env: ${PREFIJO}_WA_PHONE_ID, ${PREFIJO}_WA_TOKEN, ${PREFIJO}_PANEL_TOKEN,
     ${PREFIJO}_ENCARGADOS y ${PREFIJO}_COCINA (números separados por coma, ej: 11 3639 7582).
  4. Probalo: npm run chat -- ${slug}`);
