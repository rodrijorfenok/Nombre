// Modo demo (ESCALA_MOCK=1): respuestas simuladas para probar el sistema completo
// sin API key ni costo. Todo lo que devuelve está marcado como DEMO.
import { CHECKLIST_CRO } from "./agents/conocimiento.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO = "> **DEMO:** resultado simulado. Configurá ANTHROPIC_API_KEY y quitá ESCALA_MOCK para usar los agentes reales.";

const TEXTOS = {
  auditor: `# Auditoría de la tienda (DEMO)
${DEMO}

## Diagnóstico en 3 líneas
La tienda tiene buen catálogo pero la ficha de producto no muestra cuotas ni costo de envío.
No hay reseñas visibles y el botón de compra se pierde en celular.

## Top 10 mejoras
1. Mostrar cuotas y envío en la ficha.
2. Agregar reseñas con foto.
3. Botón de compra fijo en celular.`,
  reportes: `# Reporte semanal (DEMO)
${DEMO}

## Resumen en 3 líneas
Las ventas subieron por el reel del martes. La conversión se mantuvo estable.`,
  diagnostico: `# Plan de 90 días (DEMO)
${DEMO}

## Objetivos
1. Subir la conversión de 1,2% a 1,6%.
2. Duplicar los guardados por publicación.
3. Recuperar el 10% de los carritos abandonados.`,
};

export async function runText({ agent }) {
  await espera(300);
  return { text: TEXTOS[agent] || `# Resultado (DEMO)\n${DEMO}`, usage: null };
}

const DATOS = {
  auditor: () => ({
    puntaje_general: 58,
    resumen: "DEMO: buen catálogo, pero faltan señales de confianza y claridad de precio en la ficha.",
    checklist: CHECKLIST_CRO.map((punto, i) => ({ punto, estado: ["ok", "mejorable", "critico", "sin_datos"][i % 4], observacion: "Observación de ejemplo." })),
    mejoras_top: Array.from({ length: 10 }, (_, i) => ({ titulo: `Mejora de ejemplo ${i + 1}`, impacto: i < 3 ? "alto" : "medio", esfuerzo: "bajo", detalle: "Detalle de ejemplo." })),
    plan_recomendado: "Tienda que convierte",
  }),
  contenido: () => ({
    estrategia: "DEMO: mes enfocado en mostrar el producto en uso y sumar prueba social.",
    pilares: [{ nombre: "Producto en uso", objetivo: "Venta" }, { nombre: "Detrás de escena", objetivo: "Comunidad" }, { nombre: "Tips del rubro", objetivo: "Alcance" }],
    piezas: [3, 6, 10, 13].map((dia, i) => ({
      dia, red: "Instagram + TikTok", formato: i % 2 ? "Carrusel" : "Reel", pilar: "Producto en uso",
      gancho: "Gancho de ejemplo", guion: "Escena 1 (0–3 s): ...\nEscena 2 (3–8 s): ...", copy: "Copy de ejemplo.", cta: "Comprá en el link de la bio", hashtags: ["#demo"],
    })),
    metricas_a_seguir: ["Guardados", "Compartidos", "Clics al link"],
  }),
  creativos: () => ({
    anuncios: ["Dolor", "Deseo", "Prueba social"].map((angulo) => ({
      angulo, formato: "UGC", gancho: `Gancho de ejemplo (${angulo})`, guion: "Escena 1: ...", texto_principal: "Texto de ejemplo.", titulo: "Título de ejemplo", cta: "Comprar",
    })),
    recomendacion_de_testeo: "DEMO: testeá los 3 ángulos en un mismo conjunto de anuncios durante 5 días.",
  }),
  comercial: () => ({
    puntaje: 72, temperatura: "tibio", plan_recomendado: "Tienda que convierte",
    motivo: "DEMO: ya vende online y su problema es la conversión.",
    proximo_paso: "Enviar la auditoría y proponer una llamada de 20 minutos.",
    mensaje_sugerido: "¡Hola! Soy del equipo de Escalá. Vimos tu tienda y tenemos 3 ideas concretas para que convierta más. ¿Te va una llamada corta esta semana? (DEMO)",
  }),
};

export async function runStructured({ agent, schema }) {
  await espera(300);
  const make = DATOS[agent];
  if (!make) throw new Error(`Sin datos demo para ${agent}`);
  return { data: schema.parse(make()), usage: null };
}

export async function runChat({ history, tools }) {
  await espera(200);
  const ultimo = history[history.length - 1]?.text || "";
  const contacto = ultimo.match(/[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{7,}\d/);
  const link = ultimo.match(/https?:\/\/\S+/);
  const tool = (n) => tools.find((t) => t.name === n);
  if (contacto) {
    await tool("registrar_lead").run({ nombre: "Contacto del chat (DEMO)", contacto: contacto[0].trim(), temperatura: "tibio" });
    if (link) await tool("solicitar_auditoria").run({ link: link[0] });
    return { text: `¡Gracias! Ya guardé tu contacto${link ? " y pedí la auditoría de tu tienda" : ""}. El equipo te escribe en 48 h hábiles. (DEMO)` };
  }
  return { text: "¡Hola! Soy el asistente de Escalá (modo DEMO). Contame qué vendés y dónde, y te digo qué plan te conviene. Si querés que te contactemos, dejame tu email o WhatsApp." };
}
