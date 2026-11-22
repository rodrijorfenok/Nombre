# Cambios

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
