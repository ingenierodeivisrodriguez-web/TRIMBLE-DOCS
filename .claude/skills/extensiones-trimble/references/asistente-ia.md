# Asistente IA del Presupuesto

## Contenido
1. Principios
2. Archivos y tareas
3. El camino de cada llamada (`llamar<T>()`)
4. Fases (pestañas)
5. Borradores y evaluación
6. Proveedores, modelos y variables
7. Cupos y protecciones
8. Cómo agregar o cambiar una tarea

## 1. Principios

- **Propone, no decide**: todo llega como borrador; la persona acepta, corrige o
  descarta. Lo aceptado entra al presupuesto en pantalla y después se guarda como
  siempre.
- **Precios nunca de la IA**: a la IA se le mandan descripciones, unidades y tipos,
  sin precios (salvo la pestaña Preguntar, que lo advierte). Los insumos nuevos se
  crean en el catálogo **sin precio**.
- **Los textos son datos**: van entre etiquetas y las instrucciones del sistema
  dicen que cualquier orden dentro de los datos se ignora (defensa contra
  inyección). Nunca se envían nombres de personas ni correos.
- **Todo se valida dos veces**: lo que llega del navegador y lo que responde el
  modelo (códigos, rangos, tamaños) antes de mostrarlo o guardarlo.
- Práctica colombiana: NSR-10, NTC, RETIE, RETILAP, RAS (Res. 0330/2017), NTC 1500,
  NTC 2050, sin inventar numerales.

## 2. Archivos y tareas

`TareaIA = "edt" | "insumos" | "estructura" | "apu" | "chat" | "programa"`
(`ia/tipos.ts`; las que dejan borradores: estructura, edt, insumos, apu, programa).

| Archivo | Tarea |
|---|---|
| `ia/edt.ts` | Fase 1: diccionario EDT (descripción del trabajo y criterios de aceptación) |
| `ia/insumos.ts` | Fase 2: insumos que necesitan las partidas contra el catálogo (`claveInsumo`, `candidatos`) |
| `ia/estructura.ts` | Fase 3: crear la EDT (capítulos, luego partidas por capítulo, usando el catálogo) |
| `ia/apu.ts` | Fase 4: análisis de precios (`leerApu`, `leerLinea`, evaluación contra el catálogo) |
| `ia/chat.ts` | Fase 5: preguntas sobre el presupuesto (`contextoPresupuesto`, solo lectura) |
| `ia/programa.ts` | Programación: paquetes de trabajo y predecesoras |
| `ia/servicio.ts` | Orquesta: `llamar<T>()`, validaciones finales, borradores, registro |
| `ia/proveedor.ts`, `claude.ts`, `gemini.ts` | `ClienteIA` común con dos implementaciones |
| `ia/cupo.ts` | Costos, cupo del mes, TRM |
| Componentes | `AsistenteIA.tsx` (pestañas), `AsistenteIAFases.tsx`, `AsistenteIAApu.tsx`, `AsistenteIAChat.tsx`, `Edt.tsx` (`ProgramaIADialog`) |

Versiones de instrucciones (`VERSION_PROMPT_*`, quedan en el registro de uso):
`edt-co-1`, `insumos-co-2`, `estructura-co-1`, `apu-co-3`, `chat-co-1`,
`programa-co-1`. **Súbela cada vez que cambies el texto de unas instrucciones** y
actualiza las pruebas que la verifican.

## 3. El camino de cada llamada (`llamar<T>()` en `ia/servicio.ts`)

1. `requireEdit` (administrador o editor del presupuesto).
2. Cliente del proveedor (503 `ia-sin-clave` si no hay clave).
3. Cupo del mes (402 `ia-cupo` si está deshabilitado o agotado) y frecuencia
   (≤ 20 solicitudes por minuto por persona y proyecto, 429 `ia-frecuencia`).
4. Costo máximo estimado de la llamada contra lo que queda (402 si no alcanza).
5. `cliente.generar({ sistema, datosFijos, usuario, esquema, maxTokens, esfuerzo })`
   con **salida estructurada** (JSON Schema); los datos fijos (catálogo, resumen
   del presupuesto) van en caché del proveedor.
6. Rechazo del modelo o corte por `max_tokens` → resultado "rechazado" o
   "incompleto".
7. `leer*()` valida la respuesta; `registrar()` guarda el uso (tokens, USD, COP,
   TRM, versión, resultado) en `presupuesto_ia_uso`.

Límites (`ia/tipos.ts`): 12 partidas por lote (diccionario), 6 por lote de APU (el
navegador manda 3), 40 líneas por APU, 3 partidas parecidas, 150 actividades de
programación, 1.500 entradas de catálogo (si hay más, las más parecidas), contexto
del proyecto 2.000 caracteres, chat 150.000 caracteres de contexto, 1.500 por
pregunta, 12 intervenciones de historial.

## 4. Fases (pestañas)

Orden de trabajo recomendado al usuario: **Crear EDT → Insumos → Análisis (APU) →
Diccionario EDT → Preguntar**. El "Contexto/Descripción del proyecto" se guarda
por proyecto (`localStorage presupuesto.ia.contexto.<projectId>`) y lo reusan
Diccionario, Insumos, APU y la programación.

