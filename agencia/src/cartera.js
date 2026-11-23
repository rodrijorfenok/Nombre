// Vista de cartera: para cada cliente, qué se le debe entregar este mes según su plan,
// cuánto se cumplió, qué está trabado, cuánto costó en IA y qué margen deja.
// Es el tablero para manejar 20 clientes sin perder a ninguno de vista.
import { store } from "./store.js";

// Precio mensual (USD) y entregables mensuales esperados por plan.
export const PLANES_OPERATIVOS = {
  "Redes que crecen": { precio: 450, entregables: { contenido: 1, reporte: 1 } },
  "Tienda que convierte": { precio: 650, entregables: { auditoria: 1, reporte: 4 } },
  "Growth 360": { precio: 1200, entregables: { contenido: 1, creativos: 1, auditoria: 1, reporte: 4 } },
};

export function entregablesDelPlan(plan) {
  return PLANES_OPERATIVOS[plan]?.entregables || {};
}

const HECHOS = ["listo", "aprobado"];
const TRABADOS = ["requiere_revision", "error"];

export function estadoCliente(cliente, ahora = new Date()) {
  const inicioMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();
  const trabajos = store.list("jobs", { where: { clienteId: cliente.id }, liviano: true });
  const delMes = trabajos.filter((j) => j.creado >= inicioMes);
  const esperados = entregablesDelPlan(cliente.plan);

  // Se cuentan las entregas hechas en el mes. El calendario y los anuncios del mes
  // siguiente se producen a fin de mes, así que cuentan para el mes en que se generan.
  const cumplimiento = Object.entries(esperados).map(([tipo, cantidad]) => {
    // Una versión rechazada queda en "rechazado", así que solo cuenta la versión vigente.
    const hechos = delMes.filter((j) => j.tipo === tipo && HECHOS.includes(j.estado)).length;
    return { tipo, esperados: cantidad, hechos: Math.min(hechos, cantidad) };
  });
  const totalEsperado = cumplimiento.reduce((a, c) => a + c.esperados, 0);
  const totalHecho = cumplimiento.reduce((a, c) => a + c.hechos, 0);

  const trabados = trabajos.filter((j) => TRABADOS.includes(j.estado));
  const viejo = trabados.some((j) => Date.now() - new Date(j.actualizado || j.creado).getTime() > 48 * 3600000);
  const costoMes = delMes.reduce((a, j) => a + (j.costo_usd || 0), 0);
  const precio = PLANES_OPERATIVOS[cliente.plan]?.precio || null;

  let salud = "verde";
  const motivos = [];
  if (trabados.length) { salud = "amarillo"; motivos.push(`${trabados.length} entrega(s) esperando a una persona`); }
  if (cliente.alerta) { salud = "amarillo"; motivos.push(cliente.alerta); }
  if (viejo) { salud = "rojo"; motivos.push("hay entregas trabadas hace más de 48 h"); }
  if (!cliente.plan) motivos.push("sin plan asignado: no se puede medir cumplimiento");

  return {
    id: cliente.id,
    marca: cliente.marca,
    plan: cliente.plan || null,
    responsable: cliente.responsable || null,
    activo: cliente.activo,
    salud,
    motivos,
    cumplimiento,
    cumplimiento_pct: totalEsperado ? Math.round((totalHecho / totalEsperado) * 100) : null,
    en_curso: trabajos.filter((j) => ["en_cola", "trabajando", "revisando", "esperando_reintento", "pausado_presupuesto"].includes(j.estado)).length,
    trabados: trabados.length,
    costo_ia_mes_usd: Number(costoMes.toFixed(3)),
    ingreso_mes_usd: precio,
    margen_ia_pct: precio ? Math.round(((precio - costoMes) / precio) * 1000) / 10 : null,
    ultima_entrega: delMes.find((j) => HECHOS.includes(j.estado))?.creado || null,
  };
}

export function resumenCartera(ahora = new Date()) {
  const clientes = store.list("clientes").filter((c) => c.activo);
  const filas = clientes.map((c) => estadoCliente(c, ahora));
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  filas.sort((a, b) => orden[a.salud] - orden[b.salud] || (a.cumplimiento_pct ?? 100) - (b.cumplimiento_pct ?? 100));
  const ingreso = filas.reduce((a, f) => a + (f.ingreso_mes_usd || 0), 0);
  const costo = filas.reduce((a, f) => a + f.costo_ia_mes_usd, 0);
  return {
    clientes_activos: filas.length,
    ingreso_mensual_usd: ingreso,
    costo_ia_mes_usd: Number(costo.toFixed(2)),
    costo_ia_pct_ingreso: ingreso ? Math.round((costo / ingreso) * 1000) / 10 : null,
    por_salud: { rojo: filas.filter((f) => f.salud === "rojo").length, amarillo: filas.filter((f) => f.salud === "amarillo").length, verde: filas.filter((f) => f.salud === "verde").length },
    filas,
  };
}
