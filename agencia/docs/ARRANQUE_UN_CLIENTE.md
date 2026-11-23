# Arranque con un cliente

El sistema está preparado para 20 clientes, pero funciona igual con uno. No hay que cambiar código:
solo configurar lo justo, poner en marcha al cliente y usar el resto de la capacidad para conseguir el
segundo.

## 1. Configuración recomendada (`.env`)

```
ANTHROPIC_API_KEY=...            # obligatorio
ADMIN_TOKEN=una-clave-larga      # obligatorio
PRESUPUESTO_DIARIO_USD=5         # sobra para un cliente y los leads del sitio
MAX_JOBS=2
AUTO_AUDIT=1                     # los leads que dejan su tienda reciben auditoría automática
AGENCIA_WHATSAPP=+54 9 ...       # el chat del sitio lo comparte
AGENCIA_EMAIL=...
INGESTA_TOKEN=otra-clave         # solo si vas a conectar Make/Zapier para las métricas
```

Hosting: cualquier servicio con disco persistente alcanza (Railway, Render o un VPS chico, desde unos
5 USD por mes). Costo de IA esperado: **5 a 15 USD por mes** entre el cliente y los leads del sitio.

**Dónde va la API key:** en tu computadora, en el archivo `.env`. En el entorno de Claude Code en la nube,
como variable de entorno `ANTHROPIC_API_KEY` (menú del entorno → Editar). Cualquier persona o comando que
use ese entorno puede leerla, así que usá una key exclusiva para la agencia y con límite de gasto en
console.anthropic.com. Una sesión nueva la toma.

## 1 bis. Ver el sistema funcionando sin API key (modo demo)

```
npm run demo                 # servidor en modo demo, con demoras para ver los estados en vivo
npm run cliente-ficticio     # carga a "Trama Lino (ficticio)" con su link de portal
```

Abrí http://localhost:3000 (sitio y chat) y http://localhost:3000/panel (contraseña `demo`). Las
respuestas de los agentes son simuladas y están marcadas como DEMO: sirven para aprender el flujo, no
para evaluar la calidad.

## 2. Antes de cargar al cliente: probar los agentes

1. `npm install` y `npm start` con la API key.
2. `npm run eval -- --reps 3`: corre los 13 casos de prueba con la API real. Leé las transcripciones en
   `evals/resultados/`. Si algún caso falla, avisame y lo ajustamos antes de usarlo con el cliente.
3. Abrí `/panel` y lanzá una auditoría de prueba sobre una tienda conocida para ver el formato.

## 3. Puesta en marcha del cliente (semana 1)

| Día | Qué hacés | Qué hacen los agentes |
|---|---|---|
| 1 | Creás al cliente en **Clientes**: marca, rubro, URL, redes, público, tono, productos, objetivo y **plan** | — |
| 1 | Tocás **Diagnóstico + plan 90 días** | Auditan la tienda, arman el calendario y el plan de 90 días |
| 2 | Revisás el diagnóstico, corregís lo que haga falta con **Pedir cambios** y aprobás | Rehacen con tus correcciones y guardan cada comentario como lección del cliente |
| 2 | Le pasás al cliente el **link de su portal** | — |
| 3 | Reunión de arranque con el cliente sobre el plan de 90 días | — |
| 3–5 | Medición: GA4, píxel de Meta y Clarity. Anotás los números de partida (ventas, sesiones, conversión, seguidores) | — |
| 5 | Si el plan tiene reportes semanales, cargás las métricas de la semana desde **Lanzar agente → Reporte semanal** (o conectás Make más adelante) | Arman el reporte y verifican que no haya números inventados |

**Anotar los números de partida es lo más importante de la semana:** sin ellos no hay caso de éxito.

## 4. Tu dedicación mensual según el plan

Estimación de horas tuyas con los agentes haciendo análisis, guiones, textos y reportes. El cliente
graba el material en bruto con las guías del calendario.

| Plan | Revisar entregas | Edición y diseño | Comunidad | Mejoras en la tienda | Pauta | Reuniones | **Total** |
|---|---|---|---|---|---|---|---|
| Redes que crecen (450 USD) | 2 h | 10 h | 10 h | — | — | 1 h | **≈ 23 h/mes** |
| Tienda que convierte (650 USD) | 3 h | — | — | 8 h | — | 2 h | **≈ 13 h/mes** |
| Growth 360 (1.200 USD) | 4 h | 14 h | 10 h | 6 h | 6 h | 2 h | **≈ 42 h/mes** |

Con un cliente te quedan la mayor parte de las horas libres. Usalas para conseguir el segundo (punto 6).

## 5. Rutina semanal (unas 2 horas fijas, más la producción)

- **Lunes:** cargar las métricas de la semana (si corresponde) y revisar el reporte antes de publicarlo.
- **Todos los días, 10 minutos:** pestaña **Requieren atención** y comentarios del portal.
- **A fin de mes:** el calendario y los anuncios del mes siguiente aparecen solos (entre el 20 y el 25).
  Revisalos, pedí cambios si hace falta y aprobalos para que el cliente los vea.
- **Cada comentario que escribís queda como lección:** en 2 o 3 meses, las entregas salen mucho más
  cerca de lo que querés.

Con un solo cliente, dejá la publicación en **"solo lo que apruebe el equipo"**: revisar todo lleva
poco tiempo y te da control total sobre la relación.

## 6. Cómo convertir este cliente en los próximos

1. **Pedí permiso por escrito** para usar sus resultados como caso (con o sin nombre).
2. **Compará contra los números de partida** cada mes en el reporte. A los 90 días armá el caso:
   problema, qué se hizo y resultado medido.
3. **Mientras tanto, el sitio trabaja solo:** el chat atiende, califica, pide auditorías y hace
   seguimiento de los leads. Revisá la pestaña **Leads** día por medio.
4. **Auditorías en público:** con el Agente Auditor podés analizar tiendas conocidas del rubro de tu
   cliente y publicar "3 cambios que harían vender más a esta tienda". Es el contenido que más
   demuestra lo que sabés hacer.
5. **Pedí referidos** a tu cliente cuando lleguen los primeros resultados.

## 7. Qué dejar apagado por ahora

Nada de esto molesta, pero no hace falta configurarlo con un cliente:

- Webhook a Make/Zapier/n8n (revisás el panel directamente).
- Ingesta automática de métricas (cargarlas a mano lleva 5 minutos por semana).
- Responsables por cliente (sos vos).
- Publicación automática en el portal.

Cuando llegues a 3 o 4 clientes conviene conectar la ingesta de métricas y el webhook. La guía de
20 clientes está en la sección 13 de `PLAN_DE_NEGOCIO.md`.
