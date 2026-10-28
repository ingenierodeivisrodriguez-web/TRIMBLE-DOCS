---
name: extensiones-trimble
description: Conocimiento completo del repositorio TRIMBLE-DOCS (extensiones para Trimble Connect en Next.js 16 + React 19, desplegadas en Vercel con Supabase), sobre todo de las extensiones Presupuesto y Compras y Contratación. Cubre las reglas fijas del dueño, la arquitectura (rutas → servicio → store → SQL), el cálculo de APU (cuadrillas por hora y por día, %MO y %, metrado, catálogos y "Al catálogo"), la programación (Gantt, ruta crítica, EDT del PMI, línea de balance), la línea base y el valor ganado, el asistente IA (Claude o Gemini, cupos, borradores), Compras (requisiciones, cotizaciones, órdenes y contratos, recepción en obra, documentos en el CDE de Trimble Connect, roles y auditoría, panel) y el flujo de pruebas, verificación en el navegador y despliegue. Úsala siempre que se trabaje en este repositorio o se pregunte por Presupuesto, partidas, insumos, análisis de precios unitarios, cuadrillas, rendimiento, jornada, metrado, Gantt, EDT, WBS, avance de obra, valor ganado, asistente IA, realidad aumentada, QR, WebXR, celular en obra, compras, requisiciones, cotizaciones, proveedores, órdenes de compra, contratos, recepción, CDE, Propiedades, Validación, Gráficos, Manuales, manifiestos de Trimble Connect, Supabase o Vercel, aunque no se nombre la skill.
---

# Extensiones para Trimble Connect (TRIMBLE-DOCS)

Una sola app Next.js (App Router) en `https://trimble-docs.vercel.app`, repositorio
`ingenierodeivisrodriguez-web/TRIMBLE-DOCS`, rama `main` (Vercel despliega solo cada
push). Diez extensiones: Resumen Archivos, Validación, Gráficos de Modelos,
Propiedades, **Presupuesto** (la más grande), Manuales, **Compras y
Contratación** (construida en 8 fases en octubre de 2026) y **Control de Obra**
(multiempresa con licencias; en construcción por fases), además de Requisitos
BIM (LOIN) y **Realidad aumentada con QR** (modelo 1:1 en el celular, fijo en un
QR pegado en un muro; 6 fases el 27-10-2026). El dueño es ingeniero civil en Colombia y escribe en español:
responde en español, con palabras de obra (partida, insumo, APU, cuadrilla,
rendimiento, metrado, jornal), sin jerga de programación.

## Reglas fijas del dueño (no negociables)

Estas reglas vienen de decisiones explícitas del dueño. Aplícalas aunque nadie las
recuerde en la conversación:

1. **Nunca guardar valores en los Property Sets ni en los UDA de Trimble Connect.**
   Todo lo propio (atributos, metrados, días de ejecución, memoria) va a Supabase,
   ligado al elemento por su **IFCGUID**.
2. **Nunca sobrescribir en silencio un valor que difiere.** Si varios elementos o
   registros tienen valores distintos, o lo nuevo pisaría algo escrito por una
   persona, se muestra y se pregunta. Ejemplos ya construidos: el % del modelo en un
   corte de avance, marcar ejecutados con otra fecha, una partida "distinta" al
   guardarla en el catálogo, los borradores de la IA.
3. **Nunca borrar físicamente una definición que tiene valores**: se desactiva.
   Las líneas base tampoco se borran.
4. **Fechas visibles siempre DD-MM-AAAA.**
5. **Nunca poner secretos en el código ni en git** (Client Secret, cadenas de
   conexión, claves de API): solo variables de entorno de Vercel. En
   `.env.example` van los nombres, nunca los valores.
6. **La IA propone, la persona decide**: nada de lo que propone el asistente entra
   al presupuesto sin que alguien lo acepte, y **los precios nunca vienen de la IA**.
