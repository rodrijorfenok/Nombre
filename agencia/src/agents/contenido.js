// Agente de Contenido: arma la estrategia y el calendario mensual de redes con
// guiones de reels, carruseles e historias listos para producir.
import { z } from "zod";
import { runStructured } from "../ai.js";
import { AGENCIA, ESTILO } from "./conocimiento.js";

export const CalendarioSchema = z.object({
  estrategia: z.string().describe("Enfoque del mes en un párrafo"),
  pilares: z.array(z.object({ nombre: z.string(), objetivo: z.string() })),
  piezas: z.array(z.object({
    dia: z.number().int().describe("Día del mes"),
    red: z.enum(["Instagram", "TikTok", "Instagram + TikTok", "Facebook"]),
    formato: z.enum(["Reel", "Carrusel", "Historia", "Post estático", "Live"]),
    pilar: z.string(),
    gancho: z.string().describe("Primera frase o primeros 3 segundos"),
    guion: z.string().describe("Guion escena por escena o texto de cada slide"),
    copy: z.string().describe("Texto de la publicación"),
    cta: z.string(),
    hashtags: z.array(z.string()),
  })),
  metricas_a_seguir: z.array(z.string()),
});

const SYSTEM = `${AGENCIA}

Tu rol: Estratega de contenido para redes sociales de marcas que venden online.
${ESTILO}

Criterios:
- Cada pieza tiene un objetivo dentro del embudo (alcance, comunidad o venta) y un pilar.
- Mezcla aproximada: 40% alcance (tendencias, educativo, entretenimiento), 35% comunidad y confianza
  (detrás de escena, reseñas, UGC), 25% venta directa (producto, oferta, prueba social).
- Los ganchos tienen que funcionar en los primeros 3 segundos y sin sonido.
- Los guiones de reels van escena por escena, con texto en pantalla y duración aproximada.
- Los carruseles indican el texto de cada slide.
- Priorizá guardados y compartidos por sobre likes.`;

export async function calendario({ marca, rubro, publico, tono = "", productos = "", objetivo = "", mes = "", reels = 8, carruseles = 8, historias = 4 }) {
  if (!marca || !rubro) throw new Error("Faltan la marca y el rubro.");
  const prompt = `Armá el calendario de contenido del mes${mes ? ` (${mes})` : ""} para:
Marca: ${marca}
Rubro: ${rubro}
Público: ${publico || "a definir por vos según el rubro"}
Tono de marca: ${tono || "cercano y profesional"}
Productos o servicios destacados: ${productos || "no especificados"}
Objetivo del mes: ${objetivo || "crecer en alcance y llevar tráfico a la tienda"}

Cantidad de piezas: ${reels} reels, ${carruseles} carruseles y ${historias} secuencias de historias destacadas.`;

  const { data } = await runStructured({ agent: "contenido", system: SYSTEM, prompt, schema: CalendarioSchema, effort: "medium", maxTokens: 32000 });
  data.piezas.sort((a, b) => a.dia - b.dia);
  return { data, markdown: aMarkdown(marca, data) };
}

function aMarkdown(marca, d) {
  const piezas = d.piezas.map((p) =>
    `### Día ${p.dia} · ${p.formato} · ${p.red}\n**Pilar:** ${p.pilar}\n\n**Gancho:** ${p.gancho}\n\n**Guion:**\n${p.guion}\n\n**Copy:** ${p.copy}\n\n**CTA:** ${p.cta}\n\n${p.hashtags.join(" ")}`
  ).join("\n\n---\n\n");
  return `# Calendario de contenido · ${marca}

## Estrategia
${d.estrategia}

## Pilares
${d.pilares.map((p) => `- **${p.nombre}:** ${p.objetivo}`).join("\n")}

## Resumen
| Día | Formato | Red | Pilar | Gancho |
|---|---|---|---|---|
${d.piezas.map((p) => `| ${p.dia} | ${p.formato} | ${p.red} | ${p.pilar} | ${p.gancho.replace(/\|/g, "/")} |`).join("\n")}

## Piezas
${piezas}

## Métricas a seguir
${d.metricas_a_seguir.map((m) => `- ${m}`).join("\n")}`;
}
