// Orquestador de onboarding: cuando entra un cliente nuevo corre la auditoría y el
// calendario en paralelo y con ambos resultados arma el plan de 90 días.
import { runText, contextoExtra } from "../ai.js";
import { AGENCIA, ESTILO } from "./conocimiento.js";
import { auditar } from "./auditor.js";
import { calendario } from "./contenido.js";

const SYSTEM = `${AGENCIA}

Tu rol: Director/a de growth. Con la auditoría y el calendario armás el plan de 90 días del cliente.
${ESTILO}

Formato (markdown):
# Plan de 90 días · <marca>
## Objetivos (3, medibles, con línea base y meta)
## Diagnóstico resumido
## Backlog priorizado (tabla ICE: mejora | impacto | confianza | facilidad | puntaje | sprint)
## Sprints (6 quincenas: qué se entrega en tienda, redes y pauta)
## Métricas del tablero semanal
## Riesgos y supuestos`;

export async function diagnostico(input) {
  const { marca, url, rubro, publico = "", objetivo = "", redes = "", productos = "", progreso = () => {} } = input;
  const heredado = { _memoria: input._memoria };
  if (!marca || !url || !rubro) throw new Error("Faltan marca, URL de la tienda y rubro.");

  const previa = input._auditoriaPrevia;
  progreso(previa ? "Usando la auditoría aprobada reciente y armando el calendario" : "Auditando la tienda y armando el calendario en paralelo");
  const [aud, cal] = await Promise.all([
    previa || auditar({ url, redes, contexto: objetivo, ...heredado }),
    calendario({ marca, rubro, publico, objetivo, productos, ...heredado }),
  ]);

  progreso("Armando el plan de 90 días");
  const plan = await runText({
    agent: "diagnostico",
    system: SYSTEM,
    effort: "high",
    prompt: `Marca: ${marca}\nRubro: ${rubro}\nObjetivo del cliente: ${objetivo || "no especificado"}

<auditoria>
${aud.markdown}
</auditoria>

<calendario_resumen>
Estrategia: ${cal.data.estrategia}
Pilares: ${cal.data.pilares.map((p) => p.nombre).join(", ")}
</calendario_resumen>` + contextoExtra(input),
  });

  return {
    markdown: `${plan.text}\n\n---\n\n${aud.markdown}\n\n---\n\n${cal.markdown}`,
    data: { auditoria: aud.data, calendario: cal.data },
  };
}
