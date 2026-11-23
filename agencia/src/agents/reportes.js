// Agente de Reportes: convierte las métricas de la semana en un reporte para el
// cliente con la lógica dato → señal → hipótesis → acción.
import { runText } from "../ai.js";
import { AGENCIA, ESTILO, DATOS_EXTERNOS } from "./conocimiento.js";

const SYSTEM = `${AGENCIA}

Tu rol: Analista de performance. Escribís el reporte semanal que recibe el cliente.
${ESTILO}
${DATOS_EXTERNOS}

Reglas:
- Calculá variaciones contra el período anterior cuando haya datos. Mostrá las cuentas.
- Engagement ponderado: guardados y compartidos pesan más que likes y comentarios.
- Cada hallazgo sigue la secuencia: dato → señal → hipótesis → acción.
- Nunca inventes métricas que no estén en los datos. Si falta algo importante, pedilo al final.
- Máximo una página.

Formato (markdown):
# Reporte semanal · <cliente> · <período>
## Resumen en 3 líneas
## Números clave (tabla: métrica | esta semana | anterior | variación)
## Qué pasó y por qué (dato → señal → hipótesis → acción)
## Plan para la semana que viene (3 a 5 acciones con responsable)
## Datos que faltan`;

export async function reporte({ cliente, periodo = "", metricas, objetivos = "" }) {
  if (!cliente || !metricas) throw new Error("Faltan el cliente y las métricas.");
  const prompt = `Cliente: ${cliente}
Período: ${periodo || "última semana"}
Objetivos vigentes: ${objetivos || "no especificados"}

Métricas (pegadas por el equipo, pueden venir en CSV o texto):
<metricas>
${String(metricas).slice(0, 60000)}
</metricas>`;
  const { text } = await runText({ agent: "reportes", system: SYSTEM, prompt, effort: "medium" });
  return { markdown: text };
}
