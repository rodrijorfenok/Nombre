// Corre el banco de evaluaciones: node evals/run.js [--reps 3] [--solo id1,id2]
// Usa la configuración real (modelo, prompts, control de calidad). Con ESCALA_MOCK=1
// corre en modo demo para probar el arnés sin costo.
//
// Reporta por caso la tasa de éxito y pass^k (todas las repeticiones bien), que es
// la métrica que importa para algo que trabaja solo: un agente que acierta 3 de 4
// veces falla, en promedio, una entrega de cada cuatro.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const reps = Number(args[args.indexOf("--reps") + 1]) || (args.includes("--reps") ? 1 : 1);
const solo = args.includes("--solo") ? args[args.indexOf("--solo") + 1].split(",") : null;

const salida = path.join(path.dirname(new URL(import.meta.url).pathname), "resultados", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(salida, { recursive: true });
process.env.DATA_FILE = path.join(os.tmpdir(), `escala-eval-${process.pid}.json`);
process.env.AGENDA = "0";
process.env.MAX_JOBS = process.env.MAX_JOBS || "3";

const { CASOS, CASOS_CHAT } = await import("./casos.js");
const { store } = await import("../src/store.js");
const { crearTrabajo, retomarPendientes } = await import("../src/jobs.js");
const { chatear } = await import("../src/agents/comercial.js");
const { conTraza } = await import("../src/telemetria.js");

const FINALES = ["listo", "requiere_revision", "error"];
const esperar = async (id) => {
  for (;;) {
    const j = store.get("jobs", id);
    if (FINALES.includes(j.estado)) return j;
    if (j.estado === "esperando_reintento") retomarPendientes();
    await new Promise((r) => setTimeout(r, 500));
  }
};

const resultados = [];
const errores = [];

async function correrJob(caso, rep) {
  const t0 = Date.now();
  const job = await esperar(crearTrabajo(caso.tipo, caso.input).id);
  if (job.estado === "error") return errores.push({ caso: caso.id, rep, clase: "error_de_ejecucion", error: job.error });
  const fallas = [];
  const estadoEsperado = caso.estadoEsperado || "listo";
  if (job.estado !== estadoEsperado) fallas.push(`Estado ${job.estado}, se esperaba ${estadoEsperado}`);
  fallas.push(...caso.esperado(job));
  resultados.push({ caso: caso.id, tipo: caso.tipo, rep, ok: !fallas.length, fallas, estado: job.estado, calidad: job.calidad, costo_usd: job.costo_usd || 0, segundos: (Date.now() - t0) / 1000, transcript: { resultado: job.resultado, revisiones: job.revisiones, traza: job.traza } });
}

async function correrChat(caso, rep) {
  const acciones = [];
  const traza = {};
  const fake = {
    registrarLead: async (datos) => (acciones.push({ tipo: "registrarLead", datos }), { id: "lead_eval" }),
    solicitarAuditoria: async (link) => (acciones.push({ tipo: "solicitarAuditoria", link }), { ok: true }),
    derivar: async (d) => (acciones.push({ tipo: "derivar", ...d }), { ok: true }),
  };
  const history = [];
  let respuesta = "";
  try {
    await conTraza(traza, async () => {
      for (const t of caso.turnos) {
        history.push({ role: "user", text: t });
        respuesta = await chatear({ history, acciones: fake, estado: acciones.some((a) => a.tipo === "registrarLead") ? "Estado del CRM para esta conversación: lead registrado." : "" });
        history.push({ role: "assistant", text: respuesta });
      }
    });
  } catch (err) {
    return errores.push({ caso: caso.id, rep, clase: "error_de_ejecucion", error: err.message });
  }
  const fallas = caso.esperado({ acciones, respuesta, history });
  resultados.push({ caso: caso.id, tipo: "chat", rep, ok: !fallas.length, fallas, costo_usd: traza.costo_usd || 0, transcript: { history, acciones } });
}

const tareas = [];
for (let rep = 0; rep < reps; rep++) {
  for (const c of CASOS) if (!solo || solo.includes(c.id)) tareas.push(correrJob(c, rep));
  for (const c of CASOS_CHAT) if (!solo || solo.includes(c.id)) tareas.push(correrChat(c, rep));
}
await Promise.all(tareas);

// ---------- informe ----------
const porCaso = {};
for (const r of resultados) (porCaso[r.caso] ||= []).push(r);
const filas = Object.entries(porCaso).map(([id, rs]) => {
  const ok = rs.filter((r) => r.ok).length;
  return { id, tipo: rs[0].tipo, ok, total: rs.length, passK: ok === rs.length, costo: rs.reduce((a, r) => a + r.costo_usd, 0), fallas: [...new Set(rs.flatMap((r) => r.fallas))] };
});
const totalOk = resultados.filter((r) => r.ok).length;
const costo = resultados.reduce((a, r) => a + r.costo_usd, 0);
const md = `# Evaluación de agentes · ${new Date().toLocaleString("es-AR")}

Modo: ${process.env.ESCALA_MOCK === "1" ? "demo (sin API)" : "real"} · Repeticiones por caso: ${reps}

- Intentos aprobados: **${totalOk}/${resultados.length}** (${resultados.length ? Math.round((totalOk / resultados.length) * 100) : 0}%)
- Casos con pass^${reps} (todas las repeticiones bien): **${filas.filter((f) => f.passK).length}/${filas.length}**
- Errores de ejecución (no cuentan como fallas del modelo): ${errores.length}
- Costo total: USD ${costo.toFixed(3)}

| Caso | Tipo | Aciertos | pass^k | Costo USD | Fallas |
|---|---|---|---|---|---|
${filas.map((f) => `| ${f.id} | ${f.tipo} | ${f.ok}/${f.total} | ${f.passK ? "✓" : "✗"} | ${f.costo.toFixed(3)} | ${f.fallas.join("; ") || "—"} |`).join("\n")}
${errores.length ? `\n## Errores de ejecución\n${errores.map((e) => `- ${e.caso} (rep ${e.rep}): ${e.error}`).join("\n")}` : ""}

Las transcripciones completas están en \`results.jsonl\`. Leelas antes de confiar en un número.`;

fs.writeFileSync(path.join(salida, "results.jsonl"), resultados.map((r) => JSON.stringify(r)).join("\n"));
fs.writeFileSync(path.join(salida, "errors.jsonl"), errores.map((r) => JSON.stringify(r)).join("\n"));
fs.writeFileSync(path.join(salida, "resumen.md"), md);
console.log(md);
console.log(`\nResultados en ${salida}`);
process.exit(filas.every((f) => f.passK) && !errores.length ? 0 : 1);
