# Cambios

## 1.3.0

- Panel de cocina nuevo: se actualiza solo cada 5 segundos sin recargar, columnas por estado, reloj con colores contra la hora que la cocina tiene que cumplir, ítems con los "sin" y cambios resaltados, sonido y vibración con cada pedido nuevo, pantalla siempre prendida, responder al cliente y devolverlo al bot, stock del día con un toque, abrir/cerrar, demora ±5, bot on/off y números del día. La impresión automática sigue igual (botón 🖨️ Auto).
- Comanda nueva: arriba el número, el modo y la hora objetivo (en delivery "SALE 21:30 · LLEGA 21:40"); unidades totales; primera vez o número de pedido del cliente; "NO COBRAR: ya está pago" o "PAGO SIN CONFIRMAR"; link a Maps y, en el ticket impreso, un QR con la dirección para el repartidor; "sin" y cambios en recuadro.
- Clientes que vuelven: el bot recuerda nombre, última dirección y último pedido; los saluda por el nombre y entiende "lo de siempre" (`repetir_pedido_anterior`).
- Pedidos programados ("para las 22") y anticipados con el local cerrado (`programar_pedido`).
- Recordatorio automático de pago a los 10 minutos y aviso al encargado si sigue sin pagar.
- Aviso de pedido atrasado y comando `demorado N M` (le pide disculpas al cliente con la nueva hora).
- Nota del 1 al 5 al entregar; las bajas pasan a una persona. El resumen suma la nota, el tiempo real de cocina, el % a tiempo y los clientes que volvieron.
- Los pedidos que quedan abiertos de un turno anterior se cierran solos (ya no inflan la demora ni frenan el resumen).
- Comandos más seguros: `listo`, `sale`, `entregado` y `cancelar` controlan el estado (por ejemplo, no se avisa "salió" de un pedido take away ni "gracias" de uno cancelado).
- `delivery.ciudad` en `negocio.json` para que el mapa del repartidor no busque la calle en otra ciudad.

## 1.2.0

- Cambio de ingredientes: "la super americana con cebolla brunoise en vez de caramelizada" queda como cambio sin costo, en el resumen y en la comanda (🔁 CAMBIAR). Solo se puede poner un ingrediente que el local ya usa.
- Pago mixto: una parte en efectivo y el resto por transferencia. El comprobante se controla contra la parte transferida y la comanda dice cuánto cobrar en efectivo.
- Sumar a un pedido en cocina: dentro de los 10 minutos desde que entró (`cocina.minutosParaAgregar`), el cliente puede sumar productos. Cocina recibe una comanda aparte ("AGREGADO 1 AL PEDIDO #N, sale junto"), la hora se corre y se cobra el resto en efectivo o por transferencia.
- Aviso de 5 minutos: botón "⏰ faltan 5 min" en el panel y comando `aviso N` (también desde el teléfono de cocina): le avisa al cliente que ya puede venir a retirar o que el delivery está por salir.
- Teléfonos de cocina: pueden usar `pedidos`, `ver N`, `aviso N`, `listo N` y `sale N`.
- Aprender de chats viejos: `npm run analizar-chats -- carpeta` lee chats exportados de WhatsApp, los anonimiza y saca casos "situación → cómo lo resolvió el local"; con `--aplicar <local>` los suma a `asistente.casos` y el bot responde con esa idea cuando pasa algo parecido.

## 1.1.0

- Haiku 5.5 como modelo por defecto, con esfuerzo `medium`.
- Ensayo con IA real ampliado a 12 situaciones (pedido ambiguo, cambio de idea, bebida suelta, reclamo, alergia, fuera de zona) con medición de costo. Resultado con Haiku 5.5: 29/29.
- Pagos en varias transferencias: un comprobante válido pero corto queda como pago parcial y se suma con los siguientes.
- `npm run probar-comprobante` para probar comprobantes reales con la IA.
- Tono: siempre de vos y sin modismos de otros países.

## 1.0.0

Primera versión completa.

- Pedidos por WhatsApp con IA: opciones, agregados, ingredientes quitados, observaciones, apodos, combos y promos con detalle para cocina.
- Respuestas instantáneas sin IA para saludo, carta, horario, dirección, alias y estado del pedido.
- Delivery por zonas en cuadras (con cálculo por ubicación), take away, pedido mínimo y tiempo estimado según la carga de la cocina.
- Horarios que cruzan la medianoche, feriados y apertura o cierre manual.
- Transferencias con lectura y validación de comprobantes; efectivo con vuelto.
- Comandas por WhatsApp y en ticket imprimible; panel web por local.
- Atención humana: derivaciones, `r N` / `bot N`, `atender N`, `bot off` / `bot on`.
- Frenos automáticos: errores de la IA, pedidos que no se pueden cargar y pedido de persona.
- Comandos del local para precios, faltantes, feriados, demora y estados.
- Resumen de ventas por jornada, automático al cerrar y a pedido.
- Multi-local, bandeja durable, límite de IA en paralelo, reintentos, apagado prolijo y limpieza automática.
- Demo web en vivo, demo guiada estática, ensayo con IA real, validador de configuración, prueba de carga e integración continua.