7. **Compras** tiene además sus propias reglas de seguridad y datos (ningún
   binario en Supabase, Presupuesto solo lectura, sin Supabase Auth, el navegador
   nunca habla con Supabase, RLS sin políticas, ningún enlace público, "respaldado"
   solo cuando Trimble confirma, quien elabora no aprueba). Están completas en
   `references/compras.md`: léelas antes de tocar Compras.
8. **Para trabajos grandes, primero inspección y plan; nada de código ni
   migraciones sin el OK del dueño.** Cuando él dice "sigue con la siguiente
   fase", ese es el OK de esa fase. Si conviene otro esquema distinto al aprobado,
   se propone y se justifica antes de hacerlo (o se dice claramente al entregar
   si es una diferencia menor, como la vista SQL del panel de Compras).

## Cómo trabajar en este repositorio

El ciclo que se ha usado en cada cambio, y que el dueño espera:

1. **Entender antes de tocar.** Lee el código del área (el README tiene una sección
   por funcionalidad y está al día). Para dudas de reglas de negocio, mira primero
   las pruebas `lib/**/*.test.ts`: describen el comportamiento esperado en español.
2. **Lógica pura en `lib/`, con pruebas.** Las reglas (cálculo, validación,
   planes) van en funciones puras de `lib/presupuesto/...` o `lib/compras/...` con
   su `*.test.ts` (`node:test` + `assert/strict`, nombres de prueba en español,
   datos inline; en Compras también `*.service.test.ts` contra `memoryStore`). La
   interfaz en `components/<extensión>/` solo las usa.
3. **Verifica en este orden:** `npm test`, `npx tsc --noEmit -p .`,
   `npx next build`. No vuelvas a correr una verificación que ya pasó si no
   cambiaste código.
4. **Prueba la interfaz en el navegador** con una página temporal y una API falsa
   (receta en `references/flujo-desarrollo.md`). Bórrala antes de confirmar.
5. **Actualiza el README** (la sección de la funcionalidad), en el mismo estilo:
   español llano, qué hace y por qué, sin relleno.
6. **Confirma y sube a `main`**: mensaje en español con título "Área: qué cambió"
   y viñetas. El dueño espera ver los cambios en Trimble Connect, así que al
   terminar una funcionalidad se sube y se espera el despliegue de Vercel (en
   segundo plano) para avisarle que recargue la pestaña de Trimble Connect.
7. **Si cambió `supabase/presupuesto.sql` o `supabase/compras.sql`**, pruébalo
   antes con PGlite (dos veces seguidas) y dile al dueño que lo vuelva a ejecutar
   en el SQL Editor de Supabase (es re-ejecutable sin perder datos). Claude nunca
   ejecuta migraciones en Supabase; solo consultas de lectura.
