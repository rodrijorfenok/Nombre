# 🍔 Bot de pedidos por WhatsApp para rotiserías y hamburgueserías

Atiende el WhatsApp del local como lo haría el mejor empleado del mostrador: entiende cómo escribe la gente, toma el pedido completo, calcula el total y el tiempo de espera, controla la transferencia y manda la comanda a cocina.

Un solo servidor atiende a **muchos locales**: cada uno tiene su carpeta en `clientes/`, con su menú, su número de WhatsApp, su base de datos y su panel.

## Qué lo diferencia de un bot común

- **No hay menús con números.** El cliente escribe como le sale ("2 dobles sin cebolla y una coca", "una muzza con piso") y el bot lo entiende a la primera.
- **No suena a robot.** Pide los datos que faltan juntos y de forma natural, confirma solo lo nuevo y no repite el pedido entero cada vez. Tiene tres tonos (`canchero`, `cordial`, `formal`) y nombre propio si el local quiere.
- **Responde al instante lo frecuente.** Saludo, carta, horario, dirección, alias y "¿cuánto falta?" salen en milisegundos y sin costo de IA, con frases que varían. Solo el armado del pedido usa IA.
- **Junta los mensajes seguidos.** Si el cliente manda "hola", "quiero 2 dobles" y "y una coca" en tres mensajes, el bot contesta una sola vez y con todo cargado.
- **Muestra "escribiendo…"** y marca los mensajes como leídos, como una persona.
- **No se equivoca con la plata.** Precios, totales, envío y tiempos los calcula el programa, nunca la IA.
- **El dueño no necesita técnico para el día a día.** Desde su WhatsApp escribe `precio doble 13900`, `agotado napo` o `hay napo`. Los pedidos ya cargados mantienen el precio con el que se tomaron.

## Funciones

| | |
|---|---|
| Pedido | Productos, opciones obligatorias (tamaño, carne, guarnición, bebida del combo), extras con costo, "sin X", observaciones por producto ("con piso", "bien cocida", "poca cebolla") y generales ("tocar timbre 2B") |
| Entrega | Delivery con dirección, entre calles, referencias y zona con su costo, o take away. Acepta ubicación compartida. Controla el pedido mínimo |
| Tiempo de espera | Preparación + volumen + cola de cocina + demora manual + viaje por zona → rango y hora aproximada |
| Pago | Transferencia (alias, CVU y titular) o efectivo con vuelto |
| Comprobantes | Lee la captura o el PDF y controla monto, destinatario, fecha, estado y número de operación repetido. Lo dudoso lo manda a revisión de un encargado |
| Cocina | Comanda por WhatsApp e imprimible en ticket de 80 mm |
| Seguimiento | listo / salió / entregado, con aviso automático al cliente |
| Horarios | Cierre después de medianoche, "abrimos mañana a las 19:30", cierre o apertura manual |
| Panel | Página web por local con los pedidos activos, botones y comprobantes |

## Comandos del local (desde un número de `equipo.encargados`)

```
pedidos                    pedidos activos
ver 12                     comanda del pedido 12
pago ok 12 / pago no 12    aprobar o rechazar la transferencia
listo 12 · sale 12 · entregado 12 · cancelar 12 motivo
precio doble orbita 13900  cambiar un precio (producto o extra; acepta apodos)
agotado napo / hay napo    marcar faltante o repuesto
carta                      precios y faltantes de hoy
demora 15                  +15 min a todos los tiempos (demora 0 = normal)
cerrar / abrir / auto      forzar cerrado, abierto o volver al horario
ayuda
```

## Sumar un local nuevo (unos 30 minutos)

```bash
npm run nuevo-local -- la-esquina "La Esquina Rotisería"
```

