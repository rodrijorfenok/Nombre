# Puesta en marcha

Hay tres formas de mostrar Mostrador, de menor a mayor esfuerzo. Conviene recorrerlas en orden.

## 0. Demo guiada: gratis, sin servidor ni IA

Es una página que reproduce conversaciones de ejemplo del local: el chat del cliente de un lado y el WhatsApp del encargado del otro. Precios, totales, tiempos, comandas, avisos y resumen de ventas salen del motor real; solo las frases libres del asistente están escritas en el guion.

1. Escribí las situaciones en `clientes/<local>/demo.json` (copiá el de `comidas-jn` y cambiá productos y textos).
2. `npm run demo-guiada -- <local>` → genera `docs/demo-guiada/<local>.html`.
3. Mandá el archivo por WhatsApp, o publicalo gratis con GitHub Pages (carpeta `/docs` del repositorio) o Netlify Drop.

Si cambian los precios, volvé a correr el comando y la página queda al día.

## A. Demo web en vivo: un link, sin Meta (5 minutos)

Una página igual a WhatsApp donde el dueño chatea con **su** bot desde el celular, como si fuera un cliente. En la pestaña **Cocina** ve en vivo cómo llegan la comanda y los avisos, y puede probar los comandos (`listo 1`, `r 1 hola`, `bot off`…). Solo necesita la clave de Claude.

1. Subí el bot a Railway (paso 2 de abajo). Para la demo alcanza con `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` y `DEMO_TOKEN`; no hacen falta las variables de WhatsApp.
2. Mandale al dueño el link: `https://TU-DOMINIO/demo/comidas-jn?t=TU_DEMO_TOKEN`.
3. Cada persona que abre el link tiene su propia prueba, aislada de las demás. El local figura abierto a cualquier hora. El límite es de 120 mensajes por persona, para que nadie gaste tus créditos.

Lo que vale la pena mostrarle en la demo:
- Pedir como se habla: "2 cuartos dobles sin cebolla, uno con coca y otro con sprite".
- Pedir algo que no se puede, como "agregale bacon a la hamburguesa", y ver cómo pasa a una persona y llega el aviso a la cocina.
- Escribir "quiero hablar con una persona".
- Cerrar un pedido con transferencia y mandar una captura con 📎 para que vea el control del comprobante.

## B. WhatsApp real

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
2. En el servicio: *Settings* → **Root Directory** = `mostrador` → en *Branch*, elegí `claude/peaceful-franklin-d2f27b`.
3. *Settings* → *Volumes* → **Add volume** con mount path `/data`. Ahí quedan los pedidos aunque reinicies.
4. *Settings* → *Networking* → **Generate Domain**. Te da algo como `https://astro-bot.up.railway.app`.
5. *Variables* → cargá:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | tu clave de console.anthropic.com |
| `CLAUDE_MODEL` | `claude-haiku-5-5` (el que viene por defecto: rápido y barato) |
| `CLAUDE_EFFORT` | `medium` |
| `WHATSAPP_APP_SECRET` | la clave secreta del paso 1.6 |
| `WHATSAPP_VERIFY_TOKEN` | una palabra que inventes, ej. `astro-demo-2026` |
| `ASTROBURGUER_WA_PHONE_ID` | el Phone number ID del paso 1.3 |
| `ASTROBURGUER_WA_TOKEN` | el token permanente del paso 1.5 |
| `ASTROBURGUER_PANEL_TOKEN` | otra palabra secreta para el panel |
| `PUBLIC_URL` | el dominio del paso 2.4 |
| `ASTROBURGUER_ENCARGADOS` | tu celular, ej. `11 3639 7582` (recibís avisos y podés mandar comandos). Varios, separados por coma |
| `ASTROBURGUER_COCINA` | el celular que recibe las comandas (puede ser el mismo) |

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
- **Comandos del local:** con tu número en `ASTROBURGUER_ENCARGADOS` y `ASTROBURGUER_COCINA` recibís las comandas y podés escribir `pedidos`, `precio doble 13900`, `agotado napo`… Los números se aceptan en cualquier formato (`11 3639 7582`, `+54 9 11 3639-7582`, con o sin 15).
- **Celulares argentinos y el número de prueba:** Meta a veces guarda tu celular sin el 9 y rechaza los envíos con el error 131030. El bot lo detecta y reintenta solo con la otra forma, así que no tenés que hacer nada.
- **Un mismo celular no puede ser cliente y encargado a la vez:** si tu número está como encargado, el bot interpreta tus mensajes que coincidan con un comando (`pedidos`, `listo 3`…) como comandos, y el resto como pedido normal. Para que la demo sea limpia, hacé de cliente con tu celular y poné como encargado otro número.

