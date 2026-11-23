// Agente Auditor CRO: visita la tienda (y opcionalmente las redes) con lectura web,
// evalúa los 20 puntos del checklist y devuelve un informe con mejoras priorizadas.
import { z } from "zod";
import { runText, runStructured, WEB_TOOLS } from "../ai.js";
import { AGENCIA, ESTILO, CHECKLIST_CRO, DATOS_EXTERNOS, PLANES } from "./conocimiento.js";

export const AuditoriaSchema = z.object({
  puntaje_general: z.number().int().describe("0 a 100: qué tan preparada está la tienda para convertir"),
  resumen: z.string().describe("2 o 3 oraciones con el diagnóstico principal"),
  checklist: z.array(z.object({
    punto: z.string(),
    estado: z.enum(["ok", "mejorable", "critico", "sin_datos"]),
    observacion: z.string(),
  })),
  mejoras_top: z.array(z.object({
    titulo: z.string(),
    impacto: z.enum(["alto", "medio", "bajo"]),
    esfuerzo: z.enum(["bajo", "medio", "alto"]),
    detalle: z.string(),
  })).describe("Las 10 mejoras de mayor impacto, ordenadas"),
  plan_recomendado: z.enum(PLANES),
});

const SYSTEM = `${AGENCIA}

Tu rol: Auditor/a de conversión (CRO) para e-commerce.
${ESTILO}
${DATOS_EXTERNOS}

Cómo trabajás:
1. Leé la URL de la tienda con web_fetch. Si podés, leé también una ficha de producto y una colección
   enlazadas desde la home (máximo 4 páginas en total). Si te pasan una red social, podés buscarla.
2. Evaluá cada punto del checklist con lo que realmente viste. Si algo no se puede verificar desde
   afuera (por ejemplo el checkout o la velocidad real), marcalo como "sin datos" y decí cómo medirlo.
3. Priorizá por impacto en ventas y esfuerzo de implementación.

Checklist de 20 puntos:
${CHECKLIST_CRO.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Formato del informe (markdown):
# Auditoría de <marca>
## Diagnóstico en 3 líneas
## Lo que está bien
## Checklist (tabla: punto | estado | observación)
## Top 10 mejoras (ordenadas, con impacto y esfuerzo)
## Próximos pasos recomendados`;

export async function auditar({ url, redes = "", contexto = "" }) {
  if (!/^https?:\/\//i.test(url || "")) throw new Error("Falta una URL válida de la tienda (con https://).");
  const prompt = [
    `Auditá esta tienda online: ${url}`,
    redes && `Redes de la marca: ${redes}`,
    contexto && `Contexto que dio el cliente: ${contexto}`,
  ].filter(Boolean).join("\n");

  const informe = await runText({
    agent: "auditor",
    system: SYSTEM,
    prompt,
    effort: "high",
    serverTools: [WEB_TOOLS.fetch(5), WEB_TOOLS.search(2)],
  });

  const estructura = await runStructured({
    agent: "auditor",
    system: "Convertí el informe de auditoría en datos estructurados, sin agregar nada que no esté en el informe. El checklist debe tener los 20 puntos.",
    prompt: `Checklist de referencia:\n${CHECKLIST_CRO.join("\n")}\n\nInforme:\n${informe.text}`,
    schema: AuditoriaSchema,
    effort: "low",
  });

  return { markdown: informe.text, data: estructura.data };
}
