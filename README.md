# Extensiones para Trimble Connect

Este repositorio es una sola app Next.js (desplegada en Vercel) que contiene
**dos extensiones de proyecto** para Trimble Connect:

| Extensión | Página que se embebe | Manifiesto |
|---|---|---|
| **Resumen Archivos** — estadísticas de los documentos del proyecto | `/extension` | `/manifest.json` |
| **Validación** — valida la nomenclatura de los archivos contra reglas configurables | `/validacion` | `/manifest-validacion.json` |

Las dos comparten la conexión con Trimble Connect
([`components/ExtensionShell.tsx`](components/ExtensionShell.tsx)), el acceso a
la API REST ([`lib/trimbleApi.ts`](lib/trimbleApi.ts)) y el recorrido
recursivo de carpetas ([`lib/walkProjectTree.ts`](lib/walkProjectTree.ts) +
[`lib/cache.ts`](lib/cache.ts)).

- [Resumen Archivos](#resumen-archivos)
  - [Estructura de Carpetas (pestaña)](#estructura-de-carpetas-pestaña)
- [Validación](#validación)
- [Cómo funciona (común a ambas extensiones)](#cómo-funciona-común-a-ambas-extensiones)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Configurar y desplegar en Vercel](#configurar-y-desplegar-en-vercel)
- [Registrar las extensiones en Trimble Connect](#registrar-las-extensiones-en-trimble-connect)

---

## Resumen Archivos

Extension de proyecto para Trimble Connect que agrega un panel "Resumen Archivos"
al menu lateral. Al abrirlo, recorre recursivamente todas las carpetas del
proyecto activo, agrupa los documentos por tipo (extension) y muestra:

- Tarjetas resumen: total de archivos, tipos distintos, tamano total ocupado.
- Grafico de dona: cantidad de archivos por tipo (top tipos + "Otros").
- Grafico de barras: tamano ocupado por tipo (top tipos + "Otros").
- Linea de tiempo del crecimiento acumulado de documentos, con vista semanal y
  mensual, desde la fecha del documento mas antiguo hasta hoy.
- Al hacer clic en cualquier tipo (o en "Otros"), una tabla con el detalle de
  esos archivos: nombre, carpeta, tamano, quien lo subio, fecha y version, con
  busqueda, orden por columna, paginacion y un boton "Abrir" al visor de
  Trimble Connect.
- Boton "Cargados en los ultimos 7 / 15 / 30 dias".

El panel tiene dos pestañas arriba: **Resumen** (lo anterior) y
**Estructura de Carpetas**.

### Estructura de Carpetas (pestaña)

Árbol jerárquico (tipo EDT/WBS) de todas las carpetas y archivos del
proyecto, construido a partir de **los mismos datos** que ya recorre y
cachea el dashboard "Resumen" (`lib/cache.ts` + `lib/walkProjectTree.ts`) —
no hay un segundo recorrido, así que los conteos de archivos siempre
coinciden entre ambas pestañas, y si "Resumen" ya cargó, abrir esta pestaña
es prácticamente instantáneo. El árbol completo (carpetas + archivos, ya
anidado y con conteos recursivos) se construye del lado del servidor en
[`lib/folderTree.ts`](lib/folderTree.ts) (`buildTree`, cubierto por
`lib/folderTree.test.ts`) y se sirve en una sola respuesta desde
[`/api/tree`](app/api/tree/route.ts), que sigue el mismo contrato `202` +
progreso que `/api/summary` mientras el recorrido no ha terminado.

- **Carga diferida real**: como el árbol completo ya viaja en un solo JSON
  (barato: es la misma data que "Resumen" ya tiene cacheada), la "carga
  diferida" se aplica donde de verdad importa para el rendimiento — el
  **renderizado**. El árbol abre con solo el primer nivel visible (nada
  expandido), cada carpeta se expande/contrae individualmente, y las filas
  se pintan con `react-window` (lista virtualizada): con miles de nodos
  expandidos solo se montan en el DOM las filas realmente visibles.
- **Conteo por carpeta**: recursivo (carpeta + todas sus subcarpetas),
  mostrado junto al nombre ("124 archivos en total").
- **Color por nivel**: Nivel 1 (carpetas raíz del proyecto) a Nivel 6, cada
  uno con un color fijo; Nivel 7 en adelante comparte un único color
  adicional. Paleta y asignación en `lib/folderTree.ts`
  (`LEVEL_COLORS` / `colorForLevel`). Leyenda fija arriba del árbol.
- **Buscador**: por nombre de carpeta o archivo, insensible a
  mayúsculas/acentos (`normalizeForSearch` en `lib/folderTree.ts`), busca en
  todo el árbol (no solo lo expandido). Con una sola coincidencia, expande
  el camino y hace scroll hasta ella; con varias, muestra una lista para
  elegir.
- **Persistencia del expand/collapse**: solo en `localStorage` del
  navegador, con clave por proyecto (`lib/folderTreeClient.ts`) — nunca se
  manda al backend ni se comparte entre usuarios.
- **Permisos por carpeta**: el ícono 👤 de cada carpeta abre un panel lateral
  con quién tiene acceso, su nivel (`READ`, `FULL_ACCESS`, `NO_ACCESS` — la
  terminología exacta de la API) y si el permiso es directo o heredado (y de
  qué carpeta). Ver la sección siguiente para el detalle de cómo se resuelve
  esto contra la API de Trimble Connect.

  **Endpoint confirmado contra la documentación vigente**
  (https://developer.trimble.com/docs/connect/tools/api/core, OpenAPI del
  Core API — sección Folders), y verificado con una llamada real (Postman,
  token OAuth de Authorization Code) contra un proyecto de producción:
  `GET /folders/fs/{folderId}/permissions?fields=inherited` devuelve, en una
  sola respuesta, los permisos directos y heredados ya separados:
  ```json
  {
    "directPermissions": { "acl": { "READ": ["users:...", "tc-groups:..."] }, "inheritance": false },
    "inheritedPermissions": { "acl": {} }
  }
  ```
  (La documentación no deja claro este anidado; se confirmó empíricamente
  porque la respuesta real no coincidía con el esquema documentado.) Por eso
  `lib/permissions.ts`:
  1. Pide el permiso de la carpeta con una sola llamada (`directPermissions`
     + `inheritedPermissions`, sin necesidad de diffear dos respuestas).
  2. Trimble ya distingue directo de heredado; lo único que la API no dice es
     de qué carpeta ancestro viene cada entrada heredada. Para eso se sube
     por la cadena de carpetas ancestras (que el frontend ya conoce, por
     venir del árbol que renderizó — no hay que volver a resolverla) pidiendo
     el `directPermissions.acl` de cada una, y se usa la más cercana que
     contenga ese mismo usuario/grupo como "carpeta de origen". Si no se
     encuentra (caso raro), se muestra igual como "Heredado" sin carpeta de
     origen.
  3. Los identificadores `users:{id}` / `tc-groups:{id}` (y el grupo virtual
     `tc-groups:*`, "todos los miembros") se resuelven a nombre/correo con
     `GET /projects/{projectId}/users` y `GET /groups?projectId=...`,
     cacheados 5 minutos en memoria por proyecto.

---

## Validación

Extensión que valida **el nombre de los archivos** del proyecto contra reglas
de nomenclatura que define el propio administrador (no hay un estándar fijo:
la herramienta es configurable). Solo mira el nombre del archivo; no valida
metadatos ni propiedades personalizadas de Trimble Connect.

Tiene dos pestañas: **Resultados** y **Configuración**, y un botón
**Analizar** siempre visible arriba a la derecha.

### Pantalla de Configuración

Hay exactamente **dos plantillas fijas**: «Información Gráfica» e «Información
No Gráfica». Para cada una:

1. **Extensiones asignadas** (por ejemplo `rvt, dwg, ifc` para Gráfica y
   `docx, xlsx, pdf` para No Gráfica). Se escriben separadas por coma/espacio y
   quedan como «chips». Una extensión solo puede estar en una plantilla; si
   intentas agregar una que ya está en la otra, se ofrece **«Moverla a…»**.
   Las extensiones que no estén en ninguna plantilla se listan como
   **«Sin clasificar / Requiere revisión»**.
   - Si asignas **`pdf` a «Información Gráfica»** aparece una **advertencia
     visual no bloqueante** (por convención de la empresa el PDF nunca se
     considera información gráfica). Puedes dejarlo y guardar igual, o quitarlo
     con el botón del aviso.
2. **Campos del nombre** (sin la extensión), en orden. Cada campo tiene:
   - **Nombre** descriptivo (p. ej. «Proyecto»).
   - **Tipo de regla**:
     - *Código fijo*: debe ser exactamente un valor (p. ej. `ODR`).
     - *Lista de valores permitidos*: debe coincidir con uno de la lista
       (p. ej. `ARQ, EST, INS, MEC`).
     - *Texto libre*: cualquier texto hasta N caracteres.
     - *Número*: solo dígitos, con una cantidad exacta de caracteres.
   - **Obligatorio u opcional**.
   - Se pueden **agregar, quitar y reordenar** (↑ ↓).
   - **Máximo un campo de texto libre por plantilla.** Si intentas elegir
     «Texto libre» en un segundo campo, el formulario no lo permite y explica
     por qué: el analizador ubica los campos de longitud conocida desde ambos
     extremos del nombre y le asigna al único campo de texto libre lo que queda
     en el medio; con dos campos de longitud variable no habría forma
     determinista de saber dónde termina uno y empieza el otro.
3. **Separador entre cada par de campos, independiente** (p. ej. `-` entre el
   campo 1 y el 2, pero `_` entre el 2 y el 3). Son posicionales: al reordenar
   campos, los separadores se quedan en su lugar.
4. **Vista previa en vivo** del nombre resultante (campos en azul, separadores
   en ámbar, campos opcionales con borde punteado).

Debajo hay un **Probador de nombres**: escribes o pegas nombres de archivo (con
extensión, uno por línea) y ves al instante si cada uno es CONFORME, NO
CONFORME o SIN CLASIFICAR, cómo se partió en campos (con colores) y los motivos
específicos. **Evalúa la configuración que estás editando, aunque todavía no
esté guardada**, así puedes comprobar una regla antes de guardarla.

El botón **Guardar configuración** valida el formulario (campos con nombre,
valores en las reglas, separadores no vacíos, etc.) y muestra qué corregir.

### Cómo se guarda y se recupera la configuración por proyecto

- Se guarda en **Supabase** (Postgres, tabla `validacion_config`) o, si no hay
  Supabase conectado, en **Upstash Redis** (la integración de Redis del
  Marketplace de Vercel, que reemplazó a Vercel KV), como **un valor JSON por
  proyecto de Trimble Connect**: la clave es el ID del proyecto (`project_id` en
  Supabase, `validacion:config:{projectId}` en Redis).
- Como la clave es el ID del proyecto, la configuración **persiste entre
  sesiones y la comparten todos los usuarios de ese proyecto**; cada proyecto
  tiene la suya.
- Al abrir la extensión, se lee con `GET /api/validacion/config?projectId=…`; al
  guardar, se envía con `PUT` a la misma ruta. El servidor la vuelve a validar
  (nunca confía en el navegador) y le pone la marca `updatedAt`.
- Las rutas exigen el access token de Trimble Connect **y comprueban que ese
  usuario sea miembro del proyecto** (`GET /projects/me`), así nadie puede leer
  o pisar la configuración de un proyecto solo conociendo su ID. No se
  restringe por rol: se asume que quien abre la pantalla de configuración tiene
  permiso.
- Sin la base de datos conectada, en producción las rutas responden 503 con un
  mensaje claro (no se pierde nada en silencio). Solo en `npm run dev` hay un
  respaldo en memoria para poder desarrollar sin base de datos.

### Análisis (bajo demanda)

Solo se ejecuta cuando el usuario pulsa **Analizar**; nunca automático ni
programado.

1. Obtiene el proyecto activo por el Workspace API.
2. Recorre recursivamente todas las carpetas (todas las profundidades) usando
   solo los metadatos de la versión más reciente de cada archivo. El botón
   descarta el caché del recorrido para ver el proyecto tal como está *ahora*.
   Con proyectos grandes muestra el progreso («N archivos encontrados…»).
3. Asigna cada archivo a su plantilla por extensión (o «Sin clasificar»).
4. Compara el nombre (sin extensión) contra los campos y separadores de esa
   plantilla. Si cumple todo, es **CONFORME**; si no, **NO CONFORME** con el
   campo y el motivo específico, por ejemplo:
   - `Disciplina: se encontró 'XYZ', no está en la lista de códigos permitidos [ARQ, EST, INS, MEC]`
   - `Falta el campo Descripción`
   - `Separador incorrecto entre el campo 2 (Disciplina) y el campo 3 (Descripción): se esperaba '_' y se encontró '-'`
   - `Número: se encontró '01'; debe tener exactamente 3 dígitos (tiene 2)`

Reglas del analizador (ver [`lib/validacion/matcher.ts`](lib/validacion/matcher.ts)):

- Los códigos fijos y las listas se comparan **exactamente, distinguiendo
  mayúsculas y minúsculas** (`arq` no es `ARQ`; el mensaje lo aclara).
- El texto libre puede contener el separador (`SAT_ARQ_Detalles_de_obra` es
  válido), pero no puede empezar ni terminar con el separador adyacente
  (separador duplicado) ni pasar de la longitud máxima.
- Un **campo opcional** ausente hace que también se omita el separador que
  lo sigue. Ojo: si el valor de un opcional no está en su lista pero cabe en el
  texto libre siguiente, el nombre puede quedar conforme (el texto libre acepta
  cualquier cosa).
- Implementación: búsqueda de costo mínimo (programación dinámica) sobre el
  nombre; costo 0 = conforme, y el análisis de menor costo da el diagnóstico
  más plausible. Con un único campo de texto libre equivale a anclar los campos
  exactos desde ambos extremos y darle al texto libre lo que sobra. Analiza
  9.000 archivos en ~150 ms.

Con la configuración de ejemplo del enunciado (No Gráfica: `docx, xlsx, pdf`;
Proyecto ∈ [SAT, ODR, NDB] `_` Disciplina ∈ [ARQ, EST, INS, MEC] `_`
Descripción texto ≤ 40):

| Archivo | Resultado |
|---|---|
| `SAT_ARQ_DetallesCarpinteriaMecanica.pdf` | CONFORME |
| `SAT-ARQ-DetallesCarpinteria.pdf` | NO CONFORME (separador: se esperaba `_` y se usó `-`) |
| `SAT_XYZ_Detalles.pdf` | NO CONFORME en Disciplina (`XYZ` no está en la lista) |

Estos tres casos y otros (campos faltantes, longitudes, números, opcionales,
texto en el medio…) están cubiertos por pruebas automáticas: `npm test`.

### Resultados (dashboard interactivo)

- **Tarjetas**: cumplimiento general, Información Gráfica, Información No
  Gráfica y Sin clasificar. El porcentaje es *conformes ÷ archivos con
  plantilla*; los «Sin clasificar» no entran en el porcentaje (se muestran
  aparte). **Las tarjetas son clicables** y filtran la tabla.
- **Gráficos clicables**: dona «Estado de los archivos» (clic en una porción
  para ver esos archivos) y «Campos que más fallan» (clic en una barra para
  filtrar por ese campo).
- **Tabla** de archivos **no conformes** (archivo, carpeta, plantilla aplicada,
  campo(s) que fallaron, motivo específico, «Abrir» al visor de Trimble
  Connect) con paginación, **búsqueda mientras escribes** y filtros con «chips»
  que se pueden quitar. Otra pestaña lista los **Sin clasificar**, con las
  extensiones más frecuentes como botones para filtrar.
- **Exportar a Excel (.xlsx) o CSV** lo que se está viendo (respeta los
  filtros; el botón muestra cuántas filas exporta). El CSV lleva BOM UTF-8 y
  neutraliza celdas que empiecen con `= + - @` (inyección de fórmulas).

---

## Cómo funciona (común a ambas extensiones)

- **Frontend**: Next.js (App Router) + React, usando el paquete oficial
  `trimble-connect-workspace-api` para detectar que la app corre embebida
  dentro de Trimble Connect y obtener el proyecto activo. Los graficos usan
  `recharts`.
- **Backend**: API routes de Next.js (funciones serverless en Vercel) que
  llaman a la API REST de Trimble Connect, recorren el arbol de carpetas y
  devuelven los datos ya agregados. Aqui vive tambien el cache en memoria.
- **Autenticacion**: la extension NO implementa un flujo OAuth Authorization
  Code propio. Se apoya en el metodo que el SDK expone justamente para
  extensiones de confianza embebidas en un proyecto:
  [`API.extension.requestPermission("accesstoken")`](https://components.connect.trimble.com/trimble-connect-workspace-api/interfaces/ExtensionAPI.html#requestPermission).
  Trimble Connect ya gestiona la sesion del usuario dentro del iframe; al
  llamar este metodo se le pide consentimiento al usuario y, si lo acepta,
  Trimble Connect entrega (y renueva automaticamente) un access token de ese
  usuario, valido para llamar la API REST. Esto esta confirmado contra la
  documentacion oficial:
  - Guia de autenticacion general: https://developer.trimble.com/docs/connect/getting_started
  - Guia de extensiones: https://developer.trimble.com/docs/connect/guides/extend/
  - Referencia del Workspace API: https://components.connect.trimble.com/trimble-connect-workspace-api/index.html

  Por eso las variables `TRIMBLE_CLIENT_ID` / `TRIMBLE_CLIENT_SECRET` de la
  app OAuth registrada ("apibasedatos") **no son necesarias para que las
  extensiones funcionen** dentro de Trimble Connect. Se dejan documentadas en
  `.env.example` unicamente por si en el futuro se quiere agregar un flujo
  OAuth independiente (uso fuera de Trimble Connect, Postman, acceso no
  interactivo, etc.). El Client Secret nunca va en el codigo ni en git.
  Cada extension tiene su propio consentimiento: al abrir "Validacion" por
  primera vez Trimble Connect vuelve a pedir autorizacion.
- **Region del proyecto**: cada proyecto de Trimble Connect vive en una
  region especifica (US, EU, UK, AP...). El backend resuelve automaticamente
  el host regional correcto combinando `GET /projects/me` (que indica la
  `location` del proyecto) con `GET /regions` (que mapea esa `location` al
  host de API correspondiente), sin necesidad de configuracion manual.
- **Recorrido de carpetas**: se usa `GET /folders/{id}/items` de forma
  recursiva desde la carpeta raiz del proyecto (`rootId`), sin limite de
  profundidad, paginando con el header `Range` que expone la API. El tamano,
  fecha y usuario de cada archivo que devuelve ese endpoint ya corresponden a
  su version mas reciente (un archivo con varias versiones sigue siendo una
  sola fila), por lo que no se hace una llamada adicional por archivo a
  `/files/{id}/versions`.
- **Cache**: el resultado del recorrido se cachea en memoria en el servidor
  por proyecto durante 8 minutos (`lib/cache.ts`); pasado ese tiempo el
  proyecto se vuelve a recorrer. En Vercel esto significa que una misma
  instancia "tibia" reutiliza el resultado; un cold start lo recalcula. Es
  intencionalmente simple (sin Redis para el caché del recorrido).
- **Proyectos grandes (miles de archivos)**: el recorrido usa un pool de 16
  llamadas en paralelo (en vez de esperar de a lotes fijos, cada llamada que
  termina recoge inmediatamente la siguiente carpeta pendiente), y esta
  particionado en pasos de ~8 segundos (`CRAWL_BUDGET_MS` en `lib/cache.ts`)
  para no arriesgar el limite de duracion de las funciones serverless de
  Vercel. Mientras el recorrido no termina, las rutas responden `202` con el
  progreso (archivos y carpetas ya visitados), y el frontend
  (`lib/apiClient.ts`) reintenta automaticamente cada ~1.2s mostrando ese
  progreso ("N archivos encontrados..."), hasta que el recorrido completo
  queda cacheado.

## Visor de Trimble Connect

El boton "Abrir" del listado de archivos (en ambas extensiones) abre el
archivo en una pestaña nueva usando el visor web de Trimble Connect:

- Archivos 3D (RVT, IFC, SKP, NWD/NWC, DGN, DWG, STEP, OBJ, FBX, glTF, etc. -
  ver `THREE_D_EXTENSIONS` en `lib/format.ts`):
  `https://web.connect.trimble.com/projects/{projectId}/viewer/3d?modelId={fileId}&versionId={versionId}`
  (segun la seccion "Query parameters" de la documentacion del Workspace API).
- Cualquier otro archivo (PDF, DOCX, XLSX, imagenes, etc.):
  `https://web.connect.trimble.com/projects/{projectId}/viewer/2D?id={fileId}&version={versionId}`
  (confirmado contra una URL real copiada de una sesion de Trimble Connect).

Si encuentras un tipo de archivo 3D que se abre en el visor equivocado,
solo hay que agregar su extension a `THREE_D_EXTENSIONS` en
[`lib/format.ts`](lib/format.ts).

## Estructura del proyecto

```
app/
  page.tsx                    Pagina informativa (no es una extension)
  extension/                  Resumen Archivos (pagina embebida)
  validacion/                 Validacion (pagina embebida)
  api/summary, api/files      API de Resumen Archivos
  api/tree                    Arbol de carpetas (pestaña "Estructura de Carpetas")
  api/folder-permissions      Permisos (directos/heredados) de una carpeta
  api/validacion/config       GET/PUT de la configuracion por proyecto
  api/validacion/analyze      Ejecuta el analisis (boton "Analizar")
  api/validacion/results      Pagina de resultados (con filtros)
  api/validacion/export       Descarga .xlsx / .csv
components/
  ExtensionShell.tsx          Conexion con Trimble Connect (compartida)
  Dashboard.tsx, ...          Resumen Archivos
  folderTree/                 Estructura de Carpetas: arbol, fila, panel de permisos
  validacion/                 Validacion: configuracion, probador, resultados
lib/
  trimbleApi.ts, walkProjectTree.ts, cache.ts   API REST y recorrido (compartidos)
  folderTree.ts                Construye el arbol anidado + colores por nivel (server)
  folderTreeClient.ts          Aplanado para react-window, busqueda, localStorage (cliente)
  permissions.ts                Resuelve permisos directos/heredados de una carpeta
  access.ts                   Comprueba que el token sea de un miembro del proyecto
  validacion/                 Analizador, configuracion, filtros, exportacion,
                              almacenamiento (Supabase o Upstash Redis) y pruebas
public/
  manifest.json, icon.svg                       Resumen Archivos
  manifest-validacion.json, icon-validacion.svg Validacion
```

## Configurar y desplegar en Vercel

1. **Sube este repositorio a GitHub** y conectalo a un nuevo proyecto en
   Vercel (Import Project → selecciona el repo). Vercel detecta Next.js
   automaticamente, no requiere configuracion adicional.

2. **Base de datos para "Validación" (una sola vez).** La configuración de
   nomenclatura se guarda en Supabase (o, alternativamente, en Upstash Redis):
   - En Vercel, abre el proyecto → **Storage** → **Create Database** →
     **Supabase** (el plan gratuito alcanza), y luego **Connect to Project** para
     conectarla a este proyecto (entornos Production y Preview).
   - Vercel agrega solo las variables (`SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL`,
     y `SUPABASE_SERVICE_ROLE_KEY`). La clave de servicio se usa únicamente en el
     servidor y no llega al navegador.
   - **Crea la tabla** (una sola vez): en Supabase → **SQL Editor**, pega y
     ejecuta el contenido de [`supabase/validacion_config.sql`](supabase/validacion_config.sql).
     La tabla queda con RLS activado y sin políticas: solo el servidor (clave de
     servicio) puede leer o escribir en ella.
   - **Vuelve a desplegar** (Deployments → ⋯ → Redeploy) para que el código lea
     las variables. Sin esto, «Validación» muestra "La base de datos de
     configuración no está conectada" (Resumen Archivos no la necesita).
   - *Alternativa:* Upstash Redis (Marketplace → **Upstash → Redis**). Agrega
     `KV_REST_API_URL` y `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` /
     `UPSTASH_REDIS_REST_TOKEN`) y no necesita crear tablas. Si hay ambas, se usa
     Supabase.

3. **Variables de entorno opcionales** (Project Settings → Environment
   Variables). No son necesarias para que las extensiones funcionen (ver
   seccion de autenticacion arriba), pero si quieres dejarlas configuradas
   para uso futuro:

   | Variable | Valor |
   |---|---|
   | `TRIMBLE_CLIENT_ID` | `31d42c3e-aacc-492e-a3a1-fd9903ae2c50` |
   | `TRIMBLE_CLIENT_SECRET` | (el Client Secret de la app "apibasedatos"; ponlo solo en Vercel, nunca en el repo) |
   | `TRIMBLE_REDIRECT_URI` | `https://trimble-docs.vercel.app/api/auth/callback` (o la que definas) |

4. **Despliega.** ✅ Ya desplegado: el dominio de produccion es
   `https://trimble-docs.vercel.app`.

5. **URLs que dependen del dominio final.** ✅ Ya hecho:
   [`public/manifest.json`](public/manifest.json) y
   [`public/manifest-validacion.json`](public/manifest-validacion.json)
   apuntan a `https://trimble-docs.vercel.app` (campos `url`, `icon`, `infoUrl`).

6. **⚠️ Recordatorio importante — Callback URL en el Trimble Developer
   Console:** la app OAuth "apibasedatos" (Client ID
   `31d42c3e-aacc-492e-a3a1-fd9903ae2c50`) esta registrada hoy con las
   callback URLs `https://oauth.pstmn.io/v1/callback` y `http://localhost`
   (usadas para pruebas con Postman/local). **Pendiente**: entra al Trimble
   Developer Console y agrega la URL de callback de produccion
   `https://trimble-docs.vercel.app/api/auth/callback`, o escribe a
   connect-support@trimble.com si necesitas que agreguen una nueva callback
   URL a la app ya registrada. Esto solo es relevante si en el futuro
   implementas el flujo OAuth Authorization Code completo; las extensiones tal
   como estan entregadas no lo necesitan para funcionar.

## Registrar las extensiones en Trimble Connect

Repite estos pasos por cada extensión (necesitas ser administrador del proyecto):

1. Abre el proyecto en Trimble Connect for Browser.
2. Ve a **Configuracion del proyecto → Apps & Capabilities**.
3. Selecciona **+ Add Custom** (arriba de la lista).
4. En **Capability Manifest URL**, escribe la URL del manifiesto:

   | Extensión | URL del manifiesto |
   |---|---|
   | Resumen Archivos | `https://trimble-docs.vercel.app/manifest.json` |
   | Validación | `https://trimble-docs.vercel.app/manifest-validacion.json` |

5. Selecciona **Add**. La extensión deberia aparecer en el menu lateral del
   proyecto, junto a las demas (Resumen Archivos con icono de carpeta azul;
   Validación con un documento con marca de verificación). Si no aparece,
   recarga la pestaña de Trimble Connect.
6. Al abrirla por primera vez, Trimble Connect pedira tu consentimiento para
   que la extension pueda leer el access token del usuario actual (esto es lo
   que permite leer los documentos del proyecto). Acepta el mensaje para que
   el panel cargue los datos.

Si en algun momento quieres revocar el permiso, puedes hacerlo desde la
configuracion de la extension dentro del proyecto.

## Desarrollo local

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # pruebas del analizador de nomenclatura (35+ casos)
```

Las paginas `/extension` y `/validacion` solo funcionan correctamente
**embebidas dentro de un iframe de Trimble Connect** (usan `window.parent`
para comunicarse via `postMessage`). Abrirlas directamente en el navegador
mostrara un mensaje indicando que deben abrirse desde dentro de Trimble
Connect; para probar cambios de verdad, hay que desplegar (o exponer el
`localhost` con una herramienta como ngrok) y registrar esa URL como
manifiesto temporal de prueba.

Para "Validación", en `npm run dev` sin variables de base de datos la
configuración se guarda en memoria (se pierde al reiniciar el servidor); para
probar la base de datos real, copia `.env.example` a `.env.local` y completa las
variables de Supabase (o de Upstash).

## Limitaciones conocidas / decisiones de diseño

- El cache del recorrido (8 minutos) vive en memoria del proceso serverless; no
  es compartido entre instancias frias de Vercel. Si una pagina de resultados
  cae en otra instancia, esa instancia vuelve a recorrer el proyecto (con
  indicador de progreso). La configuracion de "Validación" **no** tiene este
  problema: está en Redis.
- El cache se guarda por `projectId` (no por usuario), asumiendo el modelo
  de permisos por defecto de Trimble Connect donde todos los miembros del
  proyecto ven todos los archivos salvo restriccion explicita de carpeta.
- La extension siempre opera sobre el proyecto abierto en ese momento; no
  hay selector de proyectos.
- "Validación" no restringe la pantalla de configuración por rol (cualquier
  miembro del proyecto puede guardarla); la última en guardar gana.
- Las exportaciones se descargan como archivo desde el navegador; si Trimble
  Connect embebiera la extensión en un iframe con `sandbox` sin
  `allow-downloads`, el navegador podría bloquear la descarga.