8. **Al responder**, di qué cambió, cómo se usa (botón por botón), qué se probó y
   cualquier límite o efecto en datos existentes (por ejemplo, "los presupuestos
   con cuadrillas por día cambian de valor, ahora al correcto").

## Convenciones de código

- Comentarios del código en **inglés**, cortos, explicando el porqué. Textos de la
  interfaz en **español**, en frases normales, con ayudas (`title`) que dicen la
  cuenta o la regla ("Calculada: cuadrilla 1 × jornada 8 h ÷ rendimiento 250").
- Números del presupuesto con `fmt()` (formato 284,571.31, como la herramienta de
  referencia S10); cantidades a 4 decimales, montos a 2 (`redondear`).
- Estilos inline con los tokens de `components/presupuesto/ui.tsx` (`C`,
  `baseInput`, `celdaActiva`...). Entradas numéricas con `NumInput`, de texto con
  `TextCommit`: confirman con Enter o al salir, Escape cancela, se iluminan en
  amarillo mientras se escriben y avisan cómo se salió (`onLeave`).
- Sigue el idioma de lo que rodea: nombres de funciones y variables en español en
  la lógica de negocio (`planAlCatalogo`, `cantidadComponente`), en inglés en lo
  genérico (`handle`, `readJson`).
- Gráficos: 8 colores categóricos en orden fijo y cada entidad conserva su color
  al filtrar (ver línea de balance).

## Dónde está cada cosa

Lee el archivo de referencia que corresponda antes de cambiar esa área:

| Necesitas… | Lee |
|---|---|
| Mapa del repositorio, capas de Presupuesto, rutas, tablas, permisos, otras extensiones | `references/arquitectura.md` |
| Cálculo del APU, cuadrillas, %MO y %, metrado, catálogos, "Al catálogo", Excel, edición en la grilla | `references/presupuesto-calculo.md` |
| Gantt, ruta crítica, calendario, EDT de la programación (PMI), actividades, regla del 100 %, división por ubicación, línea de balance, línea base, cortes, valor ganado, avance en el visor | `references/programacion-avance.md` |
| Asistente IA: fases, proveedores, cupos, borradores, validaciones, versiones de instrucciones | `references/asistente-ia.md` |
| Compras y Contratación: restricciones del dueño, decisiones aprobadas, roles y permisos, estados, reglas críticas (servicio + SQL + triggers), documentos en el CDE (API Core de Trimble), PDF, panel | `references/compras.md` |
| Control de Obra: fases, decisiones D1–D13 y plan de actas, empresas, licencias, administradores, aislamiento por empresa, bitácora encadenada, flujos de aprobación, cómo probarlo | `references/control-obra.md` (y `docs/control-obra/plan-actas.md`) |
| Realidad aumentada con QR: decisiones del dueño, por qué web-ifc y páginas públicas, marcos de coordenadas, alineación del visor, calibración en el muro, herramientas, cómo probar sin celular | `references/realidad-aumentada.md` |
| Pruebas, página de prueba con API falsa, navegador, despliegue, SQL, trucos de Windows | `references/flujo-desarrollo.md` |
| Responder preguntas de uso: URLs de instalación, orden de trabajo, textos para el asistente, explicar cuadrillas | `references/guia-usuario.md` |

Herramientas incluidas:

- `assets/dev-preview-page.tsx`: página temporal con una API falsa para probar la
  interfaz de Presupuesto en el navegador (cópiala a `app/dev-preview-<tema>/`).
- `assets/dev-preview-compras.tsx`: página temporal de Compras con el servicio
  real sobre `memoryStore` y el Trimble falso, ya sembrada (requisición, cotización,
  orden emitida, recepción aprobada, carpetas del CDE preparadas).
- `scripts/esperar-despliegue.sh`: espera el despliegue de Vercel de un commit
  (ejecútalo en segundo plano después del push).
- `scripts/probar-sql.mjs`: comprueba con PGlite que un `.sql` de `supabase/` se
  puede ejecutar dos veces seguidas.

## Pendientes conocidos

- Realidad aumentada: falta la prueba en obra con un Android real (protocolo en
  `/ra/guia#prueba`); ver `references/realidad-aumentada.md`.

- Ofrecido y **sin aprobar**: un párrafo en la política de privacidad
  (`app/bim-apps/privacidad/page.tsx`) sobre el proveedor de IA. No toques la
  página legal sin que el dueño lo apruebe.
- Falta probar de punta a punta dentro de Trimble Connect real y con respuestas
  reales de Google/Claude (todo se verificó con APIs falsas en el navegador).
- Compras: el dueño debe hacer la **prueba de escritura en el CDE** en un proyecto
  de pruebas y pegar el resumen, y la prueba de aceptación con personas de
  distintos roles (ver `references/compras.md`).
- El pie inicial del subpresupuesto viene de la referencia peruana (UTI 10 %,
  IGV 18 %); para Colombia podría convenir AIU e IVA sobre la utilidad. Solo si el
  dueño lo pide.
