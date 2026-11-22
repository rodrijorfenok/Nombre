import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type Anthropic from "@anthropic-ai/sdk";
import { ESTADOS_ACTIVOS, pedidoNuevo, type EstadoPedido, type Pedido } from "./order.ts";

export type Mensaje = Anthropic.Beta.BetaMessageParam;

export interface Conversacion {
  telefono: string;
  /** system prompt con el que empezó esta conversación: se mantiene fijo toda su vida */
  system?: string;
  mensajes: Mensaje[];
  pedidoId: number | null;
  actualizadoEn: string;
}

export interface Comprobante {
  id: number;
  pedidoId: number;
  telefono: string;
  archivo: string | null;
  numeroOperacion: string | null;
  monto: number | null;
  veredicto: "aprobado" | "revisar" | "rechazado";
  motivos: string[];
  datos: unknown;
  creadoEn: string;
}

export class Store {
  private db: DatabaseSync;
  /** se llama cada vez que un pedido cambia de estado (para integraciones: n8n, Make, planillas…) */
  alCambiarEstado?: (p: Pedido, anterior: EstadoPedido | null) => void;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telefono TEXT NOT NULL,
        estado TEXT NOT NULL,
        datos TEXT NOT NULL,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pedidos_estado ON pedidos(estado);
      CREATE TABLE IF NOT EXISTS conversaciones (
        telefono TEXT PRIMARY KEY,
        mensajes TEXT NOT NULL,
        system TEXT,
        pedido_id INTEGER,
        actualizado_en TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comprobantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL,
        telefono TEXT NOT NULL,
        archivo TEXT,
        numero_operacion TEXT,
        monto REAL,
        veredicto TEXT NOT NULL,
        motivos TEXT NOT NULL,
        datos TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comprobantes_op ON comprobantes(numero_operacion);
      CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mensajes_procesados (id TEXT PRIMARY KEY, creado_en TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entrantes (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        estado TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entrantes_estado ON entrantes(estado);
    `);
  }

  // ---------- pedidos ----------
  crearPedido(telefono: string, ahora = new Date()): Pedido {
    const p = pedidoNuevo(telefono, ahora);
    const now = ahora.toISOString();
    const r = this.db
      .prepare("INSERT INTO pedidos (telefono, estado, datos, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?)")
      .run(telefono, p.estado, "{}", now, now);
    p.id = Number(r.lastInsertRowid);
    this.guardarPedido(p);
    return p;
  }

  guardarPedido(p: Pedido) {
    if (!p.id) throw new Error("Pedido sin id");
    const previo = this.db.prepare("SELECT estado FROM pedidos WHERE id = ?").get(p.id) as { estado: EstadoPedido } | undefined;
    this.db
      .prepare("UPDATE pedidos SET estado = ?, datos = ?, actualizado_en = ? WHERE id = ?")
      .run(p.estado, JSON.stringify(p), new Date().toISOString(), p.id);
    if (this.alCambiarEstado && previo?.estado !== p.estado) {
      try {
        this.alCambiarEstado(p, previo?.estado ?? null);
      } catch (e) {
        console.error("[integracion]", e);
      }
    }
  }

  pedido(id: number): Pedido | null {
    const r = this.db.prepare("SELECT datos FROM pedidos WHERE id = ?").get(id) as { datos: string } | undefined;
    return r ? (JSON.parse(r.datos) as Pedido) : null;
  }

  pedidosPorEstado(estados: EstadoPedido[]): Pedido[] {
    const q = `SELECT datos FROM pedidos WHERE estado IN (${estados.map(() => "?").join(",")}) ORDER BY id`;
    return (this.db.prepare(q).all(...estados) as { datos: string }[]).map((r) => JSON.parse(r.datos) as Pedido);
  }

  pedidosActivos(): Pedido[] {
    return this.pedidosPorEstado(ESTADOS_ACTIVOS);
  }

  /** Pedidos que ocupan la cocina (para la cola del tiempo de espera). */
  cargaCocina(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE estado IN ('en_cocina','pago_en_revision','esperando_pago')").get() as { n: number };
    return Number(r.n);
  }

  // ---------- conversaciones ----------
  conversacion(telefono: string): Conversacion | null {
    const r = this.db.prepare("SELECT * FROM conversaciones WHERE telefono = ?").get(telefono) as
      | { telefono: string; mensajes: string; system: string | null; pedido_id: number | null; actualizado_en: string }
      | undefined;
    if (!r) return null;
    return { telefono: r.telefono, system: r.system ?? undefined, mensajes: JSON.parse(r.mensajes), pedidoId: r.pedido_id, actualizadoEn: r.actualizado_en };
  }

  guardarConversacion(c: Conversacion) {
    this.db
      .prepare(
        `INSERT INTO conversaciones (telefono, mensajes, system, pedido_id, actualizado_en) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(telefono) DO UPDATE SET mensajes = excluded.mensajes, system = excluded.system, pedido_id = excluded.pedido_id, actualizado_en = excluded.actualizado_en`,
      )
      .run(c.telefono, JSON.stringify(c.mensajes), c.system ?? null, c.pedidoId, c.actualizadoEn);
  }

  // ---------- comprobantes ----------
  operacionYaUsada(numero: string, excluirPedido?: number): Comprobante | null {
    const r = this.db
      .prepare("SELECT * FROM comprobantes WHERE numero_operacion = ? AND veredicto != 'rechazado' AND pedido_id != ? LIMIT 1")
      .get(numero, excluirPedido ?? -1) as Record<string, unknown> | undefined;
    return r ? this.filaComprobante(r) : null;
  }

  guardarComprobante(c: Omit<Comprobante, "id" | "creadoEn">): Comprobante {
    const now = new Date().toISOString();
    const r = this.db
      .prepare(
        "INSERT INTO comprobantes (pedido_id, telefono, archivo, numero_operacion, monto, veredicto, motivos, datos, creado_en) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(c.pedidoId, c.telefono, c.archivo, c.numeroOperacion, c.monto, c.veredicto, JSON.stringify(c.motivos), JSON.stringify(c.datos), now);
    return { ...c, id: Number(r.lastInsertRowid), creadoEn: now };
  }

  comprobantesDePedido(pedidoId: number): Comprobante[] {
    return (this.db.prepare("SELECT * FROM comprobantes WHERE pedido_id = ? ORDER BY id").all(pedidoId) as Record<string, unknown>[]).map((r) =>
      this.filaComprobante(r),
    );
  }

  comprobante(id: number): Comprobante | null {
    const r = this.db.prepare("SELECT * FROM comprobantes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? this.filaComprobante(r) : null;
  }

  actualizarVeredicto(id: number, veredicto: Comprobante["veredicto"]) {
    this.db.prepare("UPDATE comprobantes SET veredicto = ? WHERE id = ?").run(veredicto, id);
  }

  private filaComprobante(r: Record<string, unknown>): Comprobante {
    return {
      id: Number(r.id),
      pedidoId: Number(r.pedido_id),
      telefono: String(r.telefono),
      archivo: (r.archivo as string) ?? null,
      numeroOperacion: (r.numero_operacion as string) ?? null,
      monto: r.monto === null ? null : Number(r.monto),
      veredicto: r.veredicto as Comprobante["veredicto"],
      motivos: JSON.parse(String(r.motivos)),
      datos: JSON.parse(String(r.datos)),
      creadoEn: String(r.creado_en),
    };
  }

  // ---------- ajustes (demora, abierto/cerrado manual) ----------
  ajuste(clave: string): string | null {
    const r = this.db.prepare("SELECT valor FROM ajustes WHERE clave = ?").get(clave) as { valor: string } | undefined;
    return r?.valor ?? null;
  }

  setAjuste(clave: string, valor: string | null) {
    if (valor === null) this.db.prepare("DELETE FROM ajustes WHERE clave = ?").run(clave);
    else this.db.prepare("INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").run(clave, valor);
  }

  ajustesConPrefijo(prefijo: string): Record<string, string> {
    const rows = this.db.prepare("SELECT clave, valor FROM ajustes WHERE clave LIKE ? || '%'").all(prefijo) as { clave: string; valor: string }[];
    return Object.fromEntries(rows.map((r) => [r.clave.slice(prefijo.length), r.valor]));
  }

  /** Idempotencia de webhooks: WhatsApp reintenta entregas. Devuelve false si ya se procesó. */
  // ---------- bandeja de entrada durable ----------
  /** Guarda el mensaje del webhook antes de procesarlo. false = ya lo teníamos (reintento de Meta). */
  guardarEntrante(id: string, payload: unknown): boolean {
    try {
      this.db.prepare("INSERT INTO entrantes (id, payload, estado, creado_en) VALUES (?, ?, 'pendiente', ?)").run(id, JSON.stringify(payload), new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }

  marcarEntrante(id: string, estado: "hecho" | "error") {
    this.db.prepare("UPDATE entrantes SET estado = ? WHERE id = ?").run(estado, id);
  }

  /** Mensajes que quedaron sin procesar (por ejemplo, si el servidor se reinició a mitad de camino). */
  entrantesPendientes(maxMinutos: number): { id: string; payload: unknown }[] {
    const desde = new Date(Date.now() - maxMinutos * 60_000).toISOString();
    return (this.db.prepare("SELECT id, payload FROM entrantes WHERE estado = 'pendiente' AND creado_en >= ? ORDER BY creado_en").all(desde) as {
      id: string;
      payload: string;
    }[]).map((r) => ({ id: r.id, payload: JSON.parse(r.payload) }));
  }

  /** Borra mensajes ya procesados con más de N días (la tabla no crece sin límite). */
  limpiarEntrantes(dias = 7) {
    this.db.prepare("DELETE FROM entrantes WHERE estado != 'pendiente' AND creado_en < ?").run(new Date(Date.now() - dias * 86_400_000).toISOString());
  }

  /**
   * Mantenimiento: borra historiales de chat viejos (lo pesado, con imágenes) y archivos de comprobantes.
   * Los pedidos se conservan siempre (sirven para reportes y "lo de siempre").
   */
  limpiarViejo(diasChats = 14, diasComprobantes = 90): { chats: number; archivos: number } {
    const corteChats = new Date(Date.now() - diasChats * 86_400_000).toISOString();
    const chats = Number(this.db.prepare("DELETE FROM conversaciones WHERE actualizado_en < ?").run(corteChats).changes);
    const corteComp = new Date(Date.now() - diasComprobantes * 86_400_000).toISOString();
    const viejos = this.db.prepare("SELECT id, archivo FROM comprobantes WHERE creado_en < ? AND archivo IS NOT NULL").all(corteComp) as { id: number; archivo: string }[];
    for (const c of viejos) {
      try {
        fs.rmSync(c.archivo, { force: true });
      } catch {}
      this.db.prepare("UPDATE comprobantes SET archivo = NULL WHERE id = ?").run(c.id);
    }
    this.db.prepare("DELETE FROM mensajes_procesados WHERE creado_en < ?").run(corteChats);
    this.limpiarEntrantes();
    return { chats, archivos: viejos.length };
  }

  marcarProcesado(idMensaje: string): boolean {
    try {
      this.db.prepare("INSERT INTO mensajes_procesados (id, creado_en) VALUES (?, ?)").run(idMensaje, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }
}
