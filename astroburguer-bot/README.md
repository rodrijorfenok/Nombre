# 🚀 Astroburguer — bot de pedidos por WhatsApp

Atiende el WhatsApp del local, toma pedidos de hamburguesas, milanesas y pizzas (delivery o take away) y los deja listos para cocina.

## Qué hace

| Función | Cómo |
|---|---|
| Toma el pedido en lenguaje natural | Claude entiende el mensaje ("2 doble órbita sin cebolla y una muzza con piso") y lo carga con herramientas |
| Suma precios y da el total detallado | Lo calcula el código desde `config/menu.json`, nunca la IA. Incluye opciones, extras y envío por zona |
| Observaciones | "sin X" → ingrediente sacado; "menos cebolla", "con piso", "bien cocida" → observación por producto; "tocar timbre 2B" → observación general |
| Tiempo de espera | Preparación de la categoría más lenta + volumen + cola de pedidos en cocina + demora manual + viaje según la zona |
| Dirección | Pide calle, altura, entre calles, referencias y zona. Acepta ubicación compartida |
| Pago | Transferencia (manda alias, CVU y titular) o efectivo (calcula el vuelto) |
| Control de comprobantes | Lee la captura o PDF del comprobante y lo controla con reglas: monto ≥ total, destinatario = la cuenta del local, fecha reciente, operación no usada antes, estado aprobado. Lo dudoso pasa a revisión de una persona |
| Comanda | Al pagar (o al confirmar en efectivo) manda la comanda a cocina por WhatsApp y queda imprimible en ticket de 80 mm |
| Seguimiento | El local marca *listo / salió / entregado* y el cliente recibe el aviso |

## Probarlo en la terminal (sin WhatsApp)

```bash
cd astroburguer-bot
npm install
cp .env.example .env      # completá ANTHROPIC_API_KEY
npm run chat
```

En el simulador escribís como cliente. También podés usar `/foto ruta/al/comprobante.jpg`, `/ubicacion` y `/staff pedidos` (o cualquier otro comando del local).

## Ponerlo en producción

1. **Datos del local.** Editá `config/negocio.json`: dirección, horarios, alias, CVU, **titular exacto de la cuenta** (se usa para validar comprobantes), zonas de delivery con sus barrios de referencia y pedido mínimo.
2. **Menú.** Editá `config/menu.json`: precios, productos, opciones (tamaño, carne, guarnición) y extras. Con `"disponible": false` ocultás un producto sin borrarlo.
3. **WhatsApp Business Cloud API** (la API oficial de Meta):
   - Creá una app en developers.facebook.com, agregá el producto *WhatsApp* y registrá el número del local.
   - Copiá en `.env` el token permanente (`WHATSAPP_TOKEN`), el *Phone number ID*, el *App secret* y una palabra secreta inventada para `WHATSAPP_VERIFY_TOKEN`.
   - En *Webhooks*, poné la URL `https://tu-dominio/webhook` con esa misma palabra y suscribí el campo `messages`.
4. **Servidor.** Cualquier VPS o servicio que corra Node 22.13 o superior (Railway, Render, Fly.io, un VPS chico). `npm start`.
5. **Números del local.** En `STAFF_NUMBERS` van los encargados (reciben avisos y pueden dar comandos) y en `KITCHEN_NUMBERS` la cocina (recibe comandas).
6. **Panel.** `https://tu-dominio/panel?token=TU_PANEL_TOKEN` muestra los pedidos activos con botones (pago ok, listo, salió, entregado) e impresión de comandas. Dejalo abierto en la tablet o PC de la cocina.

> ⚠️ **Ventana de 24 h de WhatsApp.** Meta solo deja que el bot le escriba a un número que le haya escrito en las últimas 24 h, salvo que uses plantillas aprobadas. Que los números de cocina y encargados le manden "hola" al bot al empezar cada turno, o usá el panel, que no tiene esa limitación.

## Comandos del local (por WhatsApp desde un número de staff)

```
pedidos               lista de pedidos activos
ver 12                comanda del pedido 12
pago ok 12            aprobar transferencia → va a cocina
pago no 12 motivo     rechazar comprobante
listo 12              listo (take away: avisa al cliente que retire)
sale 12               salió el delivery
entregado 12          cerrar
cancelar 12 motivo    cancelar y avisar
demora 15             sumar 15 min a todos los tiempos (demora 0 = normal)
cerrar / abrir / auto forzar cerrado, abierto o volver al horario
```

## Estados del pedido

`armando` → (transferencia) `esperando_pago` → `pago_en_revision`? → `en_cocina` → `listo` → `en_camino` → `entregado`
(en efectivo pasa directo de `armando` a `en_cocina`). Si querés que la comanda salga antes de que llegue el pago, poné `"comandaAntesDelPago": true`.

## Límites a tener en cuenta

- **El control de comprobantes es un filtro, no una prueba.** Una captura se puede falsificar. El bot frena los errores comunes (monto corto, otra cuenta, comprobante viejo o repetido), pero lo único infalible es mirar que la plata haya entrado. Se puede sumar más adelante una consulta automática a la API de Mercado Pago.
- **Zonas.** El bot no geolocaliza. Elige la zona según la referencia escrita en `negocio.json` o le pregunta al cliente. Si no puede, deriva a una persona.
- **Audios.** No los procesa: le pide al cliente que escriba.

## Cómo está armado

```
config/menu.json, negocio.json   ← lo que edita el dueño
src/order.ts       carrito, precios, totales, faltantes
src/tiempos.ts     tiempo de espera y horarios (cruza medianoche)
src/comprobantes.ts lectura del comprobante (Claude) + reglas de validación
src/comanda.ts     comanda en texto y HTML imprimible
src/herramientas.ts herramientas que usa la IA (agregar, entrega, pago, confirmar…)
src/prompt.ts      instrucciones del asistente
src/bot.ts         conversación, cola por cliente, efectos (comanda, avisos)
src/staff.ts       comandos del local
src/whatsapp.ts    WhatsApp Cloud API (envío, media, firma del webhook)
src/server.ts      webhook + panel
src/cli.ts         simulador en terminal
```

La IA solo entiende y conversa. Precios, totales, tiempos, validación de pagos y comandas los resuelve el código, así que no puede "inventar" un precio. El modelo y el esfuerzo se cambian en `.env` (`CLAUDE_MODEL`, `CLAUDE_EFFORT`).

```bash
npm test          # pruebas (precios, tiempos, horarios, comprobantes, flujo completo)
npm run typecheck
```
