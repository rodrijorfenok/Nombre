# Alta de un local nuevo

Lleva entre 1 y 2 horas, la mayor parte esperando datos del cliente.

## 1. Lo que hay que pedirle al local

**Datos del negocio**
- [ ] Nombre comercial y rubro
- [ ] Dirección con entre calles, y la ubicación en Google Maps (mantener apretado sobre el local y copiar los dos números)
- [ ] Días y horarios de atención, y si abren los feriados
- [ ] Tono: canchero, cordial o formal; si el asistente tiene nombre propio

**Carta**
- [ ] Fotos o PDF de la carta con precios, promos y combos
- [ ] Qué incluye cada combo (papas, bebida, cuál bebida)
- [ ] Opciones de cada producto (tamaños, sabores, guarniciones)
- [ ] Agregados con costo y a qué productos se pueden sumar
- [ ] Cómo le dicen los clientes a cada producto ("napo", "jyq", "la de la casa")

**Pagos**
- [ ] Alias, CVU y **nombre exacto del titular** de la cuenta
- [ ] ¿Aceptan efectivo?
- [ ] ¿La comanda sale antes o después de confirmar la transferencia?

**Delivery**
- [ ] Zonas o distancia máxima, costo de envío por zona y pedido mínimo
- [ ] Cuántos repartidores tienen y en qué vehículo

**Reglas del local**
- [ ] Qué casos tiene que atender una persona (por ejemplo, "agregados en hamburguesas")
- [ ] Celulares del encargado y de la cocina

**WhatsApp**
- [ ] Un número para el bot que **no** esté en uso en la app de WhatsApp (chip nuevo o línea del negocio)

## 2. Cargar el local

```bash
npm run nuevo-local -- la-esquina "La Esquina Rotisería"
```

1. Completá `clientes/la-esquina/negocio.json` y `menu.json` con los datos de arriba. Usá la carta de `comidas-jn` como referencia de formato.
2. Revisá con `npm run validar -- la-esquina` hasta que no queden errores, y resolvé las advertencias.
3. Probá en la terminal con `npm run chat -- la-esquina`: pedidos típicos, pedidos raros, "quiero hablar con alguien".

## 3. Mostrárselo al dueño

1. Copiá `clientes/comidas-jn/demo.json` a la carpeta del local nuevo y adaptá productos y frases.
2. Generá la página con `npm run demo-guiada -- la-esquina` y mandásela.
3. Si quiere probar él mismo, pasale el link de la demo en vivo: `https://TU-DOMINIO/demo/la-esquina?t=DEMO_TOKEN`.

## 4. Ponerlo en marcha

1. En Meta: registrá el número del local en la app de WhatsApp y generá su token (ver [Puesta en marcha](puesta-en-marcha.md)).
2. En Railway, agregá las variables `LA_ESQUINA_WA_PHONE_ID`, `LA_ESQUINA_WA_TOKEN`, `LA_ESQUINA_PANEL_TOKEN`, `LA_ESQUINA_ENCARGADOS` y `LA_ESQUINA_COCINA`.
3. Subí los cambios a GitHub: Railway redespliega solo.
4. Abrí `/salud` y fijate que el local aparezca en la lista.
5. Si tenés la clave de Claude cargada, corré `npm run ensayo -- la-esquina` (agregá antes sus casos en `scripts/ensayo.ts`).
6. Hacé un pedido real de punta a punta con el dueño: pedido, comprobante, comanda, `sale`, `entregado`.
7. Pasale al encargado el [Manual del encargado](manual-encargado.md) y el link del panel.

## 5. La primera semana

- Mirá los resúmenes de cada noche y preguntale al encargado qué derivaciones le llegaron.
- Si un mismo pedido especial se repite, sumalo a la carta o a `datosExtra`.
- Si el bot deriva cosas que podría resolver, ajustá `derivarCuando`.
