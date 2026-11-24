// Modo demo (ESCALA_MOCK=1): respuestas simuladas para probar el sistema completo
// sin API key ni costo. Todo lo que devuelve está marcado como DEMO.
import { CHECKLIST_CRO } from "./agents/conocimiento.js";

// ESCALA_DEMO_LATENCIA_MS simula la demora de una llamada real (útil para ver los estados en el panel).
const espera = (ms) => new Promise((r) => setTimeout(r, Number(process.env.ESCALA_DEMO_LATENCIA_MS) || ms));
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
Las ventas subieron por el reel del martes. La conversión se mantuvo estable.

## Números clave
| Métrica | Esta semana | Anterior | Variación |
|---|---|---|---|
| Ventas | 84 | 71 | +18% |

## Plan para la semana que viene
- Repetir el formato del reel del martes (content lead).`,
  diagnostico: `# Plan de 90 días (DEMO)
${DEMO}

## Objetivos
1. Subir la conversión de 1,2% a 1,6%.
2. Duplicar los guardados por publicación.
3. Recuperar el 10% de los carritos abandonados.

## Backlog priorizado
| Mejora | I | C | F | Puntaje | Sprint |
|---|---|---|---|---|---|
| Cuotas y envío en la ficha | 9 | 8 | 9 | 26 | 1 |

## Sprints
1. Quincena 1: ficha de producto.`,
};

const corregido = (prompt) => (String(prompt).includes("<correcciones_del_revisor>") ? " (corregido)" : "");

const fallasHechas = new Set();
export async function runText({ agent, prompt }) {
  await espera(150);
  // Simula un corte de red una sola vez para probar los reintentos.
  if (String(prompt).includes("FALLA_TRANSITORIA") && !fallasHechas.has(prompt)) {
    fallasHechas.add(prompt);
    throw new Error("ECONNRESET (DEMO)");
  }
  return { text: (TEXTOS[agent] || `# Resultado (DEMO)\n${DEMO}`) + corregido(prompt) };
}

