# Manual del encargado

Todo se maneja escribiéndole al bot desde **tu** WhatsApp, el que está cargado como encargado. Los mensajes de los clientes los contesta el bot; a vos te llegan las comandas, los avisos y lo que necesita una persona.

## Durante el turno

| Situación | Qué escribís |
|---|---|
| Ver los pedidos en curso | `pedidos` |
| Ver la comanda de un pedido | `ver 12` |
| El pedido está listo (take away: avisa al cliente que pase) | `listo 12` |
| Salió el delivery (avisa al cliente) | `sale 12` |
| Se entregó | `entregado 12` |
| Hay que cancelar (avisa al cliente) | `cancelar 12 no nos queda muzzarella` |
| La cocina está demorada | `demora 15` (suma 15 minutos a todos los tiempos). `demora 0` para volver a lo normal |

## Pagos

El bot revisa solo cada comprobante. Si está bien, el pedido pasa a cocina sin que hagas nada. Si tiene dudas, te llega un aviso **🔎 Revisar comprobante**:
- Fijate en la cuenta si entró la plata.
- Si entró: `pago ok 12`.
- Si no entró: `pago no 12 no nos llegó la transferencia`.

## Cuando el bot te pasa un cliente

Te llega un aviso **🙋 Te necesitan**, con el motivo y lo último que escribió el cliente. Desde ese momento el bot no le contesta más a ese cliente y todo lo que escriba te llega a vos.

- Para contestarle: `r 12 tu mensaje`. El cliente lo recibe desde el número del local.
- Cuando terminás: `bot 12`. El bot sigue la charla sabiendo lo que hablaron.
- Si no hacés nada en 30 minutos, el bot retoma solo.

Para tomar vos una charla aunque el bot no te la haya pasado: `atender 12`.

## Carta del día

| Situación | Qué escribís |
|---|---|
| Cambió un precio | `precio muzza 10000` (sirve con apodos: `precio jyq 15000`) |
| Se terminó algo | `agotado napo`. El bot deja de ofrecerlo |
| Volvió a haber | `hay napo` |
| Ver precios y faltantes de hoy | `carta` |

Si el nombre coincide con varios productos, el bot te pide que seas más específico.

## Horarios

| Situación | Qué escribís |
|---|---|
| Hoy abrimos aunque no sea un día habitual (feriado, evento) | `feriado` |
| Un feriado futuro | `feriado 14/6` · para quitarlo: `no feriado 14/6` |
| Cerrar ya (no toma pedidos nuevos) | `cerrar` |
| Abrir fuera de horario | `abrir` |
| Volver al horario normal | `auto` |

## Si algo anda raro

- `bot off`: el bot deja de responder a **todos** y los mensajes te llegan a vos. Contestás con `r N mensaje`.
- `bot on`: el bot vuelve a atender.
- `estado`: te dice si el bot está prendido o apagado.

Si la IA deja de funcionar, el bot se frena solo: te avisa **⚠️ modo seguro** y durante 5 minutos todos los mensajes te llegan a vos.

## Ventas

- Al cerrar te llega solo el resumen de la noche: pedidos, facturado, ticket promedio, delivery o take away, transferencia o efectivo, lo más pedido y la hora pico.
- Cuando quieras: `resumen`, `resumen ayer`, `resumen semana` o `resumen mes`.

## Panel de cocina

En la tablet o computadora de la cocina, abrí el link del panel que te pasaron. Muestra los pedidos activos, se actualiza solo y tiene botones para pago ok, listo, salió y entregado, más la impresión de la comanda.

`ayuda` te muestra todos los comandos en el WhatsApp.
