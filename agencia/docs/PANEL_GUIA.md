# Guía del panel en claude.ai

El panel (`claude-panel/index.html`) es donde se trabaja todos los días. No necesita servidor ni API key:
guarda los datos en tu cuenta de Claude y los agentes usan tu suscripción.

## Antes del primer cliente (una sola vez)

1. **Datos de la agencia:** nombre, contacto, precios, horario, WhatsApp para recibir avisos, costo por
   hora y extras del cotizador. Los extras que trae son **de ejemplo**: cambialos por los tuyos.
2. **Política de devolución:** cargá el texto oficial. Hacela revisar por un abogado o contador junto con
   el contrato y recién entonces marcá "Revisión legal". Mientras no esté marcada, el panel avisa en cada
   propuesta y documento legal.
3. **Navegador de Claude:** en Datos de la agencia, tocá "Probar el navegador" desde la **app de
   escritorio**. Si falla, los agentes trabajan con lo que cargues (capturas, textos, números).
4. **Caso de práctica:** en Casos, "+ Caso de práctica". Corré los pasos 1 a 5, revisá las entregas,
   aprobá o pedí cambios. No cuenta para Mi día, cobros ni números comerciales.
5. **Copia de seguridad:** descargá la primera copia y verificala con "Elegir una copia…".

## Pantallas

| Pantalla | Para qué |
|---|---|
| **Mi día** | El plan de la jornada según el horario. Tocá "Empezar" en cada tarea y marcala al terminar: así se mide el tiempo real. Con 3 o más registros de un tipo de tarea, el plan usa el promedio real. Al final del día, "Resumen de cierre" arma lo hecho y lo pendiente y lo podés mandar por WhatsApp. |
| **Casos** | El estado de cada cliente, las alertas y los casos **para escalar** (próximo paso vencido hace más de N días). "Mandarme las alertas por WhatsApp" arma el mensaje. |
| **Caso** (dentro del cliente) | Etapa, responsable, próximo paso, bitácora y asistente. Cambiar de responsable pide una **nota de traspaso** (el asistente la puede redactar). Pasar a Baja pide el **motivo**. "Informe de estado para el cliente" descarga un Word sin notas internas. |
| **Ficha** | Brief, arranque, números de partida y **evolución mensual** (a mano o pegando un CSV exportado de la tienda, GA4 o Meta). Los agentes usan los últimos 6 meses. |
| **Entregas** | Aprobar, editar, pedir cambios, descargar en Word. Cuando se envía, registrar si **el cliente la aprobó o pidió cambios**. Si no responde en N días, aparece en Mi día para recordárselo. |
| **Comercial** | Embudo (prospecto, propuesta, ganados, perdidos), tasa de cierre, origen de los clientes, motivos de pérdida y **cotizador**. La cotización se pasa a la propuesta con los montos exactos. |
| **Cobros** | Honorario y día de cobro por cliente, pagos del mes, vencidos y **margen** (honorario menos horas medidas por el costo por hora). Un cobro vencido aparece en Mi día y como alerta del caso. |
| **Calidad** | Por agente: puntaje, aprobadas a la primera, cambios pedidos y coincidencia entre el control automático y el equipo. "Proponer con Claude" analiza los pedidos repetidos y sugiere una instrucción; "Probar en la última entrega" la prueba en una versión marcada como prueba, para compararla antes de guardarla. |
| **Datos de la agencia** | Configuración, copia de seguridad (descargar, verificar, restaurar) y prueba del navegador. |

## Lo que el panel no puede hacer

- **Avisos automáticos al celular:** el panel no puede mandar notificaciones solo. Los botones de
  WhatsApp arman el mensaje y lo abren listo para enviar.
- **Conectarse solo a la tienda o a Meta de cada cliente:** las métricas se cargan a mano o pegando un CSV.
- **Revisión legal:** la política y el contrato los tiene que revisar un profesional.
