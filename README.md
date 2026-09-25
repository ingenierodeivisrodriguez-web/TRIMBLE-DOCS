# Extensiones para Trimble Connect

Este repositorio es una sola app Next.js (desplegada en Vercel) que contiene
**dos extensiones de proyecto y una extensión del visor 3D** para Trimble Connect:

| Extensión | Dónde aparece | Página que se embebe | Manifiesto |
|---|---|---|---|
| **Resumen Archivos** — estadísticas de los documentos del proyecto | Menú lateral del proyecto | `/extension` | `/manifest.json` |
| **Validación** — valida la nomenclatura de los archivos contra reglas configurables | Menú lateral del proyecto | `/validacion` | `/manifest-validacion.json` |
| **Gráficos de Modelos** — gráficos con los datos de los modelos 3D cargados | Panel de extensiones del visor 3D | `/graficos` | `/manifest-graficos.json` |

Las dos extensiones de proyecto comparten la conexión con Trimble Connect
([`components/ExtensionShell.tsx`](components/ExtensionShell.tsx)), el acceso a
la API REST ([`lib/trimbleApi.ts`](lib/trimbleApi.ts)) y el recorrido
recursivo de carpetas ([`lib/walkProjectTree.ts`](lib/walkProjectTree.ts) +
[`lib/cache.ts`](lib/cache.ts)). "Gráficos de Modelos" es independiente: no usa
la API REST ni el backend, lee directamente del visor 3D.

- [Resumen Archivos](#resumen-archivos)
  - [Estructura de Carpetas (pestaña)](#estructura-de-carpetas-pestaña)
  - [Auditoría de Permisos (pestaña)](#auditoría-de-permisos-pestaña)
- [Validación](#validación)
- [Gráficos de Modelos (visor 3D)](#gráficos-de-modelos-visor-3d)
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
6. **Gráficos con los datos**: se construyen al instante. Las barras
   verticales muestran las 12 categorías mayores, las horizontales las 15 y
   el circular 6; el resto se agrupa en "Otros". Cada gráfico tiene **Ver
   tabla** con todas las categorías, y un pie con cuántos objetos tienen
   esos datos.
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
    Usa, en orden fijo, los 8 colores de la paleta validada para daltonismo;
    si hay más categorías, las menores se agrupan en "Otros" (gris), así
    nunca se repite un color. En el comparativo, A se pinta azul y B
    naranja. Solo un gráfico colorea el modelo a la vez: activarlo en otro
    quita los colores del anterior. Si cambian los datos, los filtros o el
    gráfico, los colores del modelo se actualizan solos. Al desactivarlo se
    restauran exactamente los objetos pintados (`color: "reset"`); los demás
    objetos nunca se tocan. Si se cierra el panel con colores activos,
    quedan en el modelo hasta "Restablecer modelo" en Trimble Connect.
12. **📄 Exportar PDF**: genera en el navegador (con `jspdf`, que se carga solo
    al exportar) un informe A4 con:
    - una portada con el proyecto, la fecha, los modelos con su cantidad de
      objetos, los filtros aplicados y el índice;
    - una página por gráfico, con la imagen del gráfico coloreado, una
      captura del **modelo 3D coloreado según ese gráfico** y la tabla de
      datos, con el color de cada categoría (en el comparativo: A, B y la
      diferencia).

    Para las capturas, la extensión pinta el modelo gráfico por gráfico
    (`viewer.getSnapshot()`, con la cámara que el usuario tenga en ese
    momento) y al final lo deja como estaba. Las capturas se guardan en JPEG
    para que el archivo pese poco (unos 200 KB con tres gráficos).

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

**Colores**: las barras usan un solo color (son una sola serie). El circular
usa, en orden fijo, 6 colores de una paleta validada para daltonismo, más
gris para "Otros". El comparativo usa los dos primeros colores de esa
paleta, validados juntos. Como algunos colores tienen poco contraste sobre
blanco, los gráficos de varias series llevan leyenda con nombres y cada
gráfico tiene su vista de tabla.

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
  api/summary, api/files      API de Resumen Archivos
  api/tree                    Arbol de carpetas (pestaña "Estructura de Carpetas")
  api/folder-permissions      Permisos (directos/heredados) de una carpeta
  api/permissions-audit       Auditoria de permisos de todo el proyecto (pestaña)
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
lib/
  trimbleApi.ts, walkProjectTree.ts, cache.ts   API REST y recorrido (compartidos)
  folderTree.ts                Construye el arbol anidado + colores por nivel (server)
  folderTreeClient.ts          Aplanado para react-window, busqueda, localStorage (cliente)
  permissions.ts                Resuelve permisos directos/heredados de una carpeta
  permissionAudit.ts           Recorrido resumible + clasificacion para la auditoria
  access.ts                   Comprueba que el token sea de un miembro del proyecto
  validacion/                 Analizador, configuracion, filtros, exportacion,
                              duplicados, almacenamiento (Supabase o Upstash Redis) y pruebas
  graficos/                   Lectura del visor 3D, datos en comun y agregacion (con pruebas)
public/
  manifest.json, icon.svg                       Resumen Archivos
  manifest-validacion.json, icon-validacion.svg Validacion
  manifest-graficos.json, icon-graficos.svg     Graficos de Modelos
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
   | Gráficos de Modelos | `https://trimble-docs.vercel.app/manifest-graficos.json` |

5. Selecciona **Add**. La extensión deberia aparecer en el menu lateral del
   proyecto, junto a las demas (Resumen Archivos con icono de carpeta azul;
   Validación con un documento con marca de verificación). Si no aparece,
   recarga la pestaña de Trimble Connect.
   **Gráficos de Modelos** no aparece en el menú lateral: aparece con
   categoría *3D Viewer*. Abre un modelo en el visor 3D y elígela en el
   panel de extensiones del visor.
6. Al abrir Resumen Archivos o Validación por primera vez, Trimble Connect
   pedira tu consentimiento para que la extension pueda leer el access token
   del usuario actual (esto es lo que permite leer los documentos del
   proyecto). Acepta el mensaje para que el panel cargue los datos. Gráficos
   de Modelos no pide este consentimiento: solo lee lo que ya está cargado en
   el visor.

Si en algun momento quieres revocar el permiso, puedes hacerlo desde la
configuracion de la extension dentro del proyecto.

## Desarrollo local

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # pruebas del analizador de nomenclatura (35+ casos)
```

Las paginas `/extension`, `/validacion` y `/graficos` (esta, dentro del
visor 3D) solo funcionan correctamente
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
