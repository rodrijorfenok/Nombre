// Agente de Creativos: genera tandas de anuncios para Meta y TikTok con ángulos
// distintos (dolor, deseo, prueba social, objeción, comparación, oferta).
import { z } from "zod";
import { runStructured } from "../ai.js";
import { AGENCIA, ESTILO } from "./conocimiento.js";

export const CreativosSchema = z.object({
  anuncios: z.array(z.object({
    angulo: z.string(),
    formato: z.enum(["UGC", "Voz en off", "Estático", "Carrusel", "Demo de producto"]),
    gancho: z.string(),
    guion: z.string().describe("Escenas con texto en pantalla y locución; vacío si es estático"),
    texto_principal: z.string(),
    titulo: z.string(),
    cta: z.enum(["Comprar", "Ver más", "Enviar mensaje", "Registrarte", "Pedir ahora"]),
  })),
  recomendacion_de_testeo: z.string(),
});

const SYSTEM = `${AGENCIA}

Tu rol: Estratega creativo de pauta para Meta Ads y TikTok Ads en e-commerce.
${ESTILO}

Criterios:
- Diversidad real: cada anuncio usa un ángulo y un gancho distintos (no variaciones de la misma frase).
- Ganchos que se entienden sin sonido en los primeros 2 segundos.
- Guiones de 15 a 35 segundos, escena por escena, con texto en pantalla.
- Respetá las políticas publicitarias: nada de promesas de salud, antes/después engañosos ni datos inventados.`;

export async function creativos({ producto, oferta = "", publico = "", diferencial = "", cantidad = 8 }) {
  if (!producto) throw new Error("Falta el producto.");
  const n = Math.min(Math.max(Number(cantidad) || 8, 3), 20);
  const prompt = `Generá ${n} anuncios para:
Producto: ${producto}
Oferta: ${oferta || "sin oferta especial"}
Público: ${publico || "definilo vos"}
Diferencial: ${diferencial || "no especificado"}`;
  const { data } = await runStructured({ agent: "creativos", system: SYSTEM, prompt, schema: CreativosSchema, effort: "medium", maxTokens: 24000 });
  const markdown = `# Tanda de anuncios · ${producto}

${data.anuncios.map((a, i) => `## ${i + 1}. ${a.angulo} · ${a.formato}
**Gancho:** ${a.gancho}

${a.guion ? `**Guion:**\n${a.guion}\n\n` : ""}**Texto principal:** ${a.texto_principal}

**Título:** ${a.titulo} · **CTA:** ${a.cta}`).join("\n\n---\n\n")}

## Cómo testearlos
${data.recomendacion_de_testeo}`;
  return { data, markdown };
}
