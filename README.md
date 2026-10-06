# Extensiones para Trimble Connect

Este repositorio es una sola app Next.js (desplegada en Vercel) que contiene
**dos extensiones de proyecto, una extensión del visor 3D y una que funciona en
ambos lugares** para Trimble Connect:

| Extensión | Dónde aparece | Página que se embebe | Manifiesto |
|---|---|---|---|
| **Resumen Archivos** — estadísticas de los documentos del proyecto | Menú lateral del proyecto | `/extension` | `/manifest.json` |
| **Validación** — valida la nomenclatura de los archivos contra reglas configurables | Menú lateral del proyecto | `/validacion` | `/manifest-validacion.json` |
| **Gráficos de Modelos** — gráficos con los datos de los modelos 3D cargados | Panel de extensiones del visor 3D | `/graficos` | `/manifest-graficos.json` |
| **Propiedades** — atributos propios asignados por IFCGUID a los elementos de los modelos | Menú lateral del proyecto (catálogo) **y** panel del visor 3D (asignación) | `/propiedades` | `/manifest-propiedades.json` |
| **Presupuesto** — presupuesto con catálogos de insumos y partidas (APU) bajo OmniClass, asociado a los modelos por IFCGUID | Menú lateral del proyecto (presupuesto) **y** panel del visor 3D (asociar elementos) | `/presupuesto` | `/manifest-presupuesto.json` |

Las dos extensiones de proyecto comparten la conexión con Trimble Connect
([`components/ExtensionShell.tsx`](components/ExtensionShell.tsx)), el acceso a
la API REST ([`lib/trimbleApi.ts`](lib/trimbleApi.ts)) y el recorrido
recursivo de carpetas ([`lib/walkProjectTree.ts`](lib/walkProjectTree.ts) +
[`lib/cache.ts`](lib/cache.ts)). "Gráficos de Modelos" es independiente: no usa
la API REST ni el backend, lee directamente del visor 3D. "Propiedades" usa
el visor para la selección y su propia base de datos (Supabase) para los valores.