1. `clientes/la-esquina/negocio.json`: dirección, horarios, alias, CVU, **titular exacto de la cuenta** (con él se validan los comprobantes), zonas con barrios de referencia, números del equipo, tono y nombre del asistente, y datos sueltos (`datosExtra`: "todo casero", "tenemos opciones sin TACC").
2. `clientes/la-esquina/menu.json`: productos, precios, opciones, extras, combos y **apodos** (cómo la gente pide cada cosa: "napo", "muzza", "la de bacon"). Cuantos más apodos, mejor entiende.
3. Los secretos del local van en `.env` (`LA_ESQUINA_WA_PHONE_ID`, `LA_ESQUINA_WA_TOKEN`, `LA_ESQUINA_PANEL_TOKEN`).
4. Probalo en la terminal con `npm run chat -- la-esquina`, reiniciá el servidor y listo.

Si el local agrega un producto o un combo nuevo, se suma en `menu.json` y se reinicia. Las conversaciones que están en curso terminan con la carta anterior, sin cortarse.

## Instalación

```bash
npm install
cp .env.example .env        # ANTHROPIC_API_KEY y los secretos de cada local
npm run chat                # simulador en la terminal (/foto, /ubicacion, /staff ...)
npm start                   # servidor: webhook en /webhook, panel en /panel/<local>?token=...
```

Con Docker: `docker build -t bot-pedidos . && docker run -p 3000:3000 --env-file .env -v $PWD/data:/data bot-pedidos`.

**WhatsApp Business Cloud API (Meta):** creá una app en developers.facebook.com con el producto WhatsApp y registrá el número de cada local. El webhook es uno solo para todos (`https://tu-dominio/webhook`, campo `messages`). El bot sabe a qué local va cada mensaje por el número que lo recibió.

> ⚠️ **Ventana de 24 h:** Meta solo deja escribirle a un número que le escribió al bot en las últimas 24 h, salvo con plantillas aprobadas. Que cocina y encargados le manden "hola" al bot al empezar cada turno, o que usen el panel.

## Costos de IA (estimados, por pedido completo)

Cada pedido usa entre 5 y 10 llamadas a la IA, más la lectura del comprobante. Las instrucciones del bot (unos 5.000 tokens) quedan en caché, así que se pagan a una fracción del precio. Lo frecuente (saludo, carta, horario, estado) no usa IA.

| `CLAUDE_MODEL` | Costo aprox. por pedido | Cuándo |
|---|---|---|
| `claude-opus-5-5` (por defecto) | USD 0,10 a 0,15 | La mejor comprensión de pedidos enredados |
| `claude-sonnet-5-5` | USD 0,05 a 0,07 | Muy buena calidad a la mitad de precio |
| `claude-haiku-5-5` | menos de USD 0,01 | Lo más barato y rápido; conviene probarlo con pedidos reales del local |

Son estimaciones: medí el consumo real en la consola de Anthropic con los primeros pedidos de cada local.

## Límites honestos

- **Comprobantes:** el control es un filtro muy bueno, pero una captura se puede falsificar. Lo infalible es conectar la cuenta de Mercado Pago (ver ideas).
- **Zonas:** se eligen por barrio o referencia, sin mapa. Si no se puede determinar, deriva a una persona.
- **Audios:** no los procesa; le pide al cliente que escriba.

## Estructura

```
clientes/<local>/menu.json, negocio.json   ← lo único que se edita por local
clientes/_plantilla/                       ← base para locales nuevos
src/rapidas.ts      respuestas instantáneas sin IA (con variaciones y tonos)
src/prompt.ts       instrucciones y estilo del asistente
src/herramientas.ts herramientas de la IA (agregar, precios, entrega, pago, confirmar…)
src/order.ts        carrito, precios congelados por línea, totales, faltantes
src/catalogo.ts     precios y faltantes del día (cargados por WhatsApp)
src/tiempos.ts      tiempo de espera, horarios y próxima apertura
src/comprobantes.ts lectura del comprobante + reglas de validación
src/comanda.ts      comanda en texto y ticket imprimible
src/bot.ts          conversación, ráfagas, cola por cliente, avisos
src/staff.ts        comandos del local
src/whatsapp.ts     WhatsApp Cloud API
src/server.ts       servidor multi-local: webhook + paneles
```

```bash
npm test            # 21 pruebas: precios, tiempos, horarios, comprobantes, respuestas rápidas, comandos, flujo completo
npm run typecheck
```
