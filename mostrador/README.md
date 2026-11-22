# Mostrador

**Bot de pedidos por WhatsApp para rotiserías, pizzerías y hamburgueserías.**

Mostrador atiende el WhatsApp del local como el mejor empleado del mostrador. Entiende cómo escribe la gente, arma el pedido sin errores, calcula total, envío y tiempo de espera, controla la transferencia y manda la comanda a la cocina. Cuando algo no le corresponde, se lo pasa a una persona.

Un solo servidor atiende a muchos locales: cada uno tiene su carta, su número, su base de datos y su panel.

---

## Qué resuelve

| Para el cliente del local | Para el dueño |
|---|---|
| Pide como habla ("2 cuartos dobles, uno sin cebolla, uno con coca y otro con sprite") y el bot entiende a la primera | No pierde pedidos por no contestar a tiempo, aunque escriban 50 personas juntas |
| Respuesta inmediata a lo frecuente: carta, horarios, dirección, alias, "¿cuánto falta?" | Comandas claras en la cocina, con "sin cebolla", "con piso" y observaciones bien marcadas |
| Resumen claro antes de confirmar, con total y hora de llegada | Control de transferencias: monto, cuenta destino, fecha y comprobantes repetidos |
| Si quiere hablar con alguien, lo atienden | Cambia precios y faltantes desde su WhatsApp (`precio muzza 10000`, `agotado napo`) |
| | Recibe las ventas de la noche al cerrar, sin pedirlas |

## Cómo funciona

```
Cliente (WhatsApp) ──► Meta Cloud API ──► /webhook ──► Bandeja durable (SQLite)
                                                             │
                     ┌───────────────────────────────────────┤
                     ▼                                       ▼
          Respuestas rápidas (sin IA)            Asistente con IA (Claude)
          saludo, carta, horario,                entiende el pedido y usa herramientas:
          dirección, alias, estado               agregar, entrega, pago, confirmar…
                     │                                       │
                     └──────────────► Motor de pedidos ◄─────┘
                                      precios, totales, envío, tiempos,
                                      horarios, comprobantes (todo determinista)
                                             │
                     ┌───────────────────────┼────────────────────────┐
                     ▼                       ▼                        ▼
              Respuesta al cliente    Comanda a cocina         Avisos al encargado
                                      (WhatsApp + panel)       (derivaciones, pagos, resumen)
```

**Una regla de diseño:** la IA solo conversa y decide qué herramienta usar. Precios, totales, envío, tiempos, horarios y la validación de comprobantes los calcula el código. Por eso el bot no puede inventar un precio ni equivocarse en una cuenta.

## Funciones

**Pedidos**
- Productos con opciones obligatorias (tamaño, bebida, variedad, pizza de la promo), agregados con costo, ingredientes quitados y observaciones por producto o generales.
- Apodos por producto ("muzza", "jyq", "comen 2"), para el bot y para los comandos del local.
- Precio congelado al cargar: si el local cambia un precio, los pedidos en curso no cambian.
- Combos y promos con detalle para la cocina ("1 muzzarella + 1 jamón y morrón").

**Entrega y tiempos**
- Delivery por zonas, con distancia en cuadras y costo; calcula la zona sola si el cliente comparte su ubicación. Take away. Pedido mínimo.
- Tiempo estimado según lo más lento del pedido, el volumen, la cola de cocina, la demora que cargue el local y el viaje.
- Horarios que cruzan la medianoche, feriados y apertura o cierre manual.

**Pagos**
- Transferencia con alias, CVU y titular, o efectivo con cálculo del vuelto.
- Lectura del comprobante (captura o PDF) con reglas firmes: monto, destinatario, fecha, estado y número de operación ya usado. Lo dudoso pasa a revisión de una persona.

**Conversación**
- Tres tonos (canchero, cordial, formal) y nombre propio opcional.
- Junta los mensajes seguidos en una sola respuesta, muestra "escribiendo…" y marca como leído.
- Respuestas instantáneas sin IA y con variaciones para lo frecuente.

**Atención humana y frenos automáticos**
- Deriva a una persona ante reclamos, alergias, pedidos especiales, dudas, o cuando el cliente lo pide. El encargado contesta con `r N mensaje` y lo devuelve con `bot N`.
- Si la IA falla, el cliente pasa a una persona y nadie queda sin respuesta. Con 3 fallas seguidas entra en modo seguro durante 5 minutos.
- `bot off` apaga el bot para todos y `bot on` lo prende.

**Operación**
- Panel web por local con los pedidos activos, botones e impresión de comandas en ticket de 80 mm.
- Resumen de ventas automático al cerrar y a pedido (`resumen`, `resumen semana`).
- Aviso a n8n, Make o una planilla en cada cambio de estado de un pedido.
- Bandeja durable: ningún mensaje se pierde si el servidor se reinicia. Deduplica los reintentos de Meta.
- Límite de consultas simultáneas a la IA, reintentos con espera y apagado prolijo.
- Limpieza automática de chats y comprobantes viejos.

## Empezar

```bash
cd mostrador
npm install
cp .env.example .env            # completá ANTHROPIC_API_KEY
npm run validar                 # revisa la configuración de los locales
npm run chat -- comidas-jn      # simulador en la terminal
npm start                       # servidor: /webhook, /panel/<local>, /demo/<local>
```

