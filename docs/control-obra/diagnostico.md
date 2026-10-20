# Control de Obra — Fase 1: diagnóstico

Fecha: 20-10-2026. Rama `main`, commit de partida `938a101`.

Este documento contrasta lo que pide Control de Obra con lo que ya existe en el
repositorio. Cada afirmación cita el archivo y la línea donde se comprobó. No hay
código nuevo de la extensión: solo este diagnóstico y el diseño
(`docs/control-obra/diseno.md`). **Nada se construye hasta que el dueño apruebe
el diseño.**

## 0. Tres avisos antes de empezar

1. **Documento de especificación.** La primera versión de este diagnóstico se
   hizo sin él. El dueño lo entregó después ("CONTROL DE OBRA — Documento de
   definición funcional, técnica y de implementación", versión 1.0, octubre de
   2026). La **sección 9** de este archivo es el informe de su sección 3
   (arquitectura) y el contraste punto por punto con el resto; el diseño quedó
   en su versión 2.
2. **Ya hay siete extensiones, no seis.** La séptima es **Compras y
   Contratación** (`app/compras/`, `lib/compras/`, `supabase/compras.sql`,
   `public/manifest-compras.json`), construida en octubre de 2026. Control de
   Obra sería la **octava**. Compras ya resolvió varias de las cosas difíciles que
   pide Control de Obra (roles con matriz de permisos, auditoría que no se puede
   cambiar, documentos en el CDE con "respaldado solo cuando Trimble confirma",
   lectura de Presupuesto sin escribir en él). La recomendación es **copiar sus
   patrones**, no inventar otros (sección 2).
3. **Acceso a GitHub.** Al principio la sesión no podía subir; el dueño conectó
   GitHub y ya se sube a `main` normalmente.

### Estado del repositorio al empezar

- Pruebas: **609 de 609 pasan** ejecutando todos los archivos de prueba
  (`npx tsx --test $(find lib -name "*.test.ts")`).
- Hallazgo menor: `npm test` (`package.json:10`, `tsx --test lib/**/*.test.ts`)
  en Linux solo corre **536** pruebas: sin comillas, la consola expande `**` como
  un solo nivel y se salta 7 archivos (`lib/*.test.ts` y `lib/presupuesto/ia/*`).
  En Windows sí corren todas porque `cmd` no expande el patrón. Arreglo propuesto
  para la Fase 3: poner el patrón entre comillas para que lo expanda Node.

## 1. Qué cubre ya Presupuesto y qué falta

Control de Obra debe **leer** Presupuesto como fuente oficial y **no escribir en
él** (igual que Compras: `lib/compras/presupuestoLectura.ts` solo hace GET).

