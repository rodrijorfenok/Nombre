// Almacenamiento simple en un archivo JSON. Alcanza para una agencia chica;
// para escalar se reemplaza por Postgres/SQLite sin tocar los agentes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const EMPTY = { leads: [], jobs: [], chats: [], clientes: [] };
let db = null;
let writing = Promise.resolve();

function load() {
  if (db) return db;
  try {
    db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(config.dataFile, "utf8")) };
  } catch {
    db = structuredClone(EMPTY);
  }
  return db;
}

function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writing = writing.then(async () => {
    await fs.promises.mkdir(path.dirname(config.dataFile), { recursive: true });
    const tmp = config.dataFile + ".tmp";
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, config.dataFile);
  }).catch((err) => console.error("[store] no se pudo guardar:", err.message));
  return writing;
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
export const now = () => new Date().toISOString();

export const store = {
  list(col) { return [...load()[col]].sort((a, b) => (b.creado < a.creado ? -1 : 1)); },
  get(col, id) { return load()[col].find((x) => x.id === id) || null; },
  find(col, pred) { return load()[col].find(pred) || null; },
  insert(col, doc) {
    const item = { id: newId(col.slice(0, -1)), creado: now(), ...doc };
    load()[col].push(item);
    persist();
    return item;
  },
  update(col, id, patch) {
    const item = this.get(col, id);
    if (!item) return null;
    Object.assign(item, patch, { actualizado: now() });
    persist();
    return item;
  },
  flush() { return writing; },
  reset() { db = structuredClone(EMPTY); return persist(); },
};