Requiere Node 22.13 o superior. Con Docker: `docker build -t mostrador . && docker run -p 3000:3000 --env-file .env -v $PWD/data:/data mostrador`.

## Documentación

| Documento | Para quién |
|---|---|
| [Puesta en marcha](docs/puesta-en-marcha.md) | Vos: demo guiada, demo en vivo, WhatsApp real, Railway, n8n/Make, carga, costos |
| [Alta de un local nuevo](docs/alta-de-local.md) | Vos: qué pedirle al cliente y cómo dejarlo andando |
| [Manual del encargado](docs/manual-encargado.md) | El personal del local: comandos y qué hacer en cada caso |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor multi-local |
| `npm run chat -- <local>` | Simulador en la terminal (`/foto`, `/ubicacion`, `/staff …`) |
| `npm run validar [-- <local>]` | Revisa la configuración: datos sin completar, apodos ambiguos, variables faltantes |
| `npm run nuevo-local -- <slug> "Nombre"` | Crea un local desde la plantilla |
| `npm run demo-guiada -- <local>` | Genera la página de demo gratis a partir de `demo.json` |
| `npm run ensayo [-- <local>]` | Simula clientes contra la IA real y verifica los pedidos (gasta centavos) |
| `npm run carga -- 300 1500` | Prueba de carga con IA simulada: 300 clientes a la vez |
| `npm run check` | Revisión de tipos + pruebas (lo mismo que corre GitHub en cada cambio) |

## Configuración de un local

Cada local es una carpeta en `clientes/`:

```
clientes/comidas-jn/
├── negocio.json   datos, horarios, feriados, pagos, zonas, tono, reglas para derivar, equipo
├── menu.json      categorías, productos, opciones, agregados, apodos, detalle para cocina
└── demo.json      situaciones de la demo guiada (opcional)
```

Los secretos nunca van en estos archivos. Se escriben como `"env:NOMBRE_VARIABLE"` y se cargan en el servidor (por ejemplo, en Railway). La carpeta `_plantilla` es la base para locales nuevos.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de Claude |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | Modelo (`claude-haiku-5-5` por defecto; `claude-sonnet-5-5` o `claude-opus-5-5` si hace falta más capacidad) y esfuerzo (`medium` por defecto) |
| `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` | Firma y verificación del webhook de Meta (obligatorio en producción) |
| `<LOCAL>_WA_PHONE_ID`, `<LOCAL>_WA_TOKEN` | Número de WhatsApp de cada local |
| `<LOCAL>_PANEL_TOKEN` | Clave del panel de cocina |
| `<LOCAL>_ENCARGADOS`, `<LOCAL>_COCINA` | Celulares del equipo, separados por coma, en cualquier formato |
| `DEMO_TOKEN` | Clave de los links de demo en vivo |
| `PUBLIC_URL`, `PORT`, `DATA_DIR` | Servidor |
| `IA_EN_PARALELO`, `ESPERA_RAFAGA_MS` | Capacidad y espera para juntar mensajes seguidos |

## Costos estimados (200 pedidos por día)

| | **Haiku 5.5 (por defecto)** | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| IA por mes | **USD 15 a 40** | USD 250 a 450 | USD 500 a 900 |
| Servidor | USD 5 a 10 | USD 5 a 10 | USD 5 a 10 |
| WhatsApp | USD 0 | USD 0 | USD 0 |

Son estimaciones. Medí el consumo real con los primeros pedidos. Antes de cambiar de modelo, corré `npm run ensayo` con el modelo nuevo y revisá los resultados.

## Límites conocidos

- **Comprobantes:** el control es un filtro, no una prueba bancaria; una captura se puede falsificar. Lo infalible es confirmar el ingreso en la cuenta (conexión con Mercado Pago, pendiente).
- **Zonas:** sin la ubicación del local en `negocio.json`, la zona se elige por cuadras que dice el cliente.
- **Audios:** no los procesa; le pide al cliente que escriba.
- **Una sola instancia:** el servidor guarda en SQLite y debe correr con una réplica. Aguanta cientos de clientes simultáneos.

## Estructura del código

```
src/
  server.ts        servidor multi-local: webhook, bandeja durable, paneles, demo, apagado prolijo
  bot.ts           conversación, ráfagas, cola por cliente, atención humana, frenos, reportes
  rapidas.ts       respuestas instantáneas sin IA
  prompt.ts        instrucciones del asistente
  herramientas.ts  herramientas de la IA
  order.ts         carrito, precios, totales, faltantes
  catalogo.ts      precios y faltantes del día
  tiempos.ts       tiempos de espera, horarios, feriados
  comprobantes.ts  lectura y validación de comprobantes
  comanda.ts       comanda en texto y ticket imprimible
  reportes.ts      resumen de ventas por jornada
  staff.ts         comandos del local
  whatsapp.ts      WhatsApp Cloud API
  telefonos.ts     números argentinos
  integraciones.ts aviso a n8n/Make
  demo.ts          demo web en vivo
scripts/           validar, nuevo-local, demo-guiada, ensayo, carga
test/              pruebas automáticas
```

---

Uso privado. Todos los derechos reservados.
