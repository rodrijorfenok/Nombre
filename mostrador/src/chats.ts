/**
 * Chats exportados de WhatsApp ("Exportar chat" → "Sin archivos"): los pasa a texto limpio y anónimo
 * para buscar patrones (qué pregunta la gente, qué problemas aparecen y cómo los resolvió el local).
 */

export interface MensajeChat {
  quien: string;
  texto: string;
}

// Android: "22/11/26, 21:03 - Juan: hola"  ·  iPhone: "[22/11/26, 21:03:15] Juan: hola" (con o sin a. m./p. m.)
const FECHA = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?`;
const ANDROID = new RegExp(String.raw`^${FECHA}\s+-\s+([^:]+?):\s(.*)$`, "i");
const IPHONE = new RegExp(String.raw`^\[${FECHA}\]\s+([^:]+?):\s(.*)$`, "i");
const SISTEMA = new RegExp(String.raw`^\[?${FECHA}\]?\s*-?\s`, "i");
const ARCHIVO = /<(multimedia omitido|media omitted|adjunto:[^>]*|attached:[^>]*)>|^(imagen|video|audio|sticker|documento) omitid[oa]$|\(archivo adjunto\)/i;

/** Lee el .txt de un chat exportado. Las líneas sin remitente (avisos de WhatsApp) se descartan. */
export function parsearChat(texto: string): MensajeChat[] {
  const out: MensajeChat[] = [];
  for (const cruda of texto.replace(/\r/g, "").split("\n")) {
    const linea = cruda.replace(/[‎‏‪-‮﻿]/g, "").trimEnd();
    const m = linea.match(IPHONE) ?? linea.match(ANDROID);
    if (m) {
      out.push({ quien: m[1].trim(), texto: limpiar(m[2]) });
      continue;
    }
    if (SISTEMA.test(linea)) continue; // "Los mensajes están cifrados…", "Juan cambió su número…"
    if (out.length && linea.trim()) out.at(-1)!.texto += `\n${limpiar(linea)}`;
  }
  return out.filter((x) => x.texto.trim());
}

function limpiar(t: string): string {
  if (ARCHIVO.test(t.trim())) return "[mandó un archivo o imagen]";
  return t
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[número]") // teléfonos, CBU, tarjetas
    .replace(/\S+@\S+\.\S+/g, "[mail]")
    .trim();
}

/** El local es quien aparece en más chats (o el nombre que se indique). */
export function detectarLocal(chats: MensajeChat[][], nombre?: string): string | null {
  if (nombre) return nombre;
  const veces = new Map<string, number>();
  for (const c of chats) for (const q of new Set(c.map((m) => m.quien))) veces.set(q, (veces.get(q) ?? 0) + 1);
  const [primero] = [...veces].sort((a, b) => b[1] - a[1]);
  return primero && (chats.length === 1 || primero[1] > 1) ? primero[0] : null;
}

/** Texto anónimo: "Local:" y "Cliente:", mensajes seguidos de la misma persona juntos. */
export function chatComoTexto(mensajes: MensajeChat[], local: string): string {
  const out: string[] = [];
  let anterior = "";
  for (const m of mensajes) {
    const quien = m.quien === local ? "Local" : "Cliente";
    if (quien === anterior) out[out.length - 1] += ` / ${m.texto.replace(/\n/g, " ")}`;
    else out.push(`${quien}: ${m.texto.replace(/\n/g, " ")}`);
    anterior = quien;
  }
  return out.join("\n");
}

/** Junta los chats en bloques de hasta `max` caracteres para analizarlos por partes. */
export function enBloques(chats: string[], max = 60_000): string[] {
  const bloques: string[] = [];
  let actual = "";
  chats.forEach((c, i) => {
    const pieza = `### Chat ${i + 1}\n${c.slice(0, max)}\n\n`;
    if (actual && actual.length + pieza.length > max) {
      bloques.push(actual);
      actual = "";
    }
    actual += pieza;
  });
  if (actual) bloques.push(actual);
  return bloques;
}