- [Resumen Archivos](#resumen-archivos)
  - [Estructura de Carpetas (pestaña)](#estructura-de-carpetas-pestaña)
  - [Auditoría de Permisos (pestaña)](#auditoría-de-permisos-pestaña)
- [Validación](#validación)
- [Gráficos de Modelos (visor 3D)](#gráficos-de-modelos-visor-3d)
- [Propiedades (proyecto + visor 3D)](#propiedades-proyecto--visor-3d)
- [Presupuesto (proyecto + visor 3D)](#presupuesto-proyecto--visor-3d)
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

El panel tiene tres pestañas arriba: **Resumen** (lo anterior),
**Estructura de Carpetas** y **Auditoría de Permisos**.

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

### Auditoría de Permisos (pestaña)

Vista pensada para gerencia/dirección: en lugar de revisar carpeta por
carpeta con el panel 👤, recorre **todo el proyecto de una vez** y muestra
solo las carpetas que tienen algún permiso puesto directamente sobre ellas
(no heredado) — la gran mayoría de las carpetas no tiene ninguno y hereda
limpio, así que quedan fuera del reporte para no generar ruido.

- Se ejecuta **bajo demanda** con el botón "Ejecutar auditoría" (no corre
  sola al abrir la pestaña): revisar permisos cuesta una llamada a la API de
  Trimble por carpeta, así que en proyectos grandes puede tardar. Reutiliza
  el mismo recorrido de carpetas cacheado que "Resumen" y "Estructura de
  Carpetas" (`lib/cache.ts`), y solo paga el costo adicional de la propia
  revisión de permisos.
- Tres señales, cada una con su propia tarjeta-filtro:
  - **Abiertas a todo el proyecto**: la carpeta tiene un permiso directo para
    `tc-groups:*` ("todos los miembros del proyecto").
  - **Control total directo a una persona**: `FULL_ACCESS` otorgado
    directamente a un usuario (no a un grupo) — acceso que depende de que
    alguien recuerde revocarlo manualmente si esa persona cambia de rol o
    sale del proyecto, en vez de gestionarse por grupo.
  - **Herencia desactivada**: la propia carpeta reporta `inheritance: false`
    (ver la sección anterior) — un punto donde alguien rompió deliberadamente
    la herencia normal de la estructura.
- Cada carpeta se puede expandir para ver el detalle completo de sus
  permisos directos (igual que el panel 👤, pero sin necesidad de abrirlo
  carpeta por carpeta).
- Igual que "Estructura de Carpetas", el recorrido de permisos es resumible
  (`lib/permissionAudit.ts`, worker-pool de 16 + presupuesto de 8s por
  invocación — mismo patrón que `lib/walkProjectTree.ts`), así que proyectos
  con miles de carpetas se auditan en varias llamadas cortas en vez de una
  sola que arriesgue el límite de tiempo de la función serverless.
- Alcance actual: **un proyecto a la vez** (el que está abierto en la
  extensión). Una vista de portafolio con varios proyectos a la vez, o un
  envío automático/periódico por correo, quedan fuera de este primer
  alcance.

---

## Validación

Extensión que valida **el nombre de los archivos** del proyecto contra reglas
de nomenclatura que define el propio administrador (no hay un estándar fijo:
la herramienta es configurable). Solo mira el nombre del archivo; no valida
metadatos ni propiedades personalizadas de Trimble Connect.

Tiene tres pestañas: **Resultados**, **Duplicados** y **Configuración**, y un
botón **Analizar** siempre visible arriba a la derecha. Un solo clic en
**Analizar** recorre el proyecto una vez y alimenta las dos primeras
pestañas: la comprobación de nomenclatura (Resultados) necesita una plantilla
guardada, pero la de **Duplicados** no necesita ninguna configuración, así
que el botón nunca está bloqueado - si no hay plantillas guardadas solo se
buscan duplicados.

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

### Duplicados

Archivos con **el mismo nombre (incluida la extensión) en distintas
carpetas** - el típico "¿cuál de las dos es la vigente?" de los proyectos de
construcción. Es independiente de la configuración de nomenclatura: funciona
aunque no haya ninguna plantilla guardada, y usa el mismo recorrido de
carpetas que Resultados (un clic en **Analizar** llena ambas pestañas sin
recorrer el proyecto dos veces).

- **Agrupación**: por nombre completo exacto, sin distinguir mayúsculas de
  minúsculas (`Planta-01.pdf` y `planta-01.PDF` cuentan como el mismo
  archivo). Como una carpeta no puede tener dos archivos con el mismo nombre
  en Trimble Connect, todo grupo con más de una copia está necesariamente
  repartido en carpetas distintas. Dos archivos con el mismo nombre pero
  distinta extensión (`Planta-01.pdf` y `Planta-01.dwg`) no se agrupan: son
  formatos distintos del mismo plano, no el mismo archivo duplicado.
- **Tarjetas**: total de archivos duplicados y grupos de nombres repetidos.
- **Gráfico** de extensiones con más duplicados, clicable para filtrar.
- Cada grupo se muestra como una tarjeta con **todas sus copias** (carpeta,
  fecha de modificación, tamaño, quién la subió y un enlace **Abrir** al
  visor de Trimble Connect), ordenadas de la más reciente a la más antigua.
- **"Probable vigente"**: una sugerencia, no una regla - se marca únicamente
  la copia cuya fecha de modificación es *inequívocamente* la más reciente
  del grupo; si dos copias empatan en la fecha más reciente, no se marca
  ninguna (los datos no alcanzan para decidir). El equipo sigue siendo quien
  decide cuál conservar.
- **Búsqueda** por nombre o carpeta y **exportación a Excel/CSV** (una fila
  por copia) con los mismos filtros aplicados.

---

## Gráficos de Modelos (visor 3D)

Extensión **del visor 3D** (no del proyecto): aparece en el panel de
extensiones del visor, no en el menú lateral. Construye gráficos con los
datos (propiedades) de los objetos de los modelos cargados en el visor.

1. **Modelos en el visor**: lista los modelos cargados y revisa una muestra
   de ~40 objetos de cada uno para marcarlo **"Con datos · N objetos"** o
   **"Sin datos"** (p. ej. nubes de puntos). Solo los que tienen datos se
   pueden marcar. Debajo aparecen los modelos del proyecto que no están
   cargados, con un botón **Cargar** que los abre en el visor. La lista se
   actualiza sola cuando se carga o descarga un modelo en el visor.
2. **Selección de uno o varios modelos**: al marcar un modelo se leen las
   propiedades de todos sus objetos (con barra de progreso). Se guardan en
   memoria mientras el panel está abierto, así que desmarcarlo y volver a
   marcarlo es instantáneo.
3. **Tres gráficos en blanco**: barras verticales, barras horizontales y
   circular.
4. **Datos en común**: con los modelos marcados aparecen los datos que
   **todos** comparten: los generales (Modelo, Clase, Nombre, Tipo) y cada
   propiedad, identificada como `Grupo · Propiedad` para que no se confundan
   dos propiedades con el mismo nombre en grupos distintos. Los de texto
   llevan `Aa`, los numéricos `#` (con su unidad) y las fechas 📅. Hay un
   buscador, y el panel queda fijo arriba al hacer scroll (con un botón
   **Ocultar** para que no tape los gráficos).
5. **Arrastrar y soltar**: cada gráfico tiene dos casillas:
   - **Categorías**: el dato cuyos valores forman las barras o porciones
     (tipo, material, estado...).
   - **Valor**: "Cantidad de objetos" (por defecto) o la **suma** de un dato
     numérico (longitud, área, volumen, peso...).

   Si sueltas un dato sobre el gráfico (no sobre una casilla), el de texto
   va a Categorías y el numérico a Valor. Si todavía no hay categorías, se
   usa "Modelo", útil para comparar varios modelos. Cada casilla tiene
   también un selector para quien no pueda arrastrar (pantalla táctil o
   teclado).
6. **Gráficos con los datos**: se construyen al instante y muestran todas
   las categorías: hasta 50 en barras verticales, en el circular y en el
   comparativo, y hasta 100 en barras horizontales. Si no caben en la
   tarjeta, las barras se desplazan (de lado las verticales y el
   comparativo, hacia abajo las horizontales) y la leyenda del circular
   también. Solo pasado ese límite las menores se agrupan en "Otros". La
   leyenda del circular sigue el orden de las porciones, con el porcentaje
   de cada una, y un clic en ella selecciona como la porción. Cada gráfico
   tiene **Ver tabla** con todas las categorías, y un pie con cuántos
   objetos tienen esos datos.
7. **Segmentadores (filtros)**: arrastra un dato de texto o de fecha al
   panel "Segmentadores" (o elígelo en "+ Agregar segmentador"). Aparece la
   lista de sus valores con casillas y cuántos objetos tiene cada uno, con
   **Todos** / **Ninguno** y buscador. Los tres gráficos muestran solo los
   objetos que pasan **todos** los segmentadores (se combinan con Y), y el
   panel indica "Los gráficos muestran X de Y objetos". Las fechas se
   filtran por mes. Un segmentador sobre un dato que los modelos marcados no
   comparten se conserva, pero no filtra mientras tanto.
8. **Clic en el gráfico → selección en el modelo 3D**: al hacer clic en una
   barra, porción o fila de la tabla se seleccionan en el visor los objetos
   de esa categoría (respetando los segmentadores). La barra queda
   resaltada y las demás atenuadas, y la tarjeta muestra "N objetos
   seleccionados en el visor · Quitar". Un segundo clic en la misma barra,
   o "Quitar", deselecciona exactamente esos objetos (`setSelection` con
   `"remove"`). En las barras verticales y horizontales vale toda la franja
   de la categoría, no solo la barra, para que las barras pequeñas también
   se puedan pulsar. "Otros" selecciona todos los objetos agrupados en él.
9. **Tipo de gráfico y comparativo A vs B**: el título de cada tarjeta es un
   selector de tipo: barras verticales, barras horizontales, circular o
   **Comparativo A vs B**. El comparativo agrega la casilla **Comparar por**
   (una fecha, que se compara **mes contra mes**, o un dato de texto como la
   fase o el nivel) y los selectores **Periodo A** y **Periodo B** con cada
   mes o valor y su cantidad de objetos. Por defecto propone los dos meses
   más recientes. Muestra barras agrupadas A (azul) y B (naranja) por
   categoría; la tabla incluye la diferencia B − A. Un clic en una barra
   selecciona en el visor los objetos de ese lado.

10. **Guardar vista e historial**: en la cabecera del panel "Datos en común"
    (fijo arriba), **💾 Guardar vista** guarda con un nombre los modelos
    marcados, los tres gráficos (tipo, categorías, valor, comparativo) y los
    segmentadores. **🕘 Vistas guardadas** muestra el historial (las más
    recientes primero, hasta 30), con fecha, cantidad de gráficos y modelos;
    **Abrir** lo restaura todo con un clic y ✕ lo borra. Los modelos se
    reconocen por archivo, no por versión, así que una vista sigue abriendo
    después de subir una versión nueva del modelo. Si la vista usa un modelo
    que no está cargado en el visor, lo avisa con un botón para cargarlo, y
    se marca solo al terminar de cargar.
    Las vistas se guardan **en este navegador, por proyecto** (`localStorage`):
    son personales, no se comparten con el equipo ni con otros equipos. Si el
    navegador bloquea el almacenamiento dentro del iframe de Trimble, la
    extensión lo avisa y las vistas duran solo mientras el panel esté abierto.
11. **🎨 Colorear**: cada gráfico tiene este botón. Pinta cada categoría con
    su propio color **en el gráfico y en el modelo 3D**, con el mismo color
    en ambos (`viewer.setObjectState(..., { color })`), y muestra la leyenda.
    Usa, en orden fijo, los 8 colores de la paleta validada para daltonismo.
    Con más categorías los colores **se repiten**, así todas las categorías y
    todos sus objetos quedan coloreados (p. ej. muros por nivel con 19
    niveles: los 19 niveles con color, ninguno en gris), igual en barras
    verticales, horizontales y circular. Un color nunca se repite entre
    categorías vecinas: ni entre barras o porciones contiguas (incluidas la
    última y la primera del circular), ni entre categorías consecutivas por
    nombre en orden natural ("Nivel 2" antes que "Nivel 10"), para que dos
    niveles seguidos se distingan en el modelo aunque el gráfico los ordene
    por valor (`assignColors` en `lib/graficos/colors.ts`). En barras, la
    leyenda lista juntas las categorías de cada color ("Nivel 1, Nivel 9");
    en el circular, la leyenda da el color de cada porción. Las categorías
    que comparten color se pintan en una sola llamada al visor (máximo 8).
    En el comparativo se pintan todos los objetos del periodo A en azul y
    los del B en naranja (de todas las categorías); los objetos de otros
    periodos conservan su color. Solo un gráfico colorea el modelo a la vez: activarlo en otro
    quita los colores del anterior. Si cambian los datos, los filtros o el
    gráfico, los colores del modelo se actualizan solos. Al desactivarlo se
    restauran exactamente los objetos pintados (`color: "reset"`); los demás
    objetos nunca se tocan. Si se cierra el panel con colores activos,
    quedan en el modelo hasta "Restablecer modelo" en Trimble Connect.
12. **📄 Exportar PDF (informe ejecutivo)**: primero abre un pequeño
    formulario con **título del informe**, **empresa**, **elaborado por**
    (prellenado con el usuario de Trimble Connect, vía `user.getUser()`) y
    **logo de la empresa** (PNG o JPG; se reduce a un tamaño liviano).
    El formulario se recuerda en este navegador, así que solo se llena una
    vez. Luego genera en el navegador (con `jspdf`, que se carga solo al
    exportar) un informe A4 corporativo:
    - **Portada**: banda con el logo y la empresa, título, proyecto, una
      imagen del modelo con sus colores originales y la ficha del documento
      (proyecto, fecha de emisión, elaborado por, empresa, modelos, fuente).
    - **Resumen ejecutivo**: cuatro indicadores (objetos analizados, modelos,
      gráficos, filtros activos), **hallazgos clave** redactados
      automáticamente para cada gráfico, alcance del análisis (modelos y
      filtros) y contenido con números de página.
    - **Una sección por gráfico**: hallazgos destacados, el gráfico y el
      **modelo 3D coloreado según ese gráfico** lado a lado, y una tabla con
      encabezado de color, **% del total** y **fila de totales**. En el
      comparativo, la tabla trae A, B, diferencia y variación %.
    - **Notas metodológicas** (fuente, unidades, agrupaciones, filtros) y
      **control del documento**, con casillas para Elaborado, Revisado y
      Aprobado (firma y fecha).
    - Encabezado con el logo y el título, y pie con la empresa,
      "Confidencial", la fecha y el número de página en todas las páginas
      salvo la portada.

    Los hallazgos ([`lib/graficos/insights.ts`](lib/graficos/insights.ts),
    con pruebas) salen de los datos de cada gráfico. Cubren:
    - la categoría principal y su participación, o los empates cuando no hay
      una sola;
    - la concentración de las 3 principales;
    - en los meses, el pico, la tendencia y el promedio;
    - en el comparativo, el cambio total entre A y B, el mayor aumento, la
      mayor disminución y las categorías nuevas.

    Para las capturas, la extensión pinta el modelo gráfico por gráfico
    (`viewer.getSnapshot()`, con la cámara que el usuario tenga en ese
    momento) y al final lo deja como estaba. Las capturas se guardan en JPEG
    para que el archivo pese poco (unos 350 KB con tres gráficos y logo).
    Las cifras usan separador de miles siempre (9.470), para que las tablas
    se lean alineadas.
13. **Propiedades de las bibliotecas de Trimble Connect**: los valores que
    se asignan desde las **Bibliotecas de conjuntos de propiedades** (por
    ejemplo, "control construccion · está construido" = Verdadero/Falso,
    editados con el lápiz en el panel Propiedades del visor) no vienen en el
    archivo del modelo, así que el visor no los entrega con
    `getObjectProperties`. Viven en el servicio **Property Set** de Trimble
    Connect. En el panel "1. Modelos" está el recuadro **Bibliotecas de
    conjuntos de propiedades**:
    - **Buscar**: revisa los elementos **seleccionados en el visor** (o, si
      no hay selección, una muestra de 60 objetos de los modelos marcados)
      para descubrir qué bibliotecas usa el proyecto. El servicio no ofrece
      una forma pública de listar las bibliotecas de un proyecto, por eso se
      descubren a partir de un objeto que tenga valores. Lo más seguro es
      seleccionar un elemento que ya tenga la propiedad.
    - Luego carga **todos** los valores de esas bibliotecas y los une a los
      objetos por su IFC GUID (`viewer.convertToObjectIds`; enlace
      `frn:entity:<GUID>`, el mismo que usa el panel Propiedades de Trimble).
      Cada propiedad aparece como un dato más ("está construido — control
      construccion"), con su nombre traducido de la biblioteca, y sirve en
      gráficos, segmentadores, comparativo, Colorear, vistas guardadas y PDF.
      Verdadero/Falso se muestra como **Sí/No**.
    - Las bibliotecas encontradas **se recuerdan por proyecto** y se cargan
      solas la próxima vez. **Actualizar** relee los valores (si alguien los
      editó) y **Quitar** las olvida.
    - Para leer el servicio, la extensión pide el token del usuario (la
      primera vez Trimble Connect muestra su aviso de autorización) solo
      cuando se usan las bibliotecas. Las consultas pasan por la ruta
      [`/api/graficos/psets`](app/api/graficos/psets/route.ts), que resuelve
      la región del proyecto (`pset-api` en `/regions`) y solo permite las
      dos lecturas necesarias ([`lib/psetApi.ts`](lib/psetApi.ts)).
    - Si las bibliotecas tienen valores pero ninguno coincide con los objetos
      marcados, el recuadro muestra un ejemplo de enlace de cada lado para
      diagnosticar el formato.

    Además, una propiedad **del propio modelo** con Verdadero/Falso escrito
    como texto ("True", "FALSO"...) también se agrupa como Sí/No.
14. **Atributos de la app Propiedades**: los atributos del catálogo de
    [Propiedades](#propiedades-proyecto--visor-3d) (p. ej. "semana de
    instalacion", "ciclo de instalacion", "cumple calidad?", "costo real",
    "planificado") y los valores asignados a los elementos desde su panel
    del visor aparecen como datos más. Se pueden usar en gráficos,
    segmentadores, comparativo (una fecha como "semana de instalacion" se
    compara mes contra mes), Colorear, vistas guardadas y PDF. El tipo de
    cada atributo se respeta: número se suma, fecha se agrupa por mes, Sí/No
    y texto forman categorías. En el panel "1. Modelos", el recuadro
    **Atributos de Propiedades** indica cuántos atributos hay y cuántos
    objetos de los modelos marcados tienen valores:
    - Se cargan **solos** al marcar un modelo, sin buscar nada. **Actualizar**
      los relee, y también se releen al volver al panel si pasaron más de
      30 s, por si se asignaron valores mientras tanto.
    - Los valores se unen a los objetos por **IFCGUID**, con la misma regla
      del panel Propiedades: primero la propiedad de GUID del objeto (el
      "IfcGUID" de los modelos de Revit) y, si no la tiene, el id externo
      del visor convertido a los 22 caracteres de IFC
      (`resolveIfcGuid` / `normalizeGuid` de
      [`lib/propiedades/ifcGuid.ts`](lib/propiedades/ifcGuid.ts)). Los objetos
      sin id externo se dejan fuera uno a uno: `convertToObjectIds` falla
      para todo el lote si uno no lo tiene, así que el lote se divide hasta
      aislarlos.
    - Se leen **todos los valores del proyecto** (solo existen los de
      elementos con algo asignado) en páginas de 5.000, por la ruta de solo
      lectura [`/api/graficos/propiedades`](app/api/graficos/propiedades/route.ts).
      La ruta comprueba con el token del usuario que es miembro del proyecto
      (`assertProjectAccess`) y lee directamente las tablas
      `propiedades_definiciones` y `propiedades_valores` de Supabase
      ([`lib/graficos/propiedadesServer.ts`](lib/graficos/propiedadesServer.ts)),
      con la misma clave de servidor que la API de Propiedades. No escribe
      nada.
    - Los atributos inactivos solo se ofrecen si algún elemento conserva
      valores. Si Propiedades no tiene base de datos en ese despliegue, el
      recuadro lo indica y el resto de la extensión funciona igual.

**Fechas**: se reconocen las propiedades de tipo fecha del modelo
(`DateTime`, marcas de tiempo UNIX) y los textos que son **solo** una fecha
(`2026-03-15`, `2026-03-15T10:00`, `15/03/2026`, `15.03.2026`; un texto como
`12/05/2024 - Rev B` sigue siendo texto). Se agrupan por mes (`mar 2026`),
en orden cronológico; si hay más meses de los que caben, los más antiguos se
agrupan en "Anteriores". Si en un modelo un dato mezcla fechas y texto, se
trata como texto. El comparativo mes a mes necesita que el modelo tenga
alguna fecha (p. ej. fecha de montaje o de planificación); si no la tiene,
se pueden comparar dos valores de un dato de texto.

**Cómo lee los datos** ([`lib/graficos/viewerReader.ts`](lib/graficos/viewerReader.ts)):
usa el Workspace API del visor: `viewer.getModels("loaded")`,
`viewer.getObjects()` para listar los objetos y
`viewer.getObjectProperties()` en lotes de 250. No necesita access token ni
backend. El visor a veces identifica los objetos por el id del modelo y a
veces por el `versionId` de su archivo, así que se prueban ambos, en el mismo
orden que usa una extensión pública del visor ya validada en proyectos reales.

**Unidades**: el visor entrega las longitudes en mm (aquí se convierten a
**m**), áreas en m², volúmenes en m³ y masas en kg. Los datos booleanos se
muestran como Sí/No.

**Lógica de datos** ([`lib/graficos/modelData.ts`](lib/graficos/modelData.ts),
cubierta por `modelData.test.ts`): aplanado de propiedades, fechas, datos en
común entre modelos, segmentadores, agregación por categoría y comparativo.
La asignación de colores (`colors.ts`), las vistas guardadas
(`savedViews.ts`, que valida lo que lee del almacenamiento) y el informe PDF
(`pdfReport.ts`) tienen sus pruebas en `features.test.ts`.
Cada barra guarda los objetos que la forman (por modelo) para poder
seleccionarlos en el visor. Un dato cuyo tipo difiere entre modelos se
ofrece como texto.

**Colores**: las barras usan un solo color (son una sola serie) salvo con
**Colorear**. El circular usa los 8 colores de una paleta validada para
daltonismo (repetidos, sin tocarse, cuando hay más categorías), más gris
para "Otros". El comparativo usa los dos primeros colores de esa
paleta, validados juntos. Como algunos colores tienen poco contraste sobre
blanco, los gráficos de varias series llevan leyenda con nombres y cada
gráfico tiene su vista de tabla.

---

## Propiedades (proyecto + visor 3D)

Atributos propios del proyecto (por ejemplo "Estado", "Avance (%)", "Fecha
de instalación", "Inspeccionado") que el equipo asigna a los elementos de los
modelos. Los valores se guardan **en la base de datos de esta app (Supabase)**,
identificados por el **IFCGUID** de cada elemento. No se usan los conjuntos de
propiedades (Property Sets) ni los UDA nativos de Trimble Connect, y los
archivos IFC no se modifican.

### Dos superficies, un manifiesto

| Dónde | Qué hace | Quién edita |
|---|---|---|
| **Menú lateral del proyecto → Propiedades** | Catálogo de atributos: crear, editar, desactivar, reactivar y eliminar definiciones (título, tipo, grupo, orden) | Administradores del proyecto. Los demás lo ven en solo lectura |
| **Visor 3D → panel de extensiones → Propiedades** | Formulario con los atributos activos para los elementos seleccionados en el modelo; "Guardar" asigna los valores a todos. Más pestañas: **Seleccionar por agrupación** (selecciona elementos por sus valores) y **Simulador** (los muestra en el tiempo según una fecha) | Los administradores y los **responsables** de cada atributo. Los demás miembros solo consultan |

Las dos superficies son la misma página (`/propiedades`) registrada con **un
solo manifiesto**, [`public/manifest-propiedades.json`](public/manifest-propiedades.json),
con `"extensionType": ["project", "3dviewer"]`. Las definiciones de tipos del
paquete `trimble-connect-workspace-api` documentan esta combinación: *"Extension
with ["project", "3dviewer"] can use the extension.getHost to identify the
extension host type"*. Al cargar, la página llama a `extension.getHost()`:
en el proyecto registra la entrada del menú (`ui.setMenu`) y muestra el
catálogo, y en el visor muestra el formulario.

Por si el visor no ofreciera la extensión instalada con ese manifiesto
combinado, hay un respaldo solo para el visor:
[`public/manifest-propiedades-visor.json`](public/manifest-propiedades-visor.json)
(`/propiedades/visor`, `"extensionType": ["3dviewer"]`, `"type": "panel"`),
que siempre abre el formulario. Usa la misma base de datos y el mismo catálogo.

El botón ⚙ del panel abre el catálogo **dentro del mismo panel** (con
"← Volver a Propiedades"). No puede saltar a la página del menú lateral,
porque `extension.goTo` solo acepta las rutas `settings-extensions`,
`settings-details` y `3dviewer`.

### Cómo se obtiene el IFCGUID

La selección del visor (`viewer.getSelection()` y el evento
`viewer.onSelectionChanged`) entrega **ids de tiempo de ejecución**
(`objectRuntimeIds`). Esos ids cambian entre sesiones, así que no sirven para
guardar valores. Para cada elemento seleccionado, el panel
([`lib/propiedades/selection.ts`](lib/propiedades/selection.ts) +
[`lib/propiedades/ifcGuid.ts`](lib/propiedades/ifcGuid.ts)) hace lo siguiente:

1. **Lee sus propiedades** con `viewer.getObjectProperties`. Si alguna se
   llama `IfcGUID`, `IfcGlobalId`, `GlobalId` o `GUID`, su valor es el
   IFCGUID. Las comparaciones ignoran mayúsculas, espacios, `_`, `.` y `-`, y
   las propiedades se prueban en ese orden de prioridad. Revit exporta
   `IfcGUID`. `Tipo IfcGUID` / `Type IfcGUID` (el GUID del *tipo*, no del
   elemento) no coincide a propósito.
2. **Pide su id externo** con `viewer.convertToObjectIds`. Las definiciones
   del Workspace API documentan que, para modelos IFC, el id externo es el
   **GUID sin comprimir** (formato de 36 caracteres, p. ej.
   `0b3a6d2e-1f4c-…`). Se convierte al IFCGUID de 22 caracteres con el
   algoritmo estándar de IFC (el mismo de IfcOpenShell).
3. **Normaliza y valida.** Todo se guarda en la forma de 22 caracteres
   (`^[0-3][0-9A-Za-z_$]{21}$`). Si hay propiedad y también id externo y no
   coinciden, gana la propiedad, y el panel avisa de la diferencia.

Limitaciones:

- **Geometría no IFC.** Algunos objetos no tienen IFCGUID: DWG, mallas,
  nubes de puntos, o modelos sin GlobalId ni id externo. Para ellos el panel
  muestra un aviso con sus nombres y no les asigna valores. El resto de la
  selección se sigue editando normalmente.
  `convertToObjectIds` falla si *cualquier* objeto del lote no tiene id
  externo; en ese caso se pregunta objeto por objeto.
- **El IFCGUID depende de quien exporta el IFC.** Revit conserva el IfcGUID
  entre exportaciones (está guardado en el elemento). Otras herramientas
  pueden regenerarlo, y en ese caso los valores quedan asociados al GUID
  anterior.
- **Pendiente de confirmar con un modelo real.** Esta resolución se basa en la
  documentación del SDK, no en una prueba con un modelo real. En el panel,
  **"Origen del IFCGUID"** muestra para cada elemento:
  - el IFCGUID resuelto;
  - de dónde salió;
  - el id externo crudo;
  - cualquier diferencia entre las fuentes.

  Compáralo con el `GlobalId` que muestra el panel de propiedades del visor
  la primera vez que se use en un modelo.

### Comportamiento del formulario (visor)

- **Agrupación y controles.** Los atributos se agrupan por categoría, en
  secciones plegables ordenadas por el campo "orden". Cada tipo tiene su
  control:
  - **Texto:** campo de texto.
  - **Número:** campo numérico; acepta coma o punto decimal.
  - **Sí / No:** botones Sí, No y Sin valor.
  - **Fecha:** se escribe `DD-MM-AAAA` y tiene calendario propio. El selector
    nativo depende del idioma del navegador y no se puede abrir dentro del
    iframe de Trimble Connect.
- **Valores mixtos.** Cuando los elementos seleccionados tienen valores
  distintos (incluido "unos tienen valor y otros no"), el campo muestra
  **"Valores mixtos"**.
  - Si no lo tocas, **no se guarda**: cada elemento conserva su valor.
  - Si lo editas, antes de guardar aparece una confirmación explícita que
    dice qué se va a reemplazar en cuántos elementos.
  - Lo mismo ocurre al borrar un valor existente.
- **Solo se envían los campos editados.** Un cambio que deja el campo igual
  no cuenta.
- **Cambio de selección con cambios pendientes.** La nueva selección queda en
  espera con un aviso y dos opciones: "Guardar en la selección anterior" o
  "Descartar cambios". Nunca se pierden ni se aplican cambios en silencio.
- **Elementos repetidos.** Si dos objetos seleccionados tienen el mismo
  IFCGUID (p. ej. el mismo elemento en dos modelos), se guarda una sola vez.
- **Metadatos.** Cada valor guarda quién lo modificó y cuándo; el panel lo
  muestra como "Modificado por … el DD-MM-AAAA".

### Responsables: quién asigna cada atributo

Cada atributo puede tener **responsables**: personas o grupos del equipo del
proyecto en Trimble Connect (el mismo listado de usuarios y grupos de la
sección de equipo/contactos del proyecto). Por ejemplo, a David Pérez o al
grupo "Calidad" para los atributos de calidad.

- **Quién puede asignar valores en el visor:** los administradores del
  proyecto y los responsables del atributo. Un responsable puede estar
  nombrado directamente o pertenecer a un grupo responsable.
- **Sin responsables**, el atributo lo asignan solo los administradores.
- **Los demás miembros** ven los valores pero no los cambian. En el panel,
  cada campo que no pueden editar aparece como solo lectura, con un candado y
  el texto "lo asignan …". Si no pueden editar ninguno, el panel lo avisa
  arriba.
- **Validación en el servidor.** La regla se aplica también al guardar: si un
  cambio incluye un atributo que el usuario no puede asignar, se rechaza todo
  (403 `not-responsable`) y no se guarda nada.
- **Pertenencia a grupos.** Se consulta en Trimble Connect con
  `GET /projects/{id}/users?groupId=…`, solo para los grupos que aparecen como
  responsables, y se guarda en caché 2 minutos. Por eso un cambio en los
  grupos de Trimble puede tardar hasta 2 minutos en notarse.

**Dónde se asignan (solo administradores), en el catálogo:**

- **Al crear o editar un atributo**, en el campo "Responsables". Es un
  buscador de personas y grupos del proyecto que ignora tildes; se agregan
  con clic o Enter y se quitan con la ×.
- **Con "Responsables del grupo"**, en la cabecera de cada grupo. Lo que se
  agrega o quita ahí se aplica a todos los atributos del grupo. Los
  responsables asignados a un solo atributo no cambian.
- **Al crear un atributo en un grupo existente**, se proponen los
  responsables que comparten todos los atributos de ese grupo.

Para mostrar los responsables se usa el nombre actual que tiene la persona o
el grupo en Trimble Connect. Además se guarda el nombre que tenía al
asignarse, que se muestra si la lista de contactos no está disponible.

### Seleccionar por agrupación (pestaña del panel del visor)

Es la segunda pestaña del panel Propiedades del visor 3D: **Propiedades** |
**Seleccionar por agrupación**. Está en la misma extensión y la misma
dirección (`/propiedades`), así que no se instala nada aparte.

- **Las dos pestañas siguen abiertas al cambiar de una a otra:** lo que la
  de agrupación ya leyó no se pierde.
- **De la agrupación a Propiedades:** al seleccionar un grupo, cambia la
  selección del visor y la pestaña Propiedades carga esos elementos. El
  aviso ofrece **"Ver y asignar sus atributos"** para pasar a ella.
- **De Propiedades a la agrupación:** al guardar valores, o al cambiar el
  catálogo, la agrupación vuelve a leer los atributos.
- **Si Trimble recarga el panel**, se recuerda en la pestaña del navegador
  (`sessionStorage`) por qué propiedades se agrupaba y con qué modelos, y se
  vuelve a aplicar.

**Para qué sirve:** para seleccionar en el modelo todos los elementos que
comparten un valor, por ejemplo:

- todos los muros del "Piso 1": agrupar por *Clase* y *Level*;
- todo lo que "cumple calidad?" = Sí: agrupar por ese atributo del proyecto.

**Cómo se usa:**

1. **Modelos.** Se ofrecen todos los modelos cargados en el visor, marcados
   por defecto. La pestaña lee sus propiedades una vez, con barra de
   progreso, y las mantiene mientras el panel siga abierto.
2. **Agrupar por.** Se eligen hasta 3 propiedades con un buscador que
   ignora tildes. Pueden ser:
   - **atributos del proyecto**, los de esta app;
   - **generales**: Clase, Nombre, Tipo y Modelo;
   - **cualquier propiedad nativa de los modelos**, por conjunto (p. ej.
     *Constraints · Level*, *Identity Data · Name*).

   Se ofrecen todas las propiedades, no solo las comunes a todos los modelos.
   Un elemento sin la propiedad cae en el grupo "(Sin valor)".
3. **Resultados.** Cada combinación de valores es un grupo con su número de
   elementos, en orden natural ("Piso 2" antes de "Piso 10") y con
   "(Sin valor)" al final.
   - Al hacer **clic en un grupo** se seleccionan sus elementos en el modelo
     3D (`viewer.setSelection`).
   - Con las casillas se pueden marcar varios grupos y seleccionarlos juntos
     con **"Seleccionar marcados"**.
   - Esa selección carga los elementos en la pestaña Propiedades, así que se
     les pueden asignar atributos de una sola vez.
   - Las fechas se muestran en `DD-MM-AAAA`.
4. **Configuraciones guardadas.**
   - **Qué se guarda:** con un nombre, por qué propiedades se agrupa y con
     qué modelos.
   - **Quién las ve y las borra:** se comparten con todo el proyecto.
     Cualquier miembro puede guardar una, y solo quien la guardó o un
     administrador puede eliminarla.
   - **Al aplicarlas:** se marcan de nuevo esos modelos, si están cargados,
     y se avisa si alguna propiedad ya no existe en ellos.

**De dónde salen los datos.** Las propiedades nativas se leen del visor
igual que en "Gráficos de Modelos" (`lib/graficos/viewerReader.ts` y
`modelData.ts`). Los valores de los atributos del proyecto vienen de
`/api/graficos/propiedades` y se cruzan por IFCGUID con la misma regla del
formulario. Para los modelos sin propiedad `IfcGUID` propia (los IFC), los
identificadores del visor solo se leen cuando se agrupa por un atributo del
proyecto. Después de guardar valores en el formulario, o de cambiar el
catálogo, la pestaña vuelve a leer los atributos.

### Simulador (pestaña del panel del visor)

Es la tercera pestaña del panel Propiedades: **Propiedades** | **Seleccionar
por agrupación** | **Simulador**. Reproduce en el visor 3D la aparición de los
elementos en el tiempo, según una fecha.

1. **Modelos.** Son los mismos de la pestaña de agrupación. Las dos pestañas
   comparten la lectura de los modelos
   ([`components/propiedades/useModelData.ts`](components/propiedades/useModelData.ts)),
   así que cada modelo se lee una sola vez.
2. **Fecha a simular.** Se ofrecen todas las propiedades de fecha de los
   modelos marcados: las nativas (de tipo fecha, o un texto que es una fecha)
   y los **atributos de tipo Fecha del proyecto**. Primero van los del
   proyecto, y cada una indica cuántos elementos la tienen.
3. **Segmentadores: qué simular.** Debajo de la fecha se elige qué
   elementos entran en la simulación, por un dato de texto o fecha (p. ej.
   solo muros, solo el "Piso 1" o una fase), con Todos / Ninguno / buscar.
   El filtro se aplica a todo: la línea de tiempo, el % de avance, la curva
   y los gráficos del avance (los segmentadores de cada gráfico filtran
   además sobre esto). Se indica cuántos se simulan, por ejemplo "Se simulan
   6 de 16 elementos con…".

   **Al segmentar, el modelo muestra de inmediato los elementos
   segmentados.** La línea de tiempo salta al final para mostrarlos todos,
   con su color, y lo que queda fuera se **oculta**. Con ▶ (que pasa a decir
   "Repetir") la simulación arranca desde el inicio solo con esos elementos.
   Lo que queda fuera tiene su propia opción: ocultarlo (por defecto),
   mostrarlo en gris o dejarlo como está.
4. **Línea de tiempo.** Va desde la fecha más antigua hasta la más reciente
   de esa propiedad. Muestra:
   - la fecha actual (`DD-MM-AAAA`);
   - la **curva de avance acumulado** (curva S), con la posición actual
     marcada;
   - un control deslizante para moverse por días;
   - los botones ⏮ (inicio), **▶ Reproducir / ⏸ Pausar**, ⏭ (final) y
     **Hoy** (si hoy cae dentro del rango);
   - la duración de la reproducción completa: 15 s, 30 s, 1 min o 2 min.
5. **Avance.** Es el porcentaje de los elementos simulados que tienen esa
   fecha y que ya aparecieron: los que tienen una fecha igual o anterior a la actual,
   divididos por el total de elementos con la fecha. Se muestra con la
   cuenta, por ejemplo "6 de 16 elementos".

**Avance del día.** Una tarjeta debajo de la línea de tiempo muestra qué
porcentaje del total aparece en la fecha que se está viendo, por ejemplo
"+5,3 % · 1 elemento aparece este día", junto con el acumulado.

- **Días sin avance:** dice desde cuándo no hay avance ("último avance el
  …").
- **Durante la reproducción:** si cada paso salta varios días (obras largas),
  muestra el avance de esos días juntos ("Avance del período, del … al …"),
  para no quedar en 0 % entre fechas.
- **Barras de avance por fecha:** una por día, o por cada N días en líneas de
  tiempo largas, con la fecha actual resaltada. Al hacer clic en una barra se
  va a esa fecha.
- **Día | Semana | Mes:** la tarjeta también da el avance de la **semana**
  (lunes a domingo) o del **mes** calendario hasta la fecha actual, por
  ejemplo "Semana del 09-03 al 15-03-2026 · hasta el 11-03". Las barras pasan
  a ser una por semana o por mes.

**El avance del período en los gráficos.** En los gráficos del avance, la
parte de cada barra que aparece en el día, la semana o el mes elegidos se
dibuja **en naranja** encima de lo acumulado antes, y el tooltip la indica.
Cada gráfico, también el circular, dice cuánto avanzó y en qué categorías,
por ejemplo "Avance del 09-03-2026: +3 objetos · IFCCOLUMN +2 · IFCSLAB +1".
Para eso, `Charts.tsx` admite `increments`: apila esa parte sobre cada barra.

**Qué pasa en el visor:**

- **Al empezar**, se ocultan todos los elementos con esa fecha
  (`viewer.setObjectState`, `visible: false`). A medida que avanza la línea
  de tiempo van apareciendo, y retroceder los oculta de nuevo.
- **El naranja del modelo es el período de la tarjeta "Avance del día":**
  los elementos del día, la semana o el mes que ya están visibles. En modo
  Día, mientras se reproduce, marca los días que avanzó cada paso. Al hacer
  clic en un mes (o en una semana o un día) de la tarjeta, el modelo va a esa
  fecha y pinta en naranja lo de ese período. Al cambiar de período solo se
  actualiza la diferencia. Se puede apagar en Opciones, y mientras un gráfico
  colorea el modelo no se usa.
- **Elementos que no entran:** hay dos opciones separadas.
  - **Fuera de los segmentadores:** por defecto se ocultan.
  - **Sin esa fecha entre los segmentados:** por defecto quedan en gris como
    contexto.

  En ambos casos se puede elegir ocultar, gris o dejar como están. Cambiar
  una opción rehace el modelo en la misma fecha.
- **"Restablecer modelo"** devuelve la visibilidad y los colores que la
  simulación cambió. También se restablece al cambiar de fecha, de modelos o
  de opción, y al cerrar el panel.
- **Contenedores del modelo:** proyecto, edificio, niveles y ensambles
  (como un muro cortina) **nunca se ocultan ni se pintan**. En Trimble
  Connect, ocultar un padre oculta todo lo que tiene debajo, y mostrar un hijo
  no lo trae de vuelta mientras el padre siga oculto: por eso, en un modelo
  real, segmentar "solo columnas" dejaba el visor vacío. Antes de preparar la
  simulación se leen, una vez por conjunto de modelos, los ancestros de todos
  los elementos (`viewer.getHierarchyParents`, en los árboles espacial, de
  contención y de ensambles; ver
  [`lib/propiedades/hierarchy.ts`](lib/propiedades/hierarchy.ts)), y se
  excluyen de todo lo que se oculta o se pone en gris. Los elementos con la
  fecha simulada sí se ocultan y se muestran siempre.
- **Pausa automática:** la reproducción se pausa al salir de la pestaña.
- **Cola de cambios:** los cambios al visor van en cola, uno a la vez. Si la
  reproducción va más rápido que el visor, se juntan en un solo cambio.

**Gráficos del avance.** Debajo de la línea de tiempo hay tres gráficos,
iguales a los de Gráficos de Modelos: barras verticales, barras horizontales y
circular. El tipo se puede cambiar en cada uno. Cada gráfico se configura con
**Categorías** (cualquier dato de los modelos o atributo del proyecto) y
**Valor** (cantidad de objetos o la suma de un dato numérico).

- **Qué cuentan:** solo los elementos que **ya aparecieron** en la fecha
  actual. Si ese día se ven 5 columnas, los gráficos muestran esas 5.
- **Se llenan sin saltar:** las categorías, su orden y la escala del eje son
  los del final de la línea de tiempo. Así las barras crecen hacia su tamaño
  final en lugar de reordenarse o cambiar de escala, y en el circular cada
  categoría conserva su color.
- **Selección:** al hacer clic en una barra o sector se seleccionan en el
  modelo esos elementos.
- **Segmentadores por gráfico:** cada gráfico tiene los suyos, como en
  Gráficos de Modelos. Se elige un dato de texto o fecha y se marcan los
  valores que se quieren ver (Todos / Ninguno / buscar). Filtran solo ese
  gráfico y lo que colorea en el modelo.
- **"🎨 Colorear" por gráfico:** las barras toman un color por categoría,
  fijo durante toda la línea de tiempo, con su leyenda. En el modelo, cada
  elemento **aparece con el color de su categoría** a medida que avanza la
  simulación. Solo un gráfico colorea a la vez, y mientras tanto se apaga el
  resaltado naranja. Los elementos que no pasan los segmentadores conservan
  su color. Al apagarlo, los elementos ya mostrados recuperan su color; si la
  simulación no estaba corriendo, activarlo la inicia en la fecha actual.
  "Restablecer modelo" también lo apaga.
- **Configuración:** se recuerda en la pestaña del navegador.
- **Piezas reutilizadas:** usan las mismas piezas de gráfico de Gráficos de
  Modelos ([`components/graficos/Charts.tsx`](components/graficos/Charts.tsx),
  que admite una escala fija con `maxValue`) y su misma agregación.

La lógica (orden por fecha, conteo hasta una fecha, curva de avance y
gráficos del avance) está en
[`lib/propiedades/simulation.ts`](lib/propiedades/simulation.ts), con
pruebas.

### Catálogo (menú del proyecto)

- **Edición solo para administradores.** Lo decide el rol del usuario en el
  proyecto (`role: "ADMIN"` en `GET /projects/{id}/users` de la API REST de
  Trimble Connect). La comprobación se hace en el servidor; la interfaz solo
  oculta los botones.
- **Grupos.** Se elige uno existente (lista desplegable) o se escribe uno
  nuevo.
- **Desactivar.** Un atributo desactivado no aparece en el formulario ni
  admite valores nuevos, pero **sus valores se conservan** y el panel los
  muestra en "Atributos inactivos con valores". Se puede reactivar.
- **Eliminar.** Solo es posible si el atributo **no tiene ningún valor**. Si
  tiene valores, la base de datos lo impide además de la interfaz
  (`on delete restrict`, error 409 en la API).
- **El tipo de dato no se puede cambiar** una vez que el atributo tiene
  valores.
- **Títulos únicos.** No puede haber dos atributos con el mismo título en el
  proyecto, sin distinguir mayúsculas ni tildes.

### Esquema de la base de datos

[`supabase/propiedades.sql`](supabase/propiedades.sql), en la misma Supabase
que usa "Validación":

| Tabla | Columnas principales |
|---|---|
| `propiedades_definiciones` | `id` (uuid), `project_id`, `title`, `data_type` (`text` / `number` / `boolean` / `date`), `group_name`, `sort_order`, `active`, `responsables` (jsonb: lista de `{ type: "user" \| "group", id, name }`), `created_at/by`, `updated_at/by` |
| `propiedades_agrupaciones` | `id` (uuid), `project_id`, `name` (único por proyecto sin distinguir mayúsculas), `config` (jsonb: `{ fields: [{ key, label, group }], modelNames: [...] }`), `created_at`, `created_by`, `created_by_id` |
| `propiedades_valores` | `id`, `project_id`, `model_id` (informativo), `ifc_guid` (22 caracteres, validado), `attribute_id` → definición (`on delete restrict`), una columna tipada por tipo (`value_text`, `value_number`, `value_boolean`, `value_date`; exactamente una con valor), `updated_at`, `updated_by` |

- **Clave del valor.** Cada valor es único por **(proyecto, IFCGUID,
  atributo)**. El `model_id` es solo informativo: el mismo elemento en una
  versión nueva del modelo conserva sus valores.
- **Fechas.** Se guardan como `date` (ISO). Al usuario siempre se le muestran
  como `DD-MM-AAAA`.
- **Vista de conteo.** `propiedades_definiciones_uso` cuenta los valores de
  cada definición.
- **Guardado atómico.** La función `propiedades_guardar_valores` guarda un
  lote de forma atómica (todo o nada). Antes de escribir comprueba que cada
  atributo sea del proyecto y esté activo, y un valor `null` borra.
- **Acceso.** RLS está activado y sin políticas: solo el servidor, con la
  clave de servicio, lee y escribe.

### API

Todas las rutas requieren `?projectId=` y el token del usuario
(`Authorization: Bearer`, el mismo de `extension.requestPermission("accesstoken")`).
El servidor comprueba que el usuario sea miembro del proyecto. Además, para
cambiar el catálogo comprueba que sea administrador, y para guardar valores,
que sea administrador o responsable de cada atributo.

| Método y ruta | Uso |
|---|---|
| `GET /api/propiedades/definiciones` | Catálogo completo (activas e inactivas, con su número de valores y responsables), si el usuario puede editarlo (`canEdit`) y qué atributos puede asignar (`editableIds`) |
| `POST /api/propiedades/definiciones` | Crear: `{ title, dataType, group?, sortOrder?, responsables? }` (solo administradores) |
| `PATCH /api/propiedades/definiciones/{id}` | Editar o desactivar/reactivar: `{ title?, dataType?, group?, sortOrder?, active?, responsables? }` (solo administradores) |
| `DELETE /api/propiedades/definiciones/{id}` | Eliminar; 409 si ya tiene valores (solo administradores) |
| `POST /api/propiedades/valores/consulta` | Valores de uno o varios elementos: `{ ifcGuids: [...] }` |
| `PUT /api/propiedades/valores` | Upsert en varios elementos a la vez: `{ elements: [{ ifcGuid, modelId }], changes: [{ attributeId, value }] }`. `value: null` borra. Fechas en ISO (`AAAA-MM-DD`). 403 `not-responsable` si incluye un atributo que el usuario no puede asignar |
| `GET /api/propiedades/agrupaciones` | Configuraciones de "Seleccionar por agrupación" guardadas en el proyecto; cada una dice si el usuario puede eliminarla (`canDelete`) |
| `POST /api/propiedades/agrupaciones` | Guardar una: `{ name, fields: [{ key, label, group }], modelNames }` (cualquier miembro; hasta 3 propiedades; 409 `duplicate-name` si el nombre ya existe) |
| `DELETE /api/propiedades/agrupaciones/{id}` | Eliminarla (quien la guardó o un administrador; 403 `not-owner` para los demás) |
| `GET /api/propiedades/contactos` | Personas y grupos del proyecto para elegir responsables: `{ users: [{ id, name, email, pending }], groups: [{ id, name, usersCount }] }` (solo administradores) |

Cada solicitud admite hasta 2.000 elementos y es atómica (todo o nada). Para
selecciones más grandes (el panel lee hasta 5.000 objetos), el panel envía
varios lotes. Si uno de ellos fallara, los anteriores ya quedarían guardados;
el panel lo dice y conserva los cambios para volver a guardar.

### Configuración

No hay variables nuevas: usa las mismas `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` de "Validación". Solo hay que ejecutar una vez
[`supabase/propiedades.sql`](supabase/propiedades.sql) en el **SQL Editor** de
Supabase. Hasta entonces, la API responde con un mensaje que indica ese paso.
**Al actualizar**, por ejemplo cuando se agregaron los responsables o las
configuraciones guardadas, vuelve a ejecutar el mismo archivo: es seguro
repetirlo y no borra datos. Si falta hacerlo, lo demás sigue funcionando,
pero guardar responsables o configuraciones muestra un mensaje que pide ese
paso.
En `npm run dev` sin variables de Supabase, los datos se guardan en memoria.

---

## Presupuesto (proyecto + visor 3D)

Presupuesto del proyecto con **catálogos de insumos y de partidas (APU)**
clasificados con **OmniClass**, y con sus partidas asociadas a los elementos
de los modelos 3D por **IFCGUID**, de donde puede salir el metrado. Todo se
guarda en la base de datos de esta app (Supabase); no se usan los Property
Sets ni los UDA de Trimble Connect.

| Dónde | Qué hace |
|---|---|
| **Menú lateral del proyecto → Presupuesto** (`/presupuesto`) | El presupuesto: subpresupuestos con títulos y partidas, análisis de precios unitarios, catálogos, lista de insumos, gastos generales, pie, importación y exportación |
| **Visor 3D → panel de extensiones → Presupuesto** (`/presupuesto/visor`) | Elegir una partida del presupuesto guardado y **agregar o quitar** los elementos seleccionados; medirlos (volumen, área, longitud, peso o conteo) y seleccionarlos en el modelo |

Como Propiedades, es una sola página con `"extensionType": ["project", "3dviewer"]`
([`public/manifest-presupuesto.json`](public/manifest-presupuesto.json)) y un
respaldo solo para el visor ([`public/manifest-presupuesto-visor.json`](public/manifest-presupuesto-visor.json)).
La conexión con Trimble Connect (token, menú, visor) es común a las dos:
[`components/trimble/ExtensionShell.tsx`](components/trimble/ExtensionShell.tsx).

### Catálogos y base maestra

- **Insumos**: código, descripción, unidad, precio, tipo (**MO** mano de obra,
  **MT** materiales, **EQ** equipos y herramientas, **SC** subcontratos), IU
  (índice unificado) y código OmniClass (p. ej. Tabla 23 Productos, 41
  Materiales o 34 Roles). Las herramientas que se cobran como porcentaje de
  la mano de obra usan la unidad **%MO**.
- **Partidas**: código, descripción, unidad, rendimiento (unidades por día),
  jornada (horas), código OmniClass de la **Tabla 22 (Resultados de trabajo)**
  y su APU: insumos y subpartidas (otras partidas del catálogo) con cuadrilla o
  cantidad. La app trae las divisiones de la Tabla 22; cualquier otra tabla se
  importa desde Excel (hoja OmniClass).
- **Base maestra.** Los catálogos pertenecen a un proyecto. Cada proyecto usa
  los suyos o, desde ⚙ Configuración, los de un **proyecto base** (por ejemplo
  "BASE DE DATOS PRESUPUESTOS"): una sola base para toda la empresa, que
  mantienen los administradores y editores de ese proyecto. Las obras la usan
  en solo lectura. Para conectar una base hay que ser administrador de la obra
  y administrador o editor de la base, para que nadie comparta sus precios sin
  permiso.
- No se elimina un insumo que usa alguna partida del catálogo, ni una partida
  que es subpartida de otra (409 `in-use`). Los códigos no se repiten dentro
  de un catálogo.

### El presupuesto

- **Subpresupuestos** (SP: ESTRUCTURAS, ARQUITECTURA...) con **títulos** y
  **partidas**, con numeración automática (1, 1.1, 1.1.1...). La barra
  reproduce la herramienta de referencia: Guardar, + Título, + Partida,
  editar, eliminar, copiar, cortar y pegar, ← → (sacar del título o meterlo
  en el de arriba), ↑ ↓, y el selector de SP con nuevo, renombrar y eliminar.
  Los títulos se contraen con ▼ y la descripción, la unidad y el metrado se
  editan con doble clic.
- Una partida nueva se escribe o se **copia del catálogo** (con sus insumos y
  subpartidas). Es una copia: su APU se ajusta en el presupuesto sin cambiar
  el catálogo.
- **Precios del presupuesto.** Al usarse por primera vez, cada insumo copia el
  precio del catálogo. Cambiar su PU (en un APU o en la Lista de insumos) lo
  cambia en todas las partidas de ese presupuesto. "Actualizar precios del
  catálogo" vuelve a traer los del catálogo.
- **Cálculo** (igual que en la referencia, verificado con sus cifras):
  - cantidad de una línea con cuadrilla = cuadrilla × jornada ÷ rendimiento
    (si escribes la cantidad, se recalcula la cuadrilla);
  - parcial = cantidad × PU, redondeado a 2 decimales (cantidades a 4);
  - una línea %MO = su porcentaje de la mano de obra de la partida;
  - una subpartida aporta su CU por la cantidad;
  - CU = MO + MT + EQ + SC + SP;
  - el parcial de una partida es metrado × CU, y un título suma sus partidas
    por columna;
  - CD (costo directo) es la suma del subpresupuesto.
- Al seleccionar una partida se abre abajo su **análisis de precios
  unitarios**, editable: rendimiento, jornada, cuadrillas, cantidades, PU,
  agregar insumo (buscador por nombre o código), agregar subpartida (del
  presupuesto o del catálogo) o crear una nueva. Se impide una subpartida que
  se contenga a sí misma.
- **Guardar** guarda el presupuesto entero (también con Ctrl+S). Si otra
  persona guardó entre tanto, no se pisa su versión: aparece un aviso para
  recargar (409 `version-conflict`). Al cerrar la página con cambios sin
  guardar, el navegador pide confirmación.
- **Lista de insumos**: todos los insumos sumados (metrado × cantidad,
  entrando en las subpartidas), por subpresupuesto o de todos, con PU e IU
  editables, total, PDF y Excel.
- **Gastos generales**: fijos y variables, por títulos con sus items, en
  formato General (cantidad × precio) o Personal (cantidad × % participación ×
  tiempo × precio). Muestra **PGG** = GG ÷ CD de todo el presupuesto.
- **Pie del subpresupuesto**: filas `variable = fórmula` con CD, **FGG**
  (factor de gastos generales = GG ÷ CD total) y las variables de las filas de
  arriba. Admite + − × ÷, paréntesis y `%`, y se evalúa con un intérprete
  propio, nunca con `eval`. Se puede aplicar a todos los subpresupuestos. El
  pie inicial es PGG = `CD * FGG`, UTI = `CD * 0.10`, ST, IGV = `ST * 0.18` y
  TOTAL, editable. También aparece al final de la grilla.
- **Exportar**: Excel con todos los subpresupuestos (con el desglose
  MO/MT/EQ/SC/SP y su pie), la lista de insumos y los gastos generales; PDF
  del subpresupuesto abierto con su pie.

### Metrado desde el modelo (visor)

En el panel del visor se elige una partida y se usan **⊕ Agregar selección** /
**⊖ Quitar selección** sobre los elementos seleccionados. Cada elemento se
guarda por su IFCGUID, con la misma regla que Propiedades: primero una
propiedad GUID y, si no hay, el id externo convertido.

"Metrado desde el modelo" decide cómo mide la partida:

- **Solo asociar**: la partida usa su metrado manual.
- **Conteo de elementos**.
- **Una propiedad numérica** de los elementos.

La app sugiere la propiedad según la unidad de la partida: M3 → volumen (el
neto primero), M2 → área, M/ML → longitud, KG → peso, y UND/GLB/PZA → conteo.
Las longitudes se pasan a metros. Si cambias la medición, se vuelven a medir
los elementos que estén en los modelos abiertos.

Cuando una partida mide sus elementos, su metrado en el presupuesto es la suma
y aparece con la marca **3D**. Cada elemento puede pertenecer a varias
partidas, por ejemplo concreto en M3 y encofrado en M2. La lista indica qué
partidas tienen elementos de la selección actual, y "Seleccionar sus elementos
en el modelo" los busca así:

1. por el GUID como id externo;
2. si no aparece, revisando los ids externos del modelo;
3. por último, leyendo una vez sus propiedades GUID.

El panel muestra el presupuesto **guardado**. Al guardar, se borran los
elementos de las partidas que ya no existen.

### Importar desde Excel

"Importar Excel" descarga una plantilla con instrucciones y estas hojas:

- **Insumos**
- **Partidas**
- **APU**: una fila por insumo o subpartida de cada partida, con su cuadrilla
  o cantidad.
- **OmniClass**

También descarga el **catálogo actual** en el mismo formato, para editarlo en
Excel e importarlo de vuelta.

Al subir el archivo:

- Se reconocen los registros por código; si no tienen, por descripción +
  unidad. Los existentes se actualizan y los demás se crean.
- Las filas del APU reemplazan el análisis de su partida.
- Antes de importar, la app muestra cuántos registros son nuevos, cuántos se
  actualizan y cuántos quedan sin cambios, y qué filas tienen problemas (tipo
  inválido, insumo no encontrado, código repetido, subpartidas circulares...).
- Se envía por lotes de 1.000.

### Permisos

| Acción | Quién |
|---|---|
| Ver el presupuesto, los catálogos y los elementos asociados | Cualquier miembro del proyecto |
| Editar el presupuesto y asociar elementos en el visor | Administradores del proyecto y los **editores** (personas o grupos) que elijan en ⚙ Configuración |
| Editar los catálogos | Administradores y editores del proyecto **dueño** de los catálogos (la base) |
| Elegir editores y base | Administradores del proyecto |

### Esquema de la base de datos

[`supabase/presupuesto.sql`](supabase/presupuesto.sql) (se puede volver a
ejecutar sin perder datos):

| Tabla / función | Contenido |
|---|---|
| `presupuesto_config` | Por proyecto: base de catálogos y editores |
| `presupuesto_insumos`, `presupuesto_partidas` | Catálogos, por `base_id` (el proyecto dueño); código único por catálogo; el APU es `componentes` (jsonb) |
| `presupuesto_omniclass` | Códigos OmniClass importados |
| `presupuesto_documentos` | El presupuesto de cada proyecto (jsonb) con su `version` |
| `presupuesto_elementos` | IFCGUID + modelo + cantidad por partida (`item_id`) |
| `presupuesto_mediciones` | Qué mide cada partida (propiedad, conteo o nada) |
| `presupuesto_resumen_elementos` | Vista: elementos y suma de cantidades por partida |
| `presupuesto_guardar_insumos` / `_partidas` | Guardan lotes; una fila con el id de otro catálogo no se toca |
| `presupuesto_guardar` | Guarda el presupuesto si la versión coincide y limpia los elementos de partidas borradas |

RLS está activado y sin políticas: solo el servidor, con la clave de
servicio, lee y escribe.

### API

Todas las rutas usan `?projectId=` y el token del usuario
(`Authorization: Bearer`).

| Método y ruta | Uso |
|---|---|
| `GET /api/presupuesto/estado` | Configuración y qué puede hacer el usuario (`canEdit`, `canEditBase`) |
| `PUT /api/presupuesto/config` | `{ baseProjectId?, editores? }` (administradores) |
| `GET /api/presupuesto/contactos` | Personas y grupos para elegir editores (administradores) |
| `GET /api/presupuesto/catalogo` | Insumos, partidas y códigos OmniClass de la base |
| `POST /api/presupuesto/catalogo/insumos` · `.../partidas` · `.../omniclass` | Crear o actualizar en lote (hasta 1.000 por envío) |
| `DELETE /api/presupuesto/catalogo/insumos/{id}` · `.../partidas/{id}` | Eliminar (409 `in-use` si se usa) |
| `GET` / `PUT /api/presupuesto/documento` | Leer / guardar `{ doc, version }` (409 `version-conflict`) |
| `GET /api/presupuesto/elementos/resumen` | Mediciones y conteos por partida |
| `POST /api/presupuesto/elementos/consulta` | `{ itemIds }` o `{ ifcGuids }` |
| `PUT /api/presupuesto/elementos` | `{ itemId, upsert: [{ ifcGuid, modelId, cantidad }], remove: [ifcGuid] }` |
| `PUT /api/presupuesto/mediciones` | `{ itemId, campo, campoLabel, unidad }` |

### Configuración

Usa las mismas `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Basta con
ejecutar una vez [`supabase/presupuesto.sql`](supabase/presupuesto.sql) en el
**SQL Editor** de Supabase: mientras no se haga, la API responde con un
mensaje que indica ese paso.

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
  graficos/                   Graficos de Modelos (pagina embebida en el visor 3D)
  propiedades/                Propiedades: catalogo (proyecto) y formulario (visor 3D); visor/ = respaldo solo visor
  api/summary, api/files      API de Resumen Archivos
  api/tree                    Arbol de carpetas (pestaña "Estructura de Carpetas")
  api/folder-permissions      Permisos (directos/heredados) de una carpeta
  api/permissions-audit       Auditoria de permisos de todo el proyecto (pestaña)
  api/graficos/psets          Lectura de bibliotecas de propiedades (Graficos de Modelos)
  api/graficos/propiedades    Lectura de los atributos de Propiedades para Graficos (solo lectura)
  api/propiedades/            Definiciones (CRUD), consulta y upsert de valores por IFCGUID
  api/validacion/config       GET/PUT de la configuracion por proyecto
  api/validacion/analyze      Ejecuta el analisis (boton "Analizar")
  api/validacion/results      Pagina de resultados (con filtros)
  api/validacion/export       Descarga .xlsx / .csv
  api/validacion/duplicates         Pagina de grupos duplicados (con filtros)
  api/validacion/duplicates/export  Descarga .xlsx / .csv de duplicados
components/
  ExtensionShell.tsx          Conexion con Trimble Connect (compartida)
  Dashboard.tsx, ...          Resumen Archivos
  folderTree/                 Estructura de Carpetas: arbol, fila, panel de permisos
  permissionAudit/            Auditoria de Permisos: tarjetas, lista, hook de estado
  validacion/                 Validacion: configuracion, probador, resultados, duplicados
  graficos/                   Graficos de Modelos: conexion con el visor, modelos, datos, graficos
  propiedades/                Propiedades: conexion (proyecto/visor), catalogo, formulario, fecha DD-MM-AAAA
lib/
  trimbleApi.ts, walkProjectTree.ts, cache.ts   API REST y recorrido (compartidos)
  folderTree.ts                Construye el arbol anidado + colores por nivel (server)
  folderTreeClient.ts          Aplanado para react-window, busqueda, localStorage (cliente)
  permissions.ts                Resuelve permisos directos/heredados de una carpeta
  permissionAudit.ts           Recorrido resumible + clasificacion para la auditoria
  access.ts                   Comprueba que el token sea de un miembro del proyecto
  validacion/                 Analizador, configuracion, filtros, exportacion,
                              duplicados, almacenamiento (Supabase o Upstash Redis) y pruebas
  graficos/                   Lectura del visor 3D, datos en comun, agregacion, bibliotecas
                              de propiedades, atributos de Propiedades, informe PDF (con pruebas)
  propiedades/                IFCGUID, valores y fechas, formulario (mixtos), servicio, almacenamiento
                              (Supabase o memoria), cliente HTTP y lectura de la seleccion (con pruebas)
  psetApi.ts                  Cliente del servicio Property Set de Trimble Connect (servidor)
public/
  manifest.json, icon.svg                       Resumen Archivos
  manifest-validacion.json, icon-validacion.svg Validacion
  manifest-graficos.json, icon-graficos.svg     Graficos de Modelos
  manifest-propiedades.json, icon-propiedades.svg  Propiedades (proyecto + visor 3D)
  manifest-propiedades-visor.json                  Propiedades, respaldo solo para el visor 3D
supabase/
  validacion_config.sql       Tabla de Validacion
  propiedades.sql             Tablas, vista y funcion de Propiedades
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
   - **Para "Propiedades"**, ejecuta también, una sola vez,
     [`supabase/propiedades.sql`](supabase/propiedades.sql) en el mismo SQL
     Editor. Usa las mismas variables, así que no hay nada más que configurar.
     "Propiedades" requiere Supabase: no funciona con Upstash Redis.
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
   | Gráficos de Modelos | `https://trimble-docs.vercel.app/manifest-graficos.json` |
   | Propiedades | `https://trimble-docs.vercel.app/manifest-propiedades.json` |
   | Presupuesto | `https://trimble-docs.vercel.app/manifest-presupuesto.json` |

5. Selecciona **Add**. La extensión deberia aparecer en el menu lateral del
   proyecto, junto a las demas (Resumen Archivos con icono de carpeta azul;
   Validación con un documento con marca de verificación). Si no aparece,
   recarga la pestaña de Trimble Connect.
   **Gráficos de Modelos** no aparece en el menú lateral: aparece con
   categoría *3D Viewer*. Abre un modelo en el visor 3D y elígela en el
   panel de extensiones del visor.
   **Propiedades** aparece en los dos lugares con un solo manifiesto: el
   catálogo en el menú lateral y el formulario en el panel de extensiones
   del visor 3D. Si no aparece en el visor, instala además
   `https://trimble-docs.vercel.app/manifest-propiedades-visor.json` desde
   la configuración de extensiones del visor.
   **Presupuesto** funciona igual: el presupuesto en el menú lateral y la
   asociación de partidas en el visor (respaldo:
   `https://trimble-docs.vercel.app/manifest-presupuesto-visor.json`).
6. Al abrir Resumen Archivos o Validación por primera vez, Trimble Connect
   pedira tu consentimiento para que la extension pueda leer el access token
   del usuario actual (esto es lo que permite leer los documentos del
   proyecto). Acepta el mensaje para que el panel cargue los datos. Gráficos
   de Modelos solo pide este consentimiento cuando se usan las bibliotecas de
   conjuntos de propiedades; para lo demás lee lo que ya está cargado en el
   visor.

Si en algun momento quieres revocar el permiso, puedes hacerlo desde la
configuracion de la extension dentro del proyecto.

## Desarrollo local

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # pruebas del analizador de nomenclatura (35+ casos)
```

Las paginas `/extension`, `/validacion`, `/graficos` y `/propiedades` (estas dos
también dentro del visor 3D) solo funcionan correctamente
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
- "Gráficos de Modelos" solo puede leer los modelos **cargados** en el visor
  (así funciona el Workspace API). Un modelo grande (decenas de miles de
  objetos) tarda en leerse la primera vez, porque las propiedades se piden al
  visor en lotes de 250.
- En modelos exportados desde Revit/Navisworks (NWC/NWD), el visor también
  entrega como "objetos" los nodos de la jerarquía (archivo, nivel,
  categoría, familia...). Si esos nodos tienen el dato elegido como
  categoría (p. ej. un "Name"), también se cuentan. Los datos de cantidades
  (longitud, área, volumen) normalmente solo los tienen los elementos
  reales, así que las sumas no se ven afectadas.
- "Validación" no restringe la pantalla de configuración por rol (cualquier
  miembro del proyecto puede guardarla); la última en guardar gana.
- Las exportaciones se descargan como archivo desde el navegador; si Trimble
  Connect embebiera la extensión en un iframe con `sandbox` sin
  `allow-downloads`, el navegador podría bloquear la descarga.
- "Duplicados" agrupa por **nombre exacto** (con extensión); no detecta
  archivos renombrados ni compara el contenido. "Probable vigente" se basa
  solo en la fecha de modificación que reporta Trimble Connect, no en
  metadatos ni propiedades personalizadas del archivo - es una sugerencia
  para que el equipo decida, no una verificación de contenido.
