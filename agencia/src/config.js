// Configuración central. Todo se lee de variables de entorno (ver .env.example).
export const config = {
  port: Number(process.env.PORT || 3000),
  // Modelo para todos los agentes. Se puede cambiar por agente con MODEL_<AGENTE>.
  model: process.env.ESCALA_MODEL || "claude-opus-5-5",
  // Modo demo: los agentes responden con datos simulados, sin llamar a la API.
  mock: process.env.ESCALA_MOCK === "1",
  adminToken: process.env.ADMIN_TOKEN || "",
  // Si un lead deja el link de su tienda, el Agente Auditor corre solo.
  autoAudit: process.env.AUTO_AUDIT !== "0",
  // Webhook opcional (Make, Zapier, n8n) que recibe cada lead y cada trabajo terminado.
  webhookUrl: process.env.WEBHOOK_URL || "",
  dataFile: process.env.DATA_FILE || new URL("../data/db.json", import.meta.url).pathname,
  agencia: {
    nombre: process.env.AGENCIA_NOMBRE || "Escalá Growth Studio",
    whatsapp: process.env.AGENCIA_WHATSAPP || "",
    email: process.env.AGENCIA_EMAIL || "",
  },
};
