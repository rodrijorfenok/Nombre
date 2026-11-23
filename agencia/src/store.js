// Almacenamiento en SQLite (incluido en Node 22, sin dependencias nativas).
// Cada colección es una tabla de documentos JSON con índices sobre los campos que
// se consultan seguido (estado, cliente, lead). Escribe solo la fila que cambia,
// soporta escrituras concurrentes con WAL y migra solo desde el antiguo db.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

// node:sqlite emite un aviso de "experimental" al cargarse: lo silenciamos solo a él.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emitWarning.call(process, w, ...rest));
const { DatabaseSync } = await import("node:sqlite");
process.emitWarning = emitWarning;

const COLECCIONES = ["leads", "jobs", "chats", "clientes"];
const INDICES = {
  jobs: ["estado", "clienteId", "leadId", "tipo"],
  leads: ["etapa"],
  clientes: ["portalToken"],
};
// Campos pesados que no hacen falta para listar.
const PESADOS = { jobs: ["resultado", "traza", "revisiones", "input"], chats: [] };

let db = null;

function abrir() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  db = new DatabaseSync(config.dbFile);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  for (const col of COLECCIONES) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, creado TEXT NOT NULL, data TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${col}_creado ON ${col}(creado)`);
    for (const campo of INDICES[col] || []) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${col}_${campo} ON ${col}(json_extract(data, '$.${campo}'))`);
    }
  }
  db.exec("CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
  migrarDesdeJson();
  return db;
}

function migrarDesdeJson() {
  const viejo = config.legacyJsonFile;
  if (!viejo || !fs.existsSync(viejo)) return;
  const vacio = COLECCIONES.every((c) => db.prepare(`SELECT COUNT(*) n FROM ${c}`).get().n === 0);
  if (!vacio) return;
  const datos = JSON.parse(fs.readFileSync(viejo, "utf8"));
  db.exec("BEGIN");
  for (const col of COLECCIONES) for (const doc of datos[col] || []) escribir(col, doc);
  for (const [k, v] of Object.entries(datos.meta || {})) db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, JSON.stringify(v));
  db.exec("COMMIT");
  fs.renameSync(viejo, `${viejo}.migrado`);
  console.log(`[store] datos migrados desde ${viejo} a SQLite`);
}

function escribir(col, doc) {
  db.prepare(`INSERT OR REPLACE INTO ${col} (id, creado, data) VALUES (?, ?, ?)`).run(doc.id, doc.creado, JSON.stringify(doc));
}

const parse = (fila) => (fila ? JSON.parse(fila.data) : null);

/** Arma un WHERE a partir de {campo: valor | [valores]}. */
function filtro(where = {}) {
  const partes = [];
  const params = [];
  for (const [campo, valor] of Object.entries(where)) {
    if (!/^[a-zA-Z_]+$/.test(campo)) throw new Error(`Campo inválido: ${campo}`);
    const expr = `json_extract(data, '$.${campo}')`;
    if (Array.isArray(valor)) {
      partes.push(`${expr} IN (${valor.map(() => "?").join(",")})`);
      params.push(...valor);
    } else if (valor === null) {
      partes.push(`${expr} IS NULL`);
    } else {
      partes.push(`${expr} = ?`);
      params.push(valor);
    }
  }
  return { sql: partes.length ? `WHERE ${partes.join(" AND ")}` : "", params };
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
export const now = () => new Date().toISOString();

export const store = {
  /** Lista documentos (más nuevos primero). `liviano` omite los campos pesados. */
  list(col, { where, limit = 100000, offset = 0, liviano = false, desde, orden = "desc" } = {}) {
    abrir();
    const f = filtro(where);
    let sql = f.sql;
    if (desde) { sql += (sql ? " AND" : "WHERE") + " creado >= ?"; f.params.push(desde); }
    const campos = liviano && PESADOS[col]?.length ? `json_remove(data, ${PESADOS[col].map((c) => `'$.${c}'`).join(", ")}) AS data` : "data";
    return db.prepare(`SELECT ${campos} FROM ${col} ${sql} ORDER BY creado ${orden === "asc" ? "ASC" : "DESC"}, rowid ${orden === "asc" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`).all(...f.params, limit, offset).map(parse);
  },
  count(col, where) {
    abrir();
    const f = filtro(where);
    return db.prepare(`SELECT COUNT(*) n FROM ${col} ${f.sql}`).get(...f.params).n;
  },
  get(col, id) {
    abrir();
    return parse(db.prepare(`SELECT data FROM ${col} WHERE id = ?`).get(id));
  },
  /** Busca el primero que cumpla `where` (objeto) o el predicado (función, recorre todo). */
  find(col, where) {
    if (typeof where === "function") return this.list(col).find(where) || null;
    return this.list(col, { where, limit: 1 })[0] || null;
  },
  insert(col, doc) {
    abrir();
    const item = { id: newId(col.slice(0, -1)), creado: now(), ...doc };
    escribir(col, item);
    return item;
  },
  update(col, id, patch) {
    abrir();
    const item = this.get(col, id);
    if (!item) return null;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete item[k]; else item[k] = v;
    item.actualizado = now();
    escribir(col, item);
    return item;
  },
  meta(clave) {
    abrir();
    const fila = db.prepare("SELECT valor FROM meta WHERE clave = ?").get(clave);
    return fila ? JSON.parse(fila.valor) : undefined;
  },
  setMeta(clave, valor) {
    abrir();
    db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(clave, JSON.stringify(valor));
    return valor;
  },
  /** Copia de seguridad consistente sin frenar el servidor. */
  backup(destino) {
    abrir();
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (fs.existsSync(destino)) fs.unlinkSync(destino);
    db.prepare("VACUUM INTO ?").run(destino);
    return destino;
  },
  flush() { return Promise.resolve(); },
  reset() {
    abrir();
    for (const col of [...COLECCIONES, "meta"]) db.exec(`DELETE FROM ${col}`);
  },
};