| Concepto de la especificación | ¿Existe? | Dónde está | Observación |
|---|---|---|---|
| Presupuesto aprobado (partidas, APU, precios) | Sí | `presupuesto_documentos.data` (`supabase/presupuesto.sql:100-106`), cálculo en `lib/presupuesto/calc.ts` | Es un solo JSON con `version`. Se lee y se calcula con las mismas funciones (`calcularSubpresupuesto`). |
| Cantidad presupuestada (metrado) | Sí | Ítem de partida dentro del documento; origen del metrado en `presupuesto_mediciones` (`presupuesto.sql:137-146`) | |
| Cantidad del modelo por elemento | Sí | `presupuesto_elementos.cantidad` (`presupuesto.sql:119-130`) | Es **dato del modelo**, nunca "ejecutado verificado". |
| Elemento ejecutado | Sí, parcial | `presupuesto_elementos.ejecutado` y `ejecutado_por` (`presupuesto.sql:398-399`); se marca desde `components/presupuesto/PanelAvance.tsx` | Es **una fecha y quién la puso**. No distingue reportado / verificado / aceptado. |
| Cantidad planificada en el tiempo | Sí, se deriva | Línea base: `TareaBase.metrado`, `es`, `ef` (`lib/presupuesto/types.ts:502-531`); fracción planeada en `fraccionPlaneada` (`lib/presupuesto/avance.ts:50`) | No se guarda: planificada a una fecha = metrado × fracción planeada. |
| Línea base | Sí | `presupuesto_lineas_base` (`presupuesto.sql:402-417`), una vigente, no se borran | Control de Obra la referencia por su `id`. |
| Avance (cortes) | Sí, parcial | `presupuesto_avance` (`presupuesto.sql:449-483`): por fecha, % acumulado por partida y costo real opcional (`AvancePartida`, `types.ts:563-578`) | Un solo JSON por proyecto con versión. Es **% declarado**, sin estados ni soporte. |
| PV, EV, AC, SPI, CPI, EAC | Sí | `Medidor` e `indicadores` (`avance.ts:56-225`) | **AC** es un número acumulado escrito a mano por partida en el corte: no dice de dónde sale ni separa real / comprometido / estimado. |
| % del modelo a una fecha | Sí | `presupuesto_resumen_ejecucion` (`presupuesto.sql:486-498`), `pctDelModelo`, `pctTareaDelModelo` (`avance.ts:324, 404`) | Siempre pide confirmación antes de reemplazar lo escrito (regla 2). |
| Costo comprometido | **En Compras** | Órdenes y contratos no anulados: `compras_ordenes`, `compras_orden_lineas` (`supabase/compras.sql:1147-1203`), panel en `lib/compras/panel.ts` | Por insumo, no por partida. Control de Obra lo **lee**; no lo copia (para no sumarlo dos veces). |
| Recibido en obra | **En Compras** | `compras_recepciones`, `compras_recepcion_lineas` (`compras.sql:1581-1630`) | Cantidad aceptada en almacén, no instalada. |
| Costo real (facturas, pagos, nómina) | **No existe** | — | Ni Presupuesto ni Compras registran facturas ni pagos. Hay que crearlo (rotulado como real y con su fuente). |
| Cantidad reportada / verificada / aceptada | **No existe** | — | Nuevo en Control de Obra. |
| Calidad: criterios, lotes, ensayos | **No existe** | — | Nuevo. |
| Inspecciones, no conformidades, aceptación de elementos | **No existe** | — | Nuevo. |
| Bitácora de auditoría | Solo en Compras | `compras_auditoria` (`compras.sql:91-125`) | Patrón a copiar, con hash encadenado adicional. |
| Documentos en el CDE | Solo en Compras | `lib/compras/cde.ts`, `compras_documentos` (`compras.sql:1502-1560`) | Patrón a copiar. |
| Empresas y licencias | **No existe** (solo licencias por correo en Manuales) | `manuales_autorizados` (`supabase/manuales.sql:33-45`), `lib/manuales/licencia.ts` | Se reutiliza la **lógica de vigencia** (`estadoLicencia`), no las tablas. |

### Tres cuidados con los datos de Presupuesto

1. **Las filas de elementos se borran al quitar una partida.** Al guardar el
   presupuesto, `presupuesto_guardar_documento` borra los elementos y mediciones
   de partidas que ya no existen (`presupuesto.sql:238-251`). Por eso Control de
   Obra **no puede colgar sus registros de `presupuesto_elementos`** con una
   clave foránea: guarda su propia identidad del elemento (IFCGUID + modelo +
   versión) y la partida como referencia de texto. Si la partida desaparece, sus
   registros quedan "sin partida vigente" y se muestran para revisión; no se
   borran.
