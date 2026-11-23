// Simula un mes de operación con 20 clientes (modo demo, sin costo) y estima tiempos
// y costos reales. Uso: node scripts/simular-mes.js [--clientes 20] [--leads-por-dia 3]
//
// Valida la mecánica (agenda escalonada, prioridades, un trabajo a la vez por cliente,
// cumplimiento de cada plan) y proyecta la carga real con duraciones y costos estimados.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
const N_CLIENTES = arg("--clientes", 20);
const LEADS_POR_DIA = arg("--leads-por-dia", 3);
const MAX_JOBS = Number(process.env.MAX_JOBS || 4);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "escala-sim-"));
Object.assign(process.env, { ESCALA_MOCK: "1", DB_FILE: path.join(tmp, "sim.db"), AGENDA: "0", BACKUPS: "0", MAX_JOBS: String(MAX_JOBS) });

const { store } = await import("../src/store.js");
const { crearTrabajo } = await import("../src/jobs.js");
const { crearCliente } = await import("../src/memoria.js");
const { tick } = await import("../src/agenda.js");
const { resumenCartera, PLANES_OPERATIVOS } = await import("../src/cartera.js");

// Supuestos para proyectar la operación real (minutos por trabajo incluido el control
// de calidad, y USD por trabajo con Claude Opus 5.5). Ajustalos con los datos reales del panel.
const ESTIMADO = {
  auditoria: { min: 5, usd: 1.8 },
  contenido: { min: 4, usd: 1.0 },
  creativos: { min: 3, usd: 0.6 },
  reporte: { min: 1.5, usd: 0.2 },
  diagnostico: { min: 9, usd: 3.0 },
  calificacion: { min: 0.3, usd: 0.02 },
  seguimiento: { min: 0.3, usd: 0.02 },
};

// Cartera: mezcla de planes y rubros.
const planes = ["Growth 360", "Growth 360", "Tienda que convierte", "Redes que crecen"];
const rubros = ["Indumentaria", "Cosmética", "Deco", "Mascotas", "Suplementos", "Calzado", "Joyería", "Bebés"];
const clientes = Array.from({ length: N_CLIENTES }, (_, i) => crearCliente({
  marca: `Marca ${String(i + 1).padStart(2, "0")}`, rubro: rubros[i % rubros.length], plan: planes[i % planes.length],
  url: `https://marca${i + 1}.example.com`, productos: "Producto estrella", responsable: i % 2 ? "Account A" : "Account B",
}));

const esperarCola = async () => {
  let maxCola = 0;
  const t0 = Date.now();
  for (;;) {
    const enCola = store.count("jobs", { estado: "en_cola" });
    const activos = store.count("jobs", { estado: ["trabajando", "revisando"] });
    maxCola = Math.max(maxCola, enCola + activos);
    if (!enCola && !activos) return { maxCola, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 20));
  }
};

const MES = { anio: 2026, mes: 11 }; // diciembre (0-indexado)
const seguimientosPrevios = {};
const porDia = [];
let violacionesEquidad = 0;
const vigia = setInterval(() => {
  const ocupados = {};
  for (const j of store.list("jobs", { where: { estado: ["trabajando", "revisando"] }, liviano: true })) if (j.clienteId) ocupados[j.clienteId] = (ocupados[j.clienteId] || 0) + 1;
  if (Object.values(ocupados).some((n) => n > 1)) violacionesEquidad++;
}, 10);