**Demo de Comidas JN:** la carta ya está cargada en `clientes/comidas-jn/`. Usá las variables `COMIDAS_JN_WA_PHONE_ID`, `COMIDAS_JN_WA_TOKEN`, `COMIDAS_JN_PANEL_TOKEN`, `COMIDAS_JN_ENCARGADOS` y `COMIDAS_JN_COCINA` en lugar de las de `ASTROBURGUER_` (el panel queda en `/panel/comidas-jn?token=...`). Para probarla en la terminal: `npm run chat -- comidas-jn`.

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

## Parar el bot

| Qué querés | Cómo |
|---|---|
| Que no responda a **nadie** (por ejemplo, si algo anda raro) | Escribile `bot off` al bot desde el celular del encargado. Los mensajes de los clientes te llegan a vos y contestás con `r N mensaje`. Para volver: `bot on` |
| Tomar vos **una** charla | `atender N` (N es el número de pedido). Para devolverla: `bot N` |
| Apagar todo del todo | En Railway, *Settings → Pause service* (o borrar el webhook en Meta) |

## Frenos automáticos: el bot se detiene solo

- **Si la IA se cae** (servicio caído, clave vencida, sin saldo): el cliente recibe "en un momento te responde alguien del local", su mensaje te llega a vos y nadie queda colgado. Si falla 3 veces seguidas, el bot entra en **modo seguro**: durante 5 minutos todo va directo al local, te avisa por WhatsApp y después reintenta solo.
- **Si no logra cargar un pedido** (4 intentos fallidos en un mismo mensaje), **si no sabe qué responder** o **si la IA se niega a contestar**: deriva a una persona en lugar de inventar.
- **Si el cliente pide una persona o se frustra** ("quiero hablar con alguien", "no entendés nada"): pasa a una persona al instante, sin consultar a la IA.
- **Lo que no puede salir mal:** precios, totales, envío, tiempos y validación de comprobantes los calcula el programa, no la IA. Además, antes de confirmar, el cliente ve el resumen y tiene que decir que sí.
- **Lo que el bot no detecta solo:** que entienda mal un producto y el cliente no se dé cuenta al ver el resumen. Para eso están el resumen obligatorio y la comanda que revisa la cocina.

## Para 200 pedidos por día

Para el servidor es poco tráfico: aun si 50 clientes escriben en el mismo minuto, todos reciben respuesta en pocos segundos y ningún pedido se pierde. Con más de 300 clientes simultáneos esperarían en fila unos 20 segundos, pero tampoco se perdería nada. No hace falta tocar `IA_EN_PARALELO`.

La base de datos se limpia sola: borra los chats de más de 14 días y los comprobantes de más de 90. Los pedidos se guardan siempre.

**Costo mensual estimado (unos 6.000 pedidos):**

| | **Haiku 5.5 (por defecto)** | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| IA (Claude) | **USD 15 a 40** | USD 250 a 450 | USD 500 a 900 |
| Servidor (Railway) | USD 5 a 10 | USD 5 a 10 | USD 5 a 10 |
| WhatsApp (Meta) | USD 0* | USD 0* | USD 0* |

\* Con la tarifa actual de Meta, responder a un cliente que escribió primero no tiene costo. Solo se pagan los mensajes que inicia el local, como campañas o promociones.

Mostrador viene con **Haiku 5.5**: es el más barato y rápido, y alcanza porque la parte delicada (precios, totales, tiempos, validación de pagos) la hace el programa, no la IA. Antes de lanzar un local, corré `npm run ensayo` y hacé unos 30 pedidos de prueba. Si algún caso sale mal, probá primero con `CLAUDE_EFFORT=high`, y si sigue fallando, con `CLAUDE_MODEL=claude-sonnet-5-5`.