2. **Presupuesto y Propiedades no guardan la versión del modelo.** `model_id` es
   el id del archivo, estable entre versiones (`presupuesto.sql:124`,
   `supabase/propiedades.sql:41-58`, comentario "el valor sigue al elemento
   aunque cambie la versión"). Control de Obra sí necesita la versión: guardará
   el `versionId` con el que se leyó cada dato del modelo, sin cambiar las tablas
   de Presupuesto.
3. **El avance es un solo JSON por proyecto con versión optimista**
   (`presupuesto_guardar_avance`, `presupuesto.sql:458-483`). Si Control de Obra
   escribiera ahí, chocaría con quien edita los cortes en Presupuesto. Propuesta:
   Control de Obra **no escribe** en los cortes de Presupuesto; calcula su propio
   valor ganado con las cantidades **aceptadas** y la misma línea base y las
   mismas funciones (`Medidor`). Si el dueño quiere que Presupuesto tome esas
   cantidades, se agrega en Presupuesto un botón "Leer de Control de Obra" que
   pregunta antes de reemplazar (como "Leer el avance del modelo 3D"). **Decisión
   del dueño (pregunta D1 del diseño).**

## 2. Lo que se reutiliza (verificado en el código)

| Pieza | Dónde | Cómo se usa en Control de Obra |
|---|---|---|
| Conexión con Trimble y token | `components/trimble/ExtensionShell.tsx:101-121` (`getHost`, `setMenu`, `getProject`, `requestPermission("accesstoken")`) | Igual. |
| Abrir el visor desde el menú | `ExtensionShell.tsx:182` (`extension.goTo("3dviewer", …)`) + tarea de un solo uso `presupuesto_vistas` (`presupuesto.sql:33-44`) | Tabla propia `obra_vistas` con el mismo diseño. |
| Quién llama | `resolveCaller` (`lib/propiedades/caller.ts:22-74`): miembro del proyecto, nombre, `isAdmin` = rol ADMIN en Trimble; caché 2 min | Igual, más la empresa y el rol propio (sección 4). |
| Capas de la API | `handle()` y `readJson()` (`lib/presupuesto/routes.ts:20-73`; Compras repite el patrón en `lib/compras/routes.ts:24-77`) | `lib/control-obra/routes.ts` con su propio `handle`. |
| Roles, permisos, denegaciones auditadas | `lib/compras/accesos.ts`, `requerir()` y `denegar()` (`lib/compras/service.ts:114-135`), SQL `compras_roles`, `compras_usuarios`, `compras_permisos_de` (`compras.sql:47-145`) | Mismo diseño, con nivel empresa encima del nivel proyecto. |
| Auditoría de solo inserción | Trigger `compras_auditoria_inmutable` contra `update`, `delete` y `truncate` (`compras.sql:108-125`) | Igual + hash encadenado + permisos de tabla solo `select, insert`. |
| Documentos en el CDE | `lib/compras/cde.ts` (carpetas, subida en tres pasos, estado, descarga), `lib/compras/subida.ts` (huella SHA-256, copia local, reintento), restricción `compras_documentos_respaldo` (`compras.sql:1532`) | Se reutiliza el cliente `cde.ts` tal cual; tablas propias. |
| Ubicar elementos por IFCGUID en el visor | `MapaGuids.ubicar` (`lib/presupuesto/viewerMap.ts:29-128`): convierte el IFCGUID, si no recorre los ids externos, si no lee la propiedad GUID | Igual. |
| Leer la selección y su IFCGUID | `readSelection` (`lib/propiedades/selection.ts:66-99`), `resolveIfcGuid` y conversiones (`lib/propiedades/ifcGuid.ts`) | Igual. `resolveIfcGuid` ya dice cuándo el GUID no es confiable: eso alimenta la cola de incidencias. |
| Colorear y marcar en 3D | `setObjectState` en `PanelAvance.tsx:112,137`; `setSelection` + `setCamera` en `PanelVisor.tsx:139-140, 343-344` | Igual (colores por estado de calidad y de aceptación). |
| Jerarquías (torre, zona, nivel…) | Columnas de la memoria `ColumnaMemoria` con fuente "modelo", "propiedad" (atributo de Propiedades) o "ifcguid" (`lib/presupuesto/types.ts:259-283`); `getHierarchyParents` en `lib/propiedades/hierarchy.ts:37` | El mapeo de jerarquía usa **la misma forma** (`fuente` + `clave`), así un nivel puede salir del modelo o de un atributo de Propiedades sin crear otro catálogo. |
| Unidades del modelo | El visor da longitudes en mm, áreas m², volúmenes m³, masas kg (`lib/graficos/modelData.ts:30,141`; tipos del SDK `PropertyType`); unidad del presupuesto → magnitud con `medidaDeUnidad` (`lib/presupuesto/medicion.ts:33-41`) | Base de la regla "no sumar unidades incompatibles". |
| Vigencia de licencias | `estadoLicencia`, `sumarMeses`, `hoyIso` en zona de Bogotá (`lib/manuales/licencia.ts`) | Para la licencia de cada empresa. |
| Pagos en línea | `lib/manuales/wompi.ts`, `mercadopago.ts`, `pagos.ts` | **No en esta etapa.** Ligados a un correo y a `manuales_pagos`. Si el dueño quiere vender licencias de Control de Obra en línea, se adapta después (pregunta D7). |
| Tokens visuales y controles | `components/presupuesto/ui.tsx` (`C`, `Modal`, `Notice`, `NumInput`, `TextCommit`, `useVirtual`) | Igual que Compras. |

## 3. Trimble Connect: qué se usa y qué haría falta

### 3.1 Lo que ya usa el repositorio

**Workspace API (SDK `trimble-connect-workspace-api` 0.3.34, dentro de Trimble):**

| Método | Para qué | Dónde |
|---|---|---|
| `extension.requestPermission("accesstoken")` | Token del usuario (único permiso que existe en el SDK: `ExtensionAPI.d.ts:3`) | `ExtensionShell.tsx:121` |
| `extension.getHost`, `extension.goTo`, `ui.setMenu`, `project.getProject` | Menú, saber si está en el visor, abrir el visor | `ExtensionShell.tsx:101-182` |
| `viewer.getModels("loaded")` | Modelos cargados: `id`, `versionId`, `isLatestVersion`, `name` (`common.d.ts:90-105`) | `viewerMap.ts:53`, `selection.ts:63` |
| `viewer.getSelection` + evento `viewer.onSelectionChanged` | Selección | `PanelVisor.tsx:169-171` |
| `viewer.getObjectProperties` | Propiedades y cantidades | `selection.ts:77`, `viewerMap.ts:140` |
| `viewer.convertToObjectIds` / `convertToObjectRuntimeIds` | Id externo (GUID) ↔ id del visor | `selection.ts:42-47`, `viewerMap.ts:76` |
| `viewer.getObjects` | Todos los objetos de un modelo | `lib/graficos/viewerReader.ts:111` |
| `viewer.getHierarchyParents` | Contenedores (edificio, nivel…) | `lib/propiedades/hierarchy.ts:37` |
| `viewer.setSelection`, `viewer.setCamera(selector)` | Seleccionar y volar hasta los elementos | `PanelVisor.tsx:139-140` |
| `viewer.setObjectState` | Colorear, ocultar | `PanelAvance.tsx:112,137` |
| `viewer.toggleModel` | Cargar un modelo | `viewerMap.ts:239,260` |

**API Core (REST, con el token del usuario, en la región del proyecto):**
`GET /regions` y `GET /projects/me` para la región (`lib/trimbleApi.ts:77-118`),
`GET /projects/{id}`, `GET /users/me`, `GET /projects/{id}/users` y grupos
(`trimbleApi.ts:140-383`), `GET /folders/{id}`, `GET /folders/{id}/items`,
`GET /folders/fs/{id}/permissions` (`trimbleApi.ts:182-310`), `GET /files/{id}`,
`GET /files/fs/{id}/downloadurl` (`trimbleApi.ts:204-231`). Compras además crea
carpetas y sube archivos: `POST /folders`, `POST /files/fs/upload`, `PUT` a la URL
firmada, `GET /files/fs/upload?uploadId=` (`lib/compras/cde.ts:97-169`).

### 3.2 Lo que haría falta para Control de Obra

| Necesidad | Cómo | Estado |
|---|---|---|
| Listar modelos y su versión cargada | `viewer.getModels()` da `versionId` e `isLatestVersion` | **Posible** (ya en el SDK). Aviso del SDK: la lista sale del árbol de archivos, que carga perezoso (`ViewerAPI.d.ts:461-465`); para "todos los modelos del proyecto" desde el menú se recorre el árbol de carpetas con `walkProjectTree.ts` (ya existe). |
| Listar **las versiones** de un archivo | API Core `GET /files/{fileId}/versions` | **Por confirmar.** No está en el código. Desde esta sesión no se pudo abrir la documentación oficial (la red de este entorno bloquea `developer.trimble.com` y SwaggerHub); solo aparece en listados de terceros. Se comprueba en la Fase 4 con una "prueba de lectura" en un proyecto real, como la prueba de escritura de Compras, antes de construir sobre ella. |
| Abrir una versión concreta en el visor | `viewer.toggleModelVersion({ id, versionId })` (`ViewerAPI.d.ts:587-594`) | **Posible** (en el SDK, no usado aún). |
| Leer propiedades e IFCGUID | Lo existente (`readSelection`, `MapaGuids`) | **Ya funciona.** |
| Seleccionar y enfocar un elemento | `setSelection` + `setCamera(selector)`; "mostrar solo estos" con `isolateEntities` (`ViewerAPI.d.ts:640-644`) | **Posible.** |
| Detectar elementos nuevos, cambiados y eliminados entre versiones | **No hay método de "comparar versiones" en el SDK 0.3.34** (revisadas todas sus firmas). Se hace así: el panel del visor lee la lista de IFCGUID de cada versión cargada y una **huella** de las propiedades que importan (clase, nombre, cantidades) y la guarda en Supabase; comparar dos huellas da nuevos, eliminados y cambiados. | **Posible con límites:** solo con el modelo cargado en el visor; un modelo grande tarda (leer todas las propiedades ya se hace en Presupuesto con barra de avance, `viewerMap.ts:104-116`); hay que cargar cada versión que se quiera comparar. |
| Subir y leer archivos del CDE | El cliente de Compras (`lib/compras/cde.ts`) | **Posible, pendiente de confirmar en un proyecto real**: la "Prueba de escritura en el CDE" de Compras sigue sin hacerse (pendiente en `.claude/skills/extensiones-trimble/references/compras.md`, sección 12). Si el token de la extensión no puede escribir o el navegador no puede enviar a la URL firmada, el módulo de documentos queda limitado. |
| Permisos de carpetas | Leer: `GET /folders/fs/{id}/permissions` (ya existe). **Cambiar** permisos por API: no se usa y no lo pude comprobar en la documentación oficial; no se propone. | Las carpetas de Control de Obra heredan los permisos que el administrador del proyecto ponga en Trimble. |

**Permisos y límites que aplican a todo:** cada llamada va con el token del
usuario, así que Trimble responde 403 si esa persona no ve la carpeta o el
modelo; el token caduca y la app pide recargar (`code: "trimble-session"`,
`routes.ts:52-60`). Vercel limita el cuerpo de una petición a 4,5 MB, por eso
Compras manda el archivo directo a la URL firmada y solo relevan por el servidor
hasta 4 MB (`MAX_RELEVO`). Los datos de cada proyecto se piden a su región.

## 4. Multiempresa

Trimble Connect no tiene la "empresa" de este producto: tiene proyectos,
usuarios y roles de proyecto (ADMIN/USER). El SDK y lo que usa el repositorio no
traen un dato de "empresa" del usuario en el que se pueda confiar.

**Propuesta:** la empresa es un concepto **propio de Control de Obra**, guardado
en Supabase.

1. **Empresa → proyectos:** la empresa registra sus `projectId` de Trimble en
   `obra_empresa_proyectos`. Un proyecto pertenece **a una sola empresa** a la
   vez (índice único). Para vincular un proyecto, quien lo hace debe ser
   administrador de la empresa en Control de Obra **y** administrador de ese
   proyecto en Trimble (`resolveCaller(...).isAdmin`), y la licencia debe tener
   cupo de proyectos.
2. **Cómo se valida quien llama, en cada petición:** el navegador solo manda el
   `projectId` y el token. El servidor (a) confirma con Trimble que el token es
   de un miembro del proyecto (`resolveCaller`), (b) busca **él mismo** a qué
   empresa pertenece ese proyecto, (c) comprueba que la licencia de esa empresa
   está vigente y (d) busca el rol de esa persona en esa empresa y ese proyecto.
   **La empresa nunca viene del navegador**: no hay forma de pedir datos de otra
   empresa cambiando un parámetro.
3. **Primer administrador técnico del producto (tú):** variable de entorno en
   Vercel **`CONTROL_OBRA_ADMINS`** con uno o varios **IDs de usuario de
   Trimble** separados por coma. Nunca un botón público. La pantalla de "sin
   acceso" muestra "Tu ID de usuario de Trimble es …" para copiarlo a Vercel. Se
   prefiere a un "proyecto gestor" (como `PRESUPUESTO_IA_PROYECTO_GESTOR`) porque
   los administradores de un proyecto de Trimble pueden cambiar sin que te
   enteres; la lista de IDs solo la cambias tú en Vercel. El administrador
   técnico crea empresas, asigna y suspende licencias y nombra el primer
   administrador de cada empresa. **Decisión del dueño (D3).**
4. **Primer administrador de una empresa:** lo nombra el administrador técnico
   eligiendo a la persona de la lista de usuarios de un proyecto ya vinculado (así
   el ID es real). Desde ahí la empresa se administra sola: nadie cambia su propia
   fila ni su propia licencia, solo se dan permisos que uno tiene, siempre queda un
   administrador vigente (reglas ya probadas en Compras, `lib/compras/accesos.ts`).

## 5. Seguridad: RLS por empresa o autorización en el servidor

**Opción A — RLS con políticas por empresa y proyecto.** Las políticas de
PostgreSQL filtran por `empresa_id` usando datos del token con el que se conecta
el servidor. Para eso el servidor tendría que **fabricar un token de Supabase por
usuario** (firmado con el secreto JWT de Supabase, una variable más) y dejar de
usar la clave de servicio en esas consultas. Ventaja: el aislamiento lo garantiza
la base de datos. Desventajas: otro secreto delicado; cada función SQL debe
revisarse para no saltarse las políticas; rompe con las siete extensiones y
choca con la regla de Compras "sin Supabase Auth, RLS sin políticas"; las
pruebas con PGlite no reproducen bien los roles y tokens de Supabase.

**Opción B — RLS sin políticas (todo cerrado) + autorización en el servidor,
con el aislamiento metido en la estructura.** Es el patrón actual, reforzado:

- **El `store` no tiene ninguna función sin alcance.** Cada función recibe como
  primer parámetro obligatorio un `Alcance { empresaId, projectId }` que solo
  construye `handle()` después de validar (sección 4). Toda consulta lleva los
  dos filtros; una prueba recorre el `store` y falla si alguna URL de PostgREST
  sale sin `empresa_id=eq.` y `project_id=eq.`.
- **Claves foráneas compuestas**: cada tabla hija lleva `empresa_id` y
  `project_id` y apunta a su padre por `(empresa_id, project_id, id)`. Así es
  **imposible** en la base de datos ligar un ensayo de la empresa A a un lote de
  la empresa B, aunque el servidor tuviera un error.
- Las funciones SQL que escriben reciben `p_empresa_id` y `p_project_id` y
  comprueban que el proyecto es de esa empresa y que la licencia está vigente.
- Pruebas de acceso cruzado (servicio sobre `memoryStore` y SQL con PGlite): un
  usuario de A no lee, no crea y no cambia nada de B; nadie cambia su propio rol
  ni su licencia llamando la API directamente.

**Recomendación: opción B.** Mantiene un solo modelo de seguridad en todo el
repositorio, no agrega secretos, y con las claves compuestas el aislamiento
también lo hace cumplir PostgreSQL, que es lo que busca la especificación. Si el
dueño prefiere la A, se propone como fase aparte (pregunta D2).

## 6. Bitácora que no se puede cambiar

- **Tabla solo-inserción** `obra_bitacora` con tres barreras:
  1. Permisos: el rol de servicio solo tiene `select, insert` (se revocan
     `update`, `delete`, `truncate`).
  2. Trigger que rechaza `update`, `delete` y `truncate` aunque alguien recupere
     esos permisos (como `compras_auditoria_inmutable`, `compras.sql:108-125`).
     La clave de servicio de Supabase no es dueña de la tabla ni superusuario: no
     puede desactivar triggers, y PostgREST no ejecuta instrucciones que cambien
     tablas.
  3. **Hash encadenado:** cada fila guarda `hash = SHA-256(hash anterior + datos
     de la fila)`, calculado **dentro de PostgreSQL** en el `insert` (extensión
     `pgcrypto`), con un bloqueo por empresa para que dos inserciones no tomen el
     mismo "anterior". Una función `obra_bitacora_verificar(empresa)` recalcula la
     cadena y dice la primera fila alterada. Esto cubre lo único que las dos
     barreras anteriores no cubren: alguien con el usuario `postgres` en el SQL
     Editor. No impide el cambio, pero lo deja **en evidencia**. El JSON se
     convierte a texto con `jsonb::text`, que siempre sale igual para el mismo
     contenido (por eso no importa que jsonb no conserve el orden de las claves).
- **Qué se registra:** fecha del servidor, empresa, proyecto, quién (ID y nombre
  de Trimble), acción, módulo, objeto (tipo e id), IFCGUID + modelo + versión
  cuando aplica, versión del registro antes y después, **solo los campos que
  cambiaron** (antes → después), motivo (obligatorio en anulaciones y rechazos),
  resultado (`ok`, `denegado`, `error`) y origen (menú o visor). Los intentos
  **denegados** también quedan (como `denegar()` de Compras).
- **Qué no se registra nunca:** tokens, encabezado `Authorization`, URLs firmadas
  de subida o descarga, claves, contenido de archivos. Solo la huella SHA-256 y
  el id del archivo en Trimble.
- Los registros con valor (ensayos, inspecciones, cantidades aceptadas) **no se
  corrigen encima**: se anulan con motivo y se crea uno nuevo que dice a cuál
  reemplaza.

## 7. Riesgos

| Riesgo | Efecto | Qué se hace |
|---|---|---|
| Reexportación del modelo con IFCGUID nuevos (doc §15) | Los registros quedan ligados a elementos que "desaparecen" | Alerta de estabilidad al leer una versión; nunca se reasigna solo (diseño 4.3) |
| Metodología de costos y avance sin acordar del todo (doc §15) | Indicadores discutibles | Fórmulas por defecto escritas en el diseño (sección 6) y visibles en cada indicador; se cambian solo con aprobación |
| Copia de seguridad independiente del CDE (doc §9) | Confundir "está en el CDE" con "tiene respaldo" | Decisión D10 del diseño |
| Escritura en el CDE sin probar en un proyecto real | Documentos y fotos podrían no respaldarse | Hacer la prueba de escritura de Compras antes de la Fase 7 |
| `GET /files/{id}/versions` sin confirmar | La lista de versiones desde el menú podría no salir así | Prueba de lectura en la Fase 4; si no sirve, las versiones se conocen solo desde el visor (`getModels`) |
| Comparar versiones obliga a cargar cada versión en el visor | Lento en modelos grandes | Huellas guardadas por versión; se compara contra la última leída; barra de avance |
| Elementos de Presupuesto se borran al quitar partidas | Registros "huérfanos" | Identidad propia del elemento; se marca "sin partida vigente", no se borra |
| Partidas con unidades que no reconoce `medidaDeUnidad` | No se puede sumar con el modelo | Se muestran "unidad sin magnitud" y no se suman |
| Cifras de costo en dos sitios (Compras y Control de Obra) | Doble conteo | Lo comprometido se **lee** de Compras; Control de Obra registra solo lo que no esté allá, con índice único por fuente y referencia |
| Fotos y datos de personas en documentos | Ley 1581 (datos personales) | Párrafo nuevo en la política de datos **como propuesta**; no se toca la página legal sin aprobación |
| Límite de 4,5 MB por petición en Vercel | Archivos grandes | Envío directo a la URL firmada de Trimble (patrón de Compras) |
| Concurrencia en cortes y configuraciones | Pisar el trabajo de otro | Versión optimista y 409 en todo lo editable |

## 8. Plan por fases y qué verás al final de cada una

| Fase | Qué se construye | Qué verás tú |
|---|---|---|
| 3 | Base comercial (doc §13): empresas, licencias con módulos habilitados, usuarios, roles, administradores de empresa y de proyecto, bitácora; vínculo empresa ↔ proyectos; configuración de la estructura de obra (niveles y nodos); arreglo de `npm test` | Extensión "Control de Obra" instalable en el menú del proyecto. Como administrador técnico: crear una empresa, darle licencia, vincular el proyecto, nombrar administrador. Pestañas "Proyectos y estructura de obra", "Administración" y "Bitácora". Una persona sin rol ve "sin acceso". |
| 4 | Integración BIM: modelos, versiones, elementos por IFCGUID, mapeo de niveles a propiedades, calidad del GUID, panel del visor | Panel "Control de Obra" en el visor: seleccionar elementos y ver su ficha y sus niveles (torre, zona, nivel…); "Leer versión" guarda la huella; nuevos / cambiados / eliminados entre versiones; cola de "IFCGUID faltante o dudoso"; alerta de reexportación. |
| 5 | Cantidades (presupuestada a pendiente), conversiones, costos (base, vigente, planificado, comprometido, real, estimado), avance físico ponderado, reportes de cantidades, costos y avance | Pestañas "Cantidades y costos" y "Avance físico", con cada cifra rotulada por su fuente y cada indicador con su regla; filtros por la estructura de obra; Excel. |
| 6 | Calidad: materiales configurables, criterios aprobados por el responsable técnico, lotes, muestras, ensayos, inspecciones con sus 7 estados, NC, aceptación | Pestaña "Calidad, inspecciones y aceptación" y "No conformidades"; cumple / no cumple ensayo por ensayo; "Aceptar" bloqueado mientras falte algo; colores en 3D por estado de inspección. |
| 7 | Documentación (doc §13): documentos, fotos y certificados en el CDE, sincronización y recuperación de errores, expediente descargable (D10); panel de control consolidado | Botón "Adjuntar" con estado pendiente / sincronizado / fallido y reintento; cola de pendientes; "Descargar expediente"; panel de control. |
| 8 | Validación y despliegue: pruebas finales de acceso cruzado, manifiestos, README, manual básico de uso e instalación, guía de capacitación | URLs de instalación definitivas, manual y lista de verificación para probar con personas de distintos roles. |

## 9. Informe de la sección 3 del documento y contraste con el resto

### 9.1 Sección 3 — Arquitectura general, punto por punto

| Lo que pide el documento | Situación en el código | Cómo queda |
|---|---|---|
| Extensión **independiente** de Presupuesto y de los demás módulos | Cada extensión tiene sus páginas, API, `lib/`, componentes y `.sql` propios (p. ej. Compras: `app/compras/`, `lib/compras/`, `supabase/compras.sql`) | `app/control-obra/`, `lib/control-obra/`, `components/control-obra/`, `supabase/control-obra.sql`, manifiestos propios. No modifica archivos de otras extensiones. |
| Compartir datos por el **mismo proyecto Supabase** | Todas usan la misma base con su prefijo (`presupuesto_`, `compras_`, `propiedades_`, `manuales_`, `validacion_`) | Prefijo `obra_` en la misma base |
| **No duplicar catálogos** ni crear fuentes paralelas | Catálogos y presupuesto en `presupuesto_*`; comprometido y recibido en `compras_*`; atributos por IFCGUID en `propiedades_valores` | Se leen; Control de Obra solo agrega lo que no existe (sección 1). Capítulos, actividades y paquetes salen de Presupuesto; los niveles propios pueden leer atributos de Propiedades. |
| Integración por **identificadores y contratos de datos documentados** | Compras ya lee Presupuesto con un módulo de solo lectura (`lib/compras/presupuestoLectura.ts:28`) | Contratos escritos en el diseño (sección 9) con una prueba de contrato por fuente. |
| Trimble Connect: proyecto activo, modelos, elementos, propiedades y CDE | Proyecto activo: `api.project.getProject` (`components/trimble/ExtensionShell.tsx:117`); modelos y propiedades por el visor (sección 3.1); CDE por API Core (`lib/compras/cde.ts`) | Igual; lo que falta confirmar está en la sección 3.2. |
| Supabase/PostgreSQL: datos, relaciones, reglas, permisos y auditoría | Reglas críticas en funciones SQL con bloqueo y triggers (`supabase/compras.sql`, sección 7 de `compras.md`) | Mismo patrón; permisos revisados también dentro de las funciones SQL. |
| Administración y licencias: empresas, usuarios, roles, permisos, vigencias, funcionalidades contratadas | No existe a nivel empresa; Manuales tiene licencias por correo (`supabase/manuales.sql:33-45`) | Tablas `obra_empresas`, `obra_licencias` (con módulos habilitados), `obra_usuarios`, `obra_roles`, `obra_asignaciones`. |
| **La autenticación de Trimble no equivale a la de Supabase**; verificar cómo se identifica y autoriza en cada sistema | Comprobado: no hay Supabase Auth. El usuario se identifica con su token de Trimble (`requestPermission("accesstoken")`, `ExtensionShell.tsx:121`), el servidor lo valida contra Trimble (`resolveCaller`, `lib/propiedades/caller.ts:22-74`) y habla con Supabase con la clave de servicio, que nunca llega al navegador | Igual. La autorización (empresa, licencia, rol) la decide el servidor con datos propios en Supabase y la repiten las funciones SQL. El token de Trimble no se usa como token de Supabase. |

### 9.2 Resto del documento: qué cambió en el diseño

| Sección del documento | Ya cubierto en la versión 1 | Agregado en la versión 2 del diseño |
|---|---|---|
| §2, §4.1, §5 Estructura de obra (torre, etapa, capítulo, actividad, paquete, zona, nombre de zona, nivel, frente, disciplina) | Solo mapeo de jerarquía al modelo | Tablas `obra_niveles` y `obra_nodos` con responsables, fechas y estados; capítulo, actividad y paquete leídos de Presupuesto; filtros por todos los niveles |
| §4.2 Versiones y elementos no encontrados | Huellas, elementos que no están en la última versión | Calidad del IFCGUID (disponibilidad, unicidad, estabilidad) con alerta de reexportación |
| §4.3, §6.1 Estados de cantidad | Reportada, verificada, aceptada | Rechazada con motivo, pendiente calculada (tres variantes), fuente de cada dato, ajustes sin sobrescribir, `clave_idempotencia` contra duplicados por reenvío |
| §4.4 Costos | Real, comprometido, estimado | Presupuesto base y vigente, planificado, costo unitario real, desviaciones y proyección con fórmula visible |
| §4.5, §6.2 Avance | Ponderación por valor presupuestal | Planificado, reportado, verificado y aceptado; cantidades homogéneas dentro de una partida; responsable, evidencia y metodología en cada corte |
| §4.6, §7.1-7.3 Calidad | Criterios, lotes, ensayos | Materiales configurables con documentos obligatorios; muestras con edades; fabricante, diámetros y certificados; inspección de recepción |
| §4.7, §7.4 Estados de inspección | Conforme / no conforme | Los 7 estados del documento; "aceptado con observaciones" solo si el proyecto lo permite (D12) |
| §7.5 Indicadores de calidad | Promedios que no ocultan incumplimientos | Inspeccionados, aceptados, rechazados, pendientes, NC abiertas y cerradas, cumplimiento documental, todos con numerador y denominador |
| §8 Bitácora | Lo pedido | Referencia a la evidencia; activación, suspensión y renovación de licencias como eventos |
| §9 CDE | Lo pedido | Revisar carpetas antes de crear, reemplazos de documentos, historial de sincronización, copia independiente (D10) |
| §10 Roles y autorización | Administrador técnico y de empresa | Administrador de proyecto; roles con los nombres del documento (D13); permisos sin caché para revocación inmediata; módulos no contratados bloqueados |
| §11 Datos y seguridad | RLS cerrado, claves compuestas | Muestras, sincronización, migraciones con constancia de versión (D11) |
| §12 Interfaz | Pestañas | Navegación en el orden del documento, filtros comunes, cada indicador con fecha de corte, alcance, fuente y regla |
| §13 Plan | Fases 3 a 8 | Plan de pruebas (diseño, sección 12); manual básico y capacitación en la Fase 8 |
| §14 Criterios de aceptación | — | Tabla criterio → fase (diseño, sección 13) |
| §15 Riesgos | Varios | Riesgos agregados en la sección 7 de este archivo |