for (let dia = 1; dia <= 31; dia++) {
  const fecha = new Date(Date.UTC(MES.anio, MES.mes, dia, 12));
  const antes = store.count("jobs");
  // Leads del sitio.
  for (let k = 0; k < LEADS_POR_DIA; k++) {
    const lead = store.insert("leads", { nombre: `Lead ${dia}-${k}`, contacto: `l${dia}${k}@x.com`, etapa: "nuevo", creado: fecha.toISOString() });
    crearTrabajo("calificacion", lead, { leadId: lead.id });
  }
  // Métricas semanales (lunes) para planes con reporte semanal; mensual para Redes.
  for (const c of clientes) {
    const reportes = PLANES_OPERATIVOS[c.plan].entregables.reporte || 0;
    const toca = reportes >= 4 ? fecha.getUTCDay() === 1 : dia === 28;
    if (toca) crearTrabajo("reporte", { periodo: `semana del ${dia}`, metricas: "ventas,84,71" }, { clienteId: c.id, origen: "ingesta" });
  }
  tick(fecha);
  const { maxCola } = await esperarCola();
  // El sistema fecha los cambios con el reloj real; en la simulación el "último movimiento"
  // de cada lead tiene que ser la fecha simulada para que los seguimientos respeten los días.
  for (const l of store.list("leads")) {
    const movioHoy = l.creado === fecha.toISOString() || (l.seguimientos || 0) !== (seguimientosPrevios[l.id] || 0);
    if (movioHoy) store.update("leads", l.id, { ultimo_seguimiento: fecha.toISOString() });
    seguimientosPrevios[l.id] = l.seguimientos || 0;
  }
  const creados = store.list("jobs", { liviano: true, limit: store.count("jobs") - antes });
  const minutos = creados.reduce((a, j) => a + (ESTIMADO[j.tipo]?.min || 1), 0);
  porDia.push({ dia, trabajos: creados.length, maxCola, horas_reales_estimadas: minutos / 60 / MAX_JOBS });
}
clearInterval(vigia);

const jobs = store.list("jobs", { liviano: true });
const porTipo = {};
for (const j of jobs) porTipo[j.tipo] = (porTipo[j.tipo] || 0) + 1;
const costo = Object.entries(porTipo).reduce((a, [t, n]) => a + n * (ESTIMADO[t]?.usd || 0), 0);
const cartera = resumenCartera(new Date());
const pico = porDia.reduce((a, d) => (d.horas_reales_estimadas > a.horas_reales_estimadas ? d : a));
const aRevisar = jobs.filter((j) => ["contenido", "creativos", "auditoria", "reporte"].includes(j.tipo)).length;
const conError = jobs.filter((j) => ["error", "requiere_revision"].includes(j.estado)).length;

const md = `# Simulación de un mes · ${N_CLIENTES} clientes · ${LEADS_POR_DIA} leads por día · ${MAX_JOBS} agentes en paralelo

## Mecánica (verificada en la simulación)
- Trabajos ejecutados: **${jobs.length}** (${Object.entries(porTipo).map(([t, n]) => `${t}: ${n}`).join(", ")})
- Trabajos que quedaron trabados: ${conError}
- Veces que un cliente tuvo más de un trabajo en paralelo: **${violacionesEquidad}**
- Clientes con todos los entregables del mes cumplidos: **${cartera.filas.filter((f) => f.cumplimiento_pct === 100).length}/${cartera.filas.length}**
- Pico de cola en un día: ${Math.max(...porDia.map((d) => d.maxCola))} trabajos
- En la simulación ningún lead responde, así que los seguimientos son el máximo posible (2 por lead)

## Proyección real (con los supuestos de duración y costo del script)
- Día más cargado: el ${pico.dia}, con ${pico.trabajos} trabajos ≈ **${pico.horas_reales_estimadas.toFixed(1)} h** de agentes trabajando en paralelo
- Promedio diario: ${(porDia.reduce((a, d) => a + d.horas_reales_estimadas, 0) / porDia.length).toFixed(1)} h
- Costo de IA estimado del mes: **USD ${costo.toFixed(0)}** (≈ USD ${(costo / N_CLIENTES).toFixed(1)} por cliente)
- Ingreso mensual de la cartera simulada: USD ${cartera.ingreso_mensual_usd.toLocaleString("es-AR")} → la IA es el **${((costo / cartera.ingreso_mensual_usd) * 100).toFixed(1)}%** del ingreso

## Carga humana (el verdadero cuello de botella)
- Entregas para revisar en el mes (calendarios, anuncios, auditorías y reportes): **${aRevisar}** ≈ ${(aRevisar / 22).toFixed(1)} por día hábil
- A ~8 minutos por revisión: **${((aRevisar * 8) / 60 / 22).toFixed(1)} h por día hábil** de revisión para toda la cartera
- Con publicación automática en los clientes de confianza, la revisión baja a un muestreo

| Día | Trabajos | Horas estimadas |
|---|---|---|
${porDia.map((d) => `| ${d.dia} | ${d.trabajos} | ${d.horas_reales_estimadas.toFixed(1)} |`).join("\n")}
`;
console.log(md);
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/SIMULACION_20_CLIENTES.md", md);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
