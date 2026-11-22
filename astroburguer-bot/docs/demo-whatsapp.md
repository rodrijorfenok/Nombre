# Conectar WhatsApp para la demo

Se tarda unos 40 minutos la primera vez. Para la demo usamos el **número de prueba gratis que da Meta**: tu WhatsApp personal sigue igual y hace de "cliente".

> ⚠️ No conectes tu número personal a la API: un número que se registra en la API de WhatsApp Business deja de funcionar en la app de WhatsApp de ese teléfono. Para cada local en producción, usá un número propio del local (un chip nuevo o el fijo del negocio).

## 1. Crear la app en Meta (15 min)

1. Entrá a **developers.facebook.com** → *Mis apps* → *Crear app* → tipo **Empresa** (Business). Si te lo pide, creá o elegí un portfolio comercial.
2. En la app, agregá el producto **WhatsApp** → *Configuración de la API*.
3. Ahí ves un **número de prueba** de Meta y su **Phone number ID**. Copiá ese ID.
4. En *Para*, agregá tu celular personal y verificalo con el código que te llega. Hasta 5 números pueden escribirle al número de prueba: el tuyo y el de quien vea la demo.
5. **Token permanente** (el temporal vence en 24 h):
   - business.facebook.com → *Configuración* → *Usuarios del sistema* → *Agregar* (rol administrador).
   - *Asignar activos* → tu app → control total.
   - *Generar token* → elegí la app y los permisos `whatsapp_business_messaging` y `whatsapp_business_management` → vencimiento **Nunca**. Copiá el token.
6. En la app: *Configuración de la app* → *Básica* → copiá la **Clave secreta de la app** (App secret).

## 2. Subir el bot a internet (10 min) — Railway

1. Entrá a **railway.com** con tu cuenta de GitHub → *New Project* → *Deploy from GitHub repo* → elegí `Nombre`.
2. En el servicio: *Settings* → **Root Directory** = `astroburguer-bot` → en *Branch*, elegí `claude/peaceful-franklin-d2f27b`.
3. *Settings* → *Volumes* → **Add volume** con mount path `/data`. Ahí quedan los pedidos aunque reinicies.
4. *Settings* → *Networking* → **Generate Domain**. Te da algo como `https://astro-bot.up.railway.app`.
5. *Variables* → cargá:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | tu clave de console.anthropic.com |
| `CLAUDE_MODEL` | `claude-opus-5-5` (o `claude-haiku-5-5` para más velocidad y menos costo) |
| `CLAUDE_EFFORT` | `low` |
| `WHATSAPP_APP_SECRET` | la clave secreta del paso 1.6 |
| `WHATSAPP_VERIFY_TOKEN` | una palabra que inventes, ej. `astro-demo-2026` |
| `ASTROBURGUER_WA_PHONE_ID` | el Phone number ID del paso 1.3 |
| `ASTROBURGUER_WA_TOKEN` | el token permanente del paso 1.5 |
| `ASTROBURGUER_PANEL_TOKEN` | otra palabra secreta para el panel |
| `PUBLIC_URL` | el dominio del paso 2.4 |

6. Esperá el deploy y abrí `https://TU-DOMINIO/salud`: tiene que decir `"ok": true` y `"locales": ["astroburguer"]`.

> Dejá **una sola réplica**: los pedidos se guardan en el disco del servicio. Una instancia aguanta cientos de clientes a la vez (ver la prueba de carga más abajo).

**Sin Railway, desde tu PC:** `npm start` y, en otra terminal, `npx cloudflared tunnel --url http://localhost:3000`. Te da una URL https temporal que se usa igual que el dominio. Sirve para probar, pero si apagás la PC el bot se corta.

## 3. Conectar el webhook (5 min)

1. En Meta: *WhatsApp* → *Configuración* → **Webhook** → *Editar*.
   - URL de devolución de llamada: `https://TU-DOMINIO/webhook`
   - Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN`
2. *Verificar y guardar*, y en *Campos del webhook* suscribí **messages**.

## 4. Probar

Desde tu celular, escribile al número de prueba: "hola", "me pasás la carta?", "quiero 2 doble órbita sin cebolla y una coca zero"… Seguí hasta confirmar.

- **Panel de cocina:** `https://TU-DOMINIO/panel/astroburguer?token=TU_PANEL_TOKEN`
- **Comandos del local:** agregá tu número en `clientes/astroburguer/negocio.json` → `equipo.encargados` y `equipo.cocina`, sin `+` (ej. `5491155554444`). Así recibís las comandas y podés escribir `pedidos`, `precio doble 13900`, `agotado napo`…

Para la demo con el cliente, poné su nombre, su carta y su alias en `clientes/astroburguer/` (o creá su carpeta con `npm run nuevo-local`), así ve **su** local funcionando.

## 5. n8n o Make (opcional, para sumar cosas)

El bot ya toma los pedidos solo. n8n o Make sirven para **conectar lo que pasa después**: anotar cada pedido en una planilla, mandar un mail o avisar en otro sistema.

1. En n8n, creá un flujo con un nodo **Webhook** (método POST) y copiá su URL de producción. En Make: *Webhooks → Custom webhook*.
2. En `negocio.json` del local: `"integraciones": { "webhookPedidos": "https://tu-n8n/webhook/pedidos" }`.
3. Cada vez que un pedido cambia de estado (confirmado, en cocina, listo, en camino, entregado, cancelado) el bot manda un JSON así:

```json
{
  "evento": "pedido.estado",
  "local": "astroburguer",
  "estado": "en_cocina",
  "estadoAnterior": "esperando_pago",
  "pedido": {
    "id": 12, "cliente": "Lucía", "telefono": "5491122223333",
    "entrega": "delivery", "direccion": "Mitre 1234", "zona": "Zona 1", "pago": "transferencia", "pagoVerificado": true,
    "items": [{ "cantidad": 2, "producto": "Doble Órbita", "opciones": [], "extras": ["Huevo frito"], "sin": ["cebolla caramelizada"], "observacion": "", "subtotal": 27600 }],
    "subtotal": 37600, "envio": 1500, "total": 39100, "horaEstimada": "2026-11-22T00:40:00.000Z"
  }
}
```

4. Detrás del webhook agregá lo que quieras: *Google Sheets → Append row* para tener la planilla de ventas, *Gmail* para un resumen, etc.

¿Por qué no armar todo el bot en n8n o Make? Cada mensaje pasaría por un servicio más, así que es más lento. En Make, además, se paga por operación y un pedido usa decenas. Y con muchos clientes a la vez es fácil que se mezclen conversaciones o se pierdan mensajes. El bot ya resuelve todo eso.

## Prueba de carga

```bash
npm run carga -- 300 1500
```

Simula 300 clientes pidiendo a la vez, con una IA de mentira que tarda 1,5 s como la real (no gasta créditos). Verifica que cada uno tenga su pedido correcto.

Resultados medidos:
- 50 clientes a la vez: los 50 pedidos correctos, espera mediana de 4,5 s por mensaje (incluye 1,5 s que el bot espera para juntar mensajes seguidos).
- 300 clientes a la vez con `IA_EN_PARALELO=200`: los 300 correctos, espera mediana de 4,7 s.

El único límite es cuántas consultas a la IA en paralelo admite tu cuenta de Anthropic (`IA_EN_PARALELO`). Si se llena, los mensajes esperan en fila, no se pierden. Con 40, que es el valor por defecto, 300 clientes simultáneos también salen todos bien, pero esperan unos 20 s.
