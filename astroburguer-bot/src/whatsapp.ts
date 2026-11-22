import crypto from "node:crypto";
import type { Entrante, Mensajero, MediaType } from "./bot.ts";

/**
 * Cliente mínimo de la API oficial de WhatsApp Business (Cloud API de Meta).
 * Variables: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN.
 */
export class WhatsAppCloud implements Mensajero {
  private base: string;

  constructor(
    private token: string,
    readonly phoneNumberId: string,
    version = process.env.GRAPH_API_VERSION ?? "v23.0",
  ) {
    if (!token || !phoneNumberId) throw new Error("Faltan el token o el phoneNumberId de WhatsApp");
    this.base = `https://graph.facebook.com/${version}`;
  }

  async enviarTexto(telefono: string, texto: string) {
    // WhatsApp corta en 4096 caracteres.
    for (let i = 0; i < texto.length; i += 4000) {
      const res = await fetch(`${this.base}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: telefono, type: "text", text: { body: texto.slice(i, i + 4000), preview_url: false } }),
      });
      if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
    }
  }

  /** Marca el mensaje como leído (tildes azules) y muestra "escribiendo…" mientras se arma la respuesta. */
  async marcarLeido(messageId: string, escribiendo = true) {
    await fetch(`${this.base}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        ...(escribiendo ? { typing_indicator: { type: "text" } } : {}),
      }),
    }).catch(() => {});
  }

  async descargarMedia(mediaId: string): Promise<{ datos: Buffer; mime: string }> {
    const meta = await fetch(`${this.base}/${mediaId}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!meta.ok) throw new Error(`media ${mediaId}: ${meta.status}`);
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const bin = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!bin.ok) throw new Error(`descarga media ${mediaId}: ${bin.status}`);
    return { datos: Buffer.from(await bin.arrayBuffer()), mime: mime_type };
  }
}

export function firmaValida(cuerpo: Buffer, firma: string | undefined, appSecret = process.env.WHATSAPP_APP_SECRET ?? ""): boolean {
  if (!appSecret) return true; // sin secreto configurado no se valida (solo para pruebas)
  if (!firma?.startsWith("sha256=")) return false;
  const esperada = "sha256=" + crypto.createHmac("sha256", appSecret).update(cuerpo).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface MensajeWebhook {
  /** número de WhatsApp del local que recibió el mensaje (para saber a qué local va) */
  phoneNumberId: string;
  id: string;
  from: string;
  nombrePerfil?: string;
  tipo: string;
  texto?: string;
  mediaId?: string;
  mime?: string;
  caption?: string;
  ubicacion?: { lat: number; lng: number; nombre?: string; direccion?: string };
}

/** Extrae los mensajes entrantes del payload del webhook (ignora estados de entrega). */
export function parsearWebhook(body: any): MensajeWebhook[] {
  const out: MensajeWebhook[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      const perfiles = new Map<string, string>((v?.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of v?.messages ?? []) {
        const base: MensajeWebhook = { phoneNumberId: String(v?.metadata?.phone_number_id ?? ""), id: m.id, from: m.from, nombrePerfil: perfiles.get(m.from), tipo: m.type };
        switch (m.type) {
          case "text":
            base.texto = m.text?.body;
            break;
          case "image":
            Object.assign(base, { mediaId: m.image.id, mime: m.image.mime_type, caption: m.image.caption });
            break;
          case "document":
            Object.assign(base, { mediaId: m.document.id, mime: m.document.mime_type, caption: m.document.caption });
            break;
          case "location":
            base.ubicacion = { lat: m.location.latitude, lng: m.location.longitude, nombre: m.location.name, direccion: m.location.address };
            break;
          case "interactive":
            base.texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
            base.tipo = "text";
            break;
          case "button":
            base.texto = m.button?.text;
            base.tipo = "text";
            break;
        }
        out.push(base);
      }
    }
  }
  return out;
}

const MIMES_OK: MediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export async function aEntrante(wa: WhatsAppCloud, m: MensajeWebhook): Promise<Entrante> {
  switch (m.tipo) {
    case "text":
      return { tipo: "texto", texto: m.texto ?? "" };
    case "image":
    case "document": {
      const mime = (m.mime ?? "").split(";")[0].trim() as MediaType;
      if (!MIMES_OK.includes(mime)) return { tipo: "otro", descripcion: `un archivo de tipo ${m.mime}` };
      const { datos } = await wa.descargarMedia(m.mediaId!);
      return { tipo: "imagen", datos, mime, caption: m.caption };
    }
    case "location":
      return { tipo: "ubicacion", ...m.ubicacion! };
    case "audio":
      return { tipo: "audio" };
    case "sticker":
      return { tipo: "otro", descripcion: "un sticker" };
    default:
      return { tipo: "otro", descripcion: `un mensaje de tipo ${m.tipo}` };
  }
}
