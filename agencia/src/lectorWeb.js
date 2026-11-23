// Lector web propio para el Auditor: se usa cuando la lectura web de Anthropic no está
// disponible (por ejemplo, desde un entorno con red restringida o si la organización
// la desactiva). Convierte la página en texto con lo que importa para CRO.
//
// Seguridad:
// - Solo lee páginas del mismo dominio que la tienda auditada (una página no puede
//   hacer que el agente visite otro sitio).
// - Rechaza direcciones privadas o locales (evita que se use para entrar a la red
//   interna), salvo que ESCALA_LECTURA_LOCAL=1 (solo para demos en la propia máquina).
import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 2_000_000;
const MAX_CARACTERES = 40_000;
const TIMEOUT_MS = 15_000;

function esPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function validarDestino(url) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Solo se pueden leer páginas http o https.");
  if (process.env.ESCALA_LECTURA_LOCAL === "1") return u;
  const ips = net.isIP(u.hostname) ? [u.hostname] : (await dns.lookup(u.hostname, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(esPrivada)) throw new Error("La dirección apunta a una red privada o local; no se lee por seguridad.");
  return u;
}

const decodificar = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Convierte HTML en texto legible conservando títulos, enlaces, imágenes, botones y formularios. */
export function htmlATexto(html, base) {
  const meta = (name) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] || "";
  const titulo = decodificar(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  let t = html
    .replace(/<head[\s>][\s\S]*?<\/head>/i, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<img[^>]*>/gi, (tag) => {
      const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1];
      return ` [imagen${alt ? `: ${alt}` : " sin texto alternativo"}] `;
    })
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
      let abs = href;
      try { abs = new URL(href, base).href; } catch {}
      return ` ${txt.replace(/<[^>]+>/g, " ").trim()} [enlace: ${abs}] `;
    })
    .replace(/<button[^>]*>([\s\S]*?)<\/button>/gi, (_, txt) => ` [botón: ${txt.replace(/<[^>]+>/g, " ").trim()}] `)
    .replace(/<input[^>]*>/gi, (tag) => ` [campo: ${tag.match(/(?:placeholder|name|type)=["']([^"']*)["']/i)?.[1] || "sin nombre"}] `)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  t = decodificar(t).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const cabecera = [`URL: ${base}`, titulo && `Título: ${titulo}`, meta("description") && `Descripción: ${meta("description")}`, /name=["']viewport["']/i.test(html) ? "Tiene meta viewport (adaptada a celular)." : "No tiene meta viewport: probablemente no está adaptada a celular."].filter(Boolean).join("\n");
  const cuerpo = t.length > MAX_CARACTERES ? `${t.slice(0, MAX_CARACTERES)}\n[…contenido recortado]` : t;
  return `${cabecera}\n\n${cuerpo}`;
}

/**
 * Lee una página; `dominioPermitido` limita la lectura al sitio auditado. Si la conexión
 * segura (https) falla, reintenta una vez con http: algunas tiendas chicas no tienen certificado.
 */
export async function leerPagina(url, opciones = {}) {
  try {
    return await leerPaginaUnaVez(url, opciones);
  } catch (err) {
    const deRed = /fetch failed|ECONNREFUSED|certificate|SSL|ENOTFOUND/i.test(`${err.message} ${err.cause?.message || ""}`);
    if (url.startsWith("https://") && deRed) return leerPaginaUnaVez(url.replace(/^https:/, "http:"), opciones);
    throw err;
  }
}

async function leerPaginaUnaVez(url, { dominioPermitido } = {}) {
  let u = await validarDestino(url);
  const raiz = (h) => h.replace(/^www\./, "");
  if (dominioPermitido && raiz(u.hostname) !== raiz(dominioPermitido) && !raiz(u.hostname).endsWith(`.${raiz(dominioPermitido)}`)) {
    throw new Error(`Solo se pueden leer páginas de ${dominioPermitido}.`);
  }
  let res;
  for (let saltos = 0; saltos <= 3; saltos++) {
    const inicio = Date.now();
    res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 (compatible; EscalaAuditor/1.0)", accept: "text/html,*/*;q=0.8" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = await validarDestino(new URL(res.headers.get("location"), u).href);
      continue;
    }
    const tipo = res.headers.get("content-type") || "";
    if (!res.ok) throw new Error(`La página respondió ${res.status}.`);
    if (!/html|text/.test(tipo)) throw new Error(`No es una página web (${tipo || "tipo desconocido"}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.subarray(0, MAX_BYTES).toString("utf8");
    return `${htmlATexto(html, u.href)}\n\n(Tiempo de respuesta del servidor: ${Date.now() - inicio} ms, peso del HTML: ${Math.round(buf.length / 1024)} KB)`;
  }
  throw new Error("Demasiadas redirecciones.");
}
