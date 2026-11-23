// Agente Auditor CRO: visita la tienda (y opcionalmente las redes) con lectura web,
// evalúa los 20 puntos del checklist y devuelve un informe con mejoras priorizadas.
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { runText, runStructured, WEB_TOOLS, contextoExtra } from "../ai.js";
import { leerPagina } from "../lectorWeb.js";
import { AGENCIA, ESTILO, CHECKLIST_CRO, DATOS_EXTERNOS, PLANES } from "./conocimiento.js";

export const AuditoriaSchema = z.object({
  sitio_accesible: z.boolean().describe("false si no se pudo leer la tienda"),
  puntaje_general: z.number().int().describe("0 a 100: qué tan preparada está la tienda para convertir"),
  resumen: z.string().describe("2 o 3 oraciones con el diagnóstico principal"),
  checklist: z.array(z.object({
    punto: z.string(),
    estado: z.enum(["ok", "mejorable", "critico", "sin_datos"]),
    observacion: z.string(),
    evidencia: z.string().describe("Qué se vio en la página que respalda el estado (cita o descripción); vacío si sin_datos"),
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
1. Leé la URL de la tienda con tu herramienta de lectura web. Si podés, leé también una ficha de producto y una colección
   enlazadas desde la home (máximo 4 páginas en total). Si te pasan una red social, podés buscarla.
2. Evaluá cada punto del checklist con lo que realmente viste. Si algo no se puede verificar desde
   afuera (por ejemplo el checkout o la velocidad real), marcalo como "sin datos" y decí cómo medirlo.
3. Priorizá por impacto en ventas y esfuerzo de implementación.
4. Cada afirmación tiene que apoyarse en algo que viste: citá el texto o describí el elemento.
   Nunca supongas lo que no pudiste leer.
5. Si la tienda no se puede leer (bloqueo, error, sitio caído), decilo al principio del informe y no
   inventes el análisis: marcá todos los puntos como "sin datos" y explicá cómo seguir.

Checklist de 20 puntos:
${CHECKLIST_CRO.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Formato del informe (markdown):
# Auditoría de <marca>
## Diagnóstico en 3 líneas
## Lo que está bien
## Checklist (tabla: punto | estado | observación)
## Top 10 mejoras (ordenadas, con impacto y esfuerzo)
## Próximos pasos recomendados`;

export async function auditar(input) {
  const { url, redes = "", contexto = "" } = input;
  if (!/^https?:\/\//i.test(url || "")) throw new Error("Falta una URL válida de la tienda (con https://).");
  const prompt = [
    `Auditá esta tienda online: ${url}`,
    redes && `Redes de la marca: ${redes}`,
    contexto && `Contexto que dio el cliente: ${contexto}`,
  ].filter(Boolean).join("\n") + contextoExtra(input);

  // Lectura web: por defecto la de Anthropic. Si no está disponible (red restringida,
  // organización que la desactiva), el servidor lee las páginas con su propio lector.
  const modo = process.env.AUDITOR_LECTURA || "anthropic";
  const conLectorPropio = () => runText({ agent: "auditor", system: SYSTEM, prompt, effort: "high", tools: [herramientaLectura(url)] });
  let informe;
  if (modo === "servidor") {
    informe = await conLectorPropio();
  } else {
    try {
      informe = await runText({ agent: "auditor", system: SYSTEM, prompt, effort: "high", serverTools: [WEB_TOOLS.fetch(5), WEB_TOOLS.search(2)] });
    } catch (err) {
      if (err.code !== "bad_request" || !/web_fetch|web_search/.test(err.message)) throw err;
      informe = await conLectorPropio();
    }
  }

  const estructura = await runStructured({
    agent: "auditor",
    system: "Convertí el informe de auditoría en datos estructurados, sin agregar nada que no esté en el informe. El checklist debe tener los 20 puntos, en el mismo orden. Si el informe dice que la tienda no se pudo leer, sitio_accesible es false.",
    prompt: `Checklist de referencia:\n${CHECKLIST_CRO.join("\n")}\n\nInforme:\n${informe.text}`,
    schema: AuditoriaSchema,
    effort: "low",
  });

  return { markdown: informe.text, data: estructura.data };
}

/** Herramienta de lectura limitada al dominio de la tienda y a 5 páginas por auditoría. */
function herramientaLectura(urlTienda) {
  const dominio = new URL(urlTienda).hostname;
  let usos = 0;
  return betaZodTool({
    name: "leer_pagina",
    description: `Lee una página de la tienda auditada (${dominio}) y devuelve su contenido como texto: títulos, textos, precios, botones, enlaces e imágenes con su texto alternativo. Solo acepta URLs de ${dominio}. Máximo 5 lecturas por auditoría: elegí la home, una colección y una ficha de producto.`,
    inputSchema: z.object({ url: z.string().describe(`URL completa de una página de ${dominio}. Para la home usá exactamente la URL que te pasaron (mismo http o https).`) }),
    run: async ({ url }) => {
      if (++usos > 5) return "Ya leíste 5 páginas: escribí el informe con lo que tenés.";
      try {
        return await leerPagina(url, { dominioPermitido: dominio });
      } catch (err) {
        return `No se pudo leer ${url}: ${err.message} Si es la home, informá que la tienda no es accesible.`;
      }
    },
  });
}
