// Agente Comercial: atiende el chat del sitio, responde dudas, recomienda un plan,
// registra el lead y puede pedir una auditoría automática de la tienda.
// También califica los leads que llegan por el formulario.
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { runChat, runStructured } from "../ai.js";
import { AGENCIA, ESTILO, PLANES } from "./conocimiento.js";
import { config } from "../config.js";

const SYSTEM_CHAT = `${AGENCIA}

Tu rol: Asesor/a comercial de la agencia en el chat del sitio web.
${ESTILO}

Cómo conversás:
- Respuestas cortas (2 a 5 oraciones). Una pregunta por mensaje.
- Entendé primero el negocio: qué vende, dónde vende, cuánto factura aprox. y cuál es el problema principal.
- Recomendá el plan que corresponda y explicá por qué en una oración. Si no está claro, sugerí la Auditoría Express.
- Cuando tengas nombre y un contacto (email o WhatsApp), usá registrar_lead. Actualizalo si aparecen datos nuevos.
- Si la persona comparte el link de su tienda y quiere un diagnóstico, usá solicitar_auditoria: un agente
  analiza la tienda y el equipo le escribe con los resultados en 48 h hábiles. No digas que ya la analizaste.
- No inventes descuentos, casos de clientes ni plazos distintos a los publicados.
- Si preguntan algo fuera de marketing digital, redirigí con amabilidad.
${config.agencia.whatsapp ? `- WhatsApp de la agencia: ${config.agencia.whatsapp}` : ""}
${config.agencia.email ? `- Email de la agencia: ${config.agencia.email}` : ""}`;

/**
 * Un turno del chat. `acciones` recibe los efectos de las herramientas para que
 * el servidor los persista (guardar lead, encolar auditoría).
 */
export async function chatear({ history, acciones }) {
  const registrarLead = betaZodTool({
    name: "registrar_lead",
    description: "Guarda o actualiza los datos del interesado en el CRM de la agencia. Usalo apenas tengas nombre y un contacto.",
    inputSchema: z.object({
      nombre: z.string(),
      contacto: z.string().describe("Email o WhatsApp"),
      marca: z.string().optional(),
      link: z.string().optional().describe("URL de la tienda o red social"),
      facturacion: z.string().optional(),
      problema: z.string().optional(),
      plan_interes: z.enum(PLANES).optional(),
      temperatura: z.enum(["frio", "tibio", "caliente"]).describe("Qué tan cerca está de contratar"),
    }),
    run: async (input) => {
      const lead = await acciones.registrarLead(input);
      return `Lead guardado (${lead.id}).`;
    },
  });

  const solicitarAuditoria = betaZodTool({
    name: "solicitar_auditoria",
    description: "Encola una auditoría automática de la tienda del interesado. Requiere haber registrado el lead antes.",
    inputSchema: z.object({ link: z.string().describe("URL completa de la tienda, con https://") }),
    run: async ({ link }) => {
      const res = await acciones.solicitarAuditoria(link);
      return res.ok ? "Auditoría encolada. El equipo la revisa y le escribe en 48 h hábiles." : `No se pudo encolar: ${res.motivo}`;
    },
  });

  const { text } = await runChat({ agent: "comercial", system: SYSTEM_CHAT, history, tools: [registrarLead, solicitarAuditoria], effort: "low" });
  return text;
}

export const CalificacionSchema = z.object({
  puntaje: z.number().int().describe("0 a 100: probabilidad y valor de cierre"),
  temperatura: z.enum(["frio", "tibio", "caliente"]),
  plan_recomendado: z.enum(PLANES),
  motivo: z.string(),
  proximo_paso: z.string(),
  mensaje_sugerido: z.string().describe("Primer mensaje de WhatsApp para enviarle, listo para copiar"),
});

export async function calificarLead(lead) {
  const prompt = `Calificá este lead que llegó por el formulario del sitio y redactá el primer mensaje:
${JSON.stringify({ nombre: lead.nombre, marca: lead.marca, link: lead.link, facturacion: lead.facturacion, plan_interes: lead.plan_interes, problema: lead.problema }, null, 2)}`;
  const { data } = await runStructured({
    agent: "comercial",
    system: `${AGENCIA}\n\nTu rol: Responsable comercial. Calificás leads y escribís el primer contacto.\n${ESTILO}\nEl mensaje sugerido va en voseo, máximo 5 líneas, menciona algo concreto de su caso y propone un siguiente paso.`,
    prompt,
    schema: CalificacionSchema,
    effort: "low",
  });
  return {
    data,
    markdown: `# Calificación · ${lead.marca || lead.nombre}
**Puntaje:** ${data.puntaje}/100 · **Temperatura:** ${data.temperatura} · **Plan recomendado:** ${data.plan_recomendado}

**Motivo:** ${data.motivo}

**Próximo paso:** ${data.proximo_paso}

## Mensaje sugerido
${data.mensaje_sugerido}`,
  };
}