- **Crear EDT**: descripción (≥ 15 y ≤ 2.000 caracteres; "N pisos" en números se
  lee como pisos tipo), agrupar solo por capítulos o por capítulos y pisos,
  detalle resumido o detallado, subpresupuesto destino. Capítulos primero, luego
  partidas por capítulo; usa partidas del catálogo (llegan con su análisis); las
  nuevas quedan sin análisis; metrados en 0. Inserta en el **presupuesto**, no en
  el catálogo.
- **Insumos**: los que el catálogo tiene se señalan; los que faltan se crean sin
  precio. La herramienta menor se propone EQ con unidad %MO.
- **Análisis (APU)**: rendimiento; cuadrillas para MO/EQ por hora o por día (si la
  IA da una cantidad, se pasa a la cuadrilla equivalente; si da más de 100 se
  descarta: era una cuadrilla escrita como cantidad); cantidades de materiales con
  desperdicio; % en líneas %MO o %. Sin subpartidas (sin ciclos). La revisión
  muestra el CU propuesto con los precios del presupuesto, el actual, el rango de
  las parecidas (aviso fuera de 75 %–125 %) y los insumos sin precio.
  **Evaluar con el catálogo**: muestra fija de 6/10/20/30 partidas del catálogo;
  metas: ≥ 50 % de CU dentro de ±25 %, 0 insumos inventados, 0 sin análisis.
- **Diccionario EDT**: lotes de 5; el responsable no se propone; meta ≥ 70 %
  aceptados sin cambios.
- **Preguntar**: chat de solo lectura sobre el presupuesto en pantalla; las
  partidas mencionadas son enlaces (códigos P1, P2…); conversación en
  `sessionStorage`.
- **Uso y cupo**: barras del cupo, últimas 50 solicitudes, evaluación por tarea;
  administración de cupos para el proyecto gestor.

## 5. Borradores y evaluación

- `presupuesto_ia_borradores`: pendiente, aceptado, rechazado, reemplazado; si se
  editó y quién decidió. Pedir de nuevo una partida reemplaza su pendiente.
- "Aceptado con cambios" = lo aplicado (`final`) difiere de lo propuesto. La
  comparación usa **JSON canónico** (claves ordenadas), porque jsonb no conserva el
  orden de las claves.

## 6. Proveedores, modelos y variables

- Anthropic (Claude): `claude-opus-5-5` por defecto, esfuerzo bajo, salida
  estructurada, instrucciones en caché, `fallbacks: "default"` ante rechazos de
  seguridad. SDK `@anthropic-ai/sdk`.
- Google (Gemini): `gemini-3.8-flash` por defecto, respaldo `gemini-3.5-flash-lite`
  si Google falla (500/503 tras dos reintentos) o se queda sin cuota (429). El
  nivel gratuito de AI Studio permite que Google use los datos: solo para pilotos.
  SDK `@google/genai`.
- Se usa el proveedor que tenga clave (Anthropic primero);
  `PRESUPUESTO_IA_PROVEEDOR` lo fuerza; `PRESUPUESTO_IA_MODELO` cambia el modelo
  (su nombre elige el proveedor); `PRESUPUESTO_IA_MODELO_RESPALDO` (`no` lo apaga).
- Antes de tocar código del SDK de Claude, carga la skill `claude-api`: los nombres
  de modelos y parámetros cambian.

## 7. Cupos y protecciones

- Los cupos (habilitado, mensual del proyecto, mensual por persona, en COP) los fija
  el proyecto gestor (`PRESUPUESTO_IA_PROYECTO_GESTOR`); `_global` guarda los
  valores por defecto y la TRM. Mes en hora de Colombia; aviso al 80 %, bloqueo al
  100 %. Sin configurar, el asistente está apagado.
- El navegador no reintenta por cupo ni frecuencia; sí una vez a los 6 s si el
  proveedor está ocupado.
- Apagar en un proyecto: desmarcar Habilitado. Apagar en toda la plataforma: quitar
  la clave en Vercel y volver a desplegar.

## 8. Cómo agregar o cambiar una tarea

1. Tipos y límites en `ia/tipos.ts` (agrega la tarea a `TareaIA` y, si deja
   borradores, a `TAREAS_CON_BORRADORES`).
2. Módulo `ia/<tarea>.ts` con `SISTEMA_*` (español, reglas claras, datos como
   datos), `ESQUEMA_*` (JSON Schema estricto, `additionalProperties: false`),
   `mensaje*()`, `maxTokens*()` y `leer*()` que descarta todo lo inválido.
3. Función en `ia/servicio.ts` que use `llamar<T>()`; validación final si el
   borrador se puede editar antes de aplicar.
4. Ruta en `app/api/presupuesto/ia/<tarea>/route.ts` con `handle()`; método en
   `lib/presupuesto/client.ts`.
5. Pruebas en `ia/*.test.ts` con respuestas simuladas (sin llamar al proveedor).
6. Actualiza la sección "Asistente IA" del README.