const DATOS = {
  auditor: () => ({
    sitio_accesible: true,
    puntaje_general: 58,
    resumen: "DEMO: buen catálogo, pero faltan señales de confianza y claridad de precio en la ficha.",
    checklist: CHECKLIST_CRO.map((punto, i) => ({ punto, estado: ["ok", "mejorable", "critico", "sin_datos"][i % 4], observacion: "Observación de ejemplo.", evidencia: i % 4 === 3 ? "" : "Elemento visto en la home (DEMO)." })),
    mejoras_top: Array.from({ length: 10 }, (_, i) => ({ titulo: `Mejora de ejemplo ${i + 1}`, impacto: i < 3 ? "alto" : "medio", esfuerzo: "bajo", detalle: "Detalle de ejemplo." })),
    plan_recomendado: "Tienda que convierte",
  }),
  contenido: (prompt) => {
    const n = Number(prompt.match(/exactamente (\d+) elementos/)?.[1] || 4);
    return {
      estrategia: "DEMO: mes enfocado en mostrar el producto en uso y sumar prueba social.",
      pilares: [{ nombre: "Producto en uso", objetivo: "Venta" }, { nombre: "Detrás de escena", objetivo: "Comunidad" }, { nombre: "Tips del rubro", objetivo: "Alcance" }],
      piezas: Array.from({ length: n }, (_, i) => ({
        dia: 1 + Math.floor((i * 30) / n), red: "Instagram + TikTok", formato: ["Reel", "Carrusel", "Historia"][i % 3], pilar: "Producto en uso",
        gancho: `Gancho de ejemplo ${i + 1}`, guion: "Escena 1 (0–3 s): ...\nEscena 2 (3–8 s): ...", copy: "Copy de ejemplo.", cta: "Comprá en el link de la bio", hashtags: ["#demo"],
      })),
      metricas_a_seguir: ["Guardados", "Compartidos", "Clics al link"],
    };
  },
  creativos: (prompt) => {
    const n = Number(prompt.match(/exactamente (\d+) anuncios/)?.[1] || 3);
    const angulos = ["Dolor", "Deseo", "Prueba social", "Objeción", "Comparación", "Oferta", "Detrás de escena", "Urgencia"];
    return {
      anuncios: Array.from({ length: n }, (_, i) => ({
        angulo: `${angulos[i % angulos.length]}${i >= angulos.length ? ` ${i}` : ""}`, formato: "UGC", gancho: `Gancho de ejemplo ${i + 1}`, guion: "Escena 1: ...",
        texto_principal: "Texto de ejemplo.", titulo: "Título de ejemplo", cta: "Comprar",
      })),
      recomendacion_de_testeo: "DEMO: testeá los ángulos en un mismo conjunto de anuncios durante 5 días.",
    };
  },
  // Revisor: aprueba, salvo que el pedido diga FORZAR_REVISION y la entrega todavía no esté corregida.
  revisor: (prompt) => {
    const rechazar = prompt.includes("FORZAR_REVISION") && !prompt.includes("(corregido)");
    return {
      criterios: [{ id: "general", veredicto: rechazar ? "no_cumple" : "cumple", motivo: "DEMO" }],
      correcciones: rechazar ? ["DEMO: agregá más detalle en las mejoras."] : [],
      puntaje: rechazar ? 55 : 92,
    };
  },
  seguimiento: () => ({ mensaje: "¡Hola! Te escribo de Kairos Creative para retomar lo que hablamos. ¿Te queda bien una llamada de 15 minutos esta semana? (DEMO)", canal: "whatsapp" }),
  comercial: () => ({
    puntaje: 72, temperatura: "tibio", plan_recomendado: "Tienda que convierte",
    motivo: "DEMO: ya vende online y su problema es la conversión.",
    proximo_paso: "Enviar la auditoría y proponer una llamada de 20 minutos.",
    mensaje_sugerido: "¡Hola! Soy del equipo de Kairos Creative. Vimos tu tienda y tenemos 3 ideas concretas para que convierta más. ¿Te va una llamada corta esta semana? (DEMO)",
  }),
};

export async function runStructured({ agent, prompt, schema }) {
  await espera(150);
  const make = DATOS[agent];
  if (!make) throw new Error(`Sin datos demo para ${agent}`);
  const data = make(String(prompt));
  if (data.resumen && corregido(prompt)) data.resumen += corregido(prompt);
  return { data: schema.parse(data) };
}

export async function runChat({ history, tools }) {
  await espera(100);
  const ultimo = history[history.length - 1]?.text || "";
  const contacto = ultimo.match(/[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{7,}\d/);
  const link = ultimo.match(/https?:\/\/\S+/);
  const tool = (n) => tools.find((t) => t.name === n);
  if (/humano|persona real|queja|reclamo/i.test(ultimo)) {
    await tool("derivar_a_humano").run({ motivo: "Pidió hablar con una persona (DEMO)", urgencia: "alta" });
    return { text: "Te paso con una persona del equipo; te escriben a la brevedad. (DEMO)" };
  }
  if (contacto) {
    const nombre = ultimo.match(/soy ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/i)?.[1] || "Contacto del chat";
    await tool("registrar_lead").run({ nombre: `${nombre} (DEMO)`, contacto: contacto[0].trim(), ...(link ? { link: link[0], marca: new URL(link[0]).hostname.split(".")[0].replace(/-/g, " ") } : {}), temperatura: "tibio" });
    if (link) await tool("solicitar_auditoria").run({ link: link[0] });
    return { text: `¡Gracias! Ya guardé tu contacto${link ? " y pedí la auditoría de tu tienda" : ""}. El equipo te escribe en 48 h hábiles. (DEMO)` };
  }
  return { text: "¡Hola! Soy el asistente de Kairos Creative (modo DEMO). Contame qué vendés y dónde, y te digo qué plan te conviene. Si querés que te contactemos, dejame tu email o WhatsApp." };
}
