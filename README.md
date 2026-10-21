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
| **Manuales** — los manuales de la empresa, leídos desde la carpeta de MANAGER PROJECT para las personas que autorice su administrador | Menú lateral del proyecto | `/manuales` | `/manifest-manuales.json` |
| **Compras y Contratación** — abastecimiento a partir de los insumos del presupuesto, con accesos por rol y auditoría (primera fase: accesos) | Menú lateral del proyecto | `/compras` | `/manifest-compras.json` |
| **Control de Obra** — control de cantidades, costos, avance y calidad ligado a los modelos 3D, multiempresa con licencias, roles y bitácora (fase 3: base comercial) | Menú lateral del proyecto | `/control-obra` | `/manifest-control-obra.json` |
| **Requisitos BIM (LOIN)** — qué se modela, con qué detalle y con qué información por disciplina y etapa, y (fases siguientes) la auditoría de los modelos contra eso | Menú lateral del proyecto (requisitos y matriz) **y** panel del visor 3D (asociación con los modelos) | `/loin` | `/manifest-loin.json` |

Además, **`/bim-apps`** es la página web pública del negocio ("BIM Apps para
Trimble Connect"): presenta Manuales y sus planes (leídos de la venta en
línea), cómo comprar, los medios de pago y el contacto, con sus
[términos y condiciones](app/bim-apps/terminos/page.tsx) y su
[política de tratamiento de datos (Ley 1581)](app/bim-apps/privacidad/page.tsx).
Es la "Página web" que piden Wompi y Mercado Pago. Los datos del
responsable están en [`lib/sitio/negocio.ts`](lib/sitio/negocio.ts).

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
- [Manuales (proyecto)](#manuales-proyecto)
- [Compras y Contratación (proyecto)](#compras-y-contratación-proyecto)
- [Control de Obra (proyecto)](#control-de-obra-proyecto)
- [Requisitos BIM (LOIN) (proyecto)](#requisitos-bim-loin-proyecto)
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
  Materiales o 34 Roles). Lo que se cobra como porcentaje usa la unidad
  **%MO** (de la mano de obra de la partida, lo usual para la herramienta
  menor) o **%** (de la suma de las demás líneas de la partida).
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
  Los títulos se contraen con ▼; la descripción y la unidad se editan con
  doble clic, y el **metrado con un clic** (Enter lo guarda y pasa al de la
  partida siguiente, como en una hoja de cálculo; Escape cancela). El metrado
  que sale del modelo 3D se cambia a manual desde la partida (✎). La celda que
  se está escribiendo, aquí y en el análisis de precios, se ilumina en
  amarillo.
- Una partida nueva se escribe o se **copia del catálogo** (con sus insumos y
  subpartidas). Es una copia: su APU se ajusta en el presupuesto sin cambiar
  el catálogo.
- **📚 Al catálogo** (en la barra, y *Guardar en el catálogo* junto al análisis
  de la partida elegida): el camino de vuelta. Guarda en el catálogo de
  partidas la partida elegida, las de un título, las del subpresupuesto o todo
  el presupuesto, con su análisis, para usarlas en otros proyectos (por
  ejemplo las que creó el Asistente IA, que van solo al presupuesto). Los
  insumos que el catálogo no tiene se crean con el precio del presupuesto (y
  el mismo id); los que tiene conservan el precio del catálogo, y la ventana
  muestra el CU que tendrá allá. Una partida repetida (en cada piso) se guarda
  una vez, y las subpartidas que usa también pasan. Cada fila sale como
  **nueva**, **ya igual** o **distinta** de la del catálogo (la de origen, o una
  con la misma descripción y unidad): una distinta queda como está a menos que
  se elija actualizarla (conserva su código, OmniClass y diccionario si el
  presupuesto no los tiene) o guardarla como otra. Un código que ya usa otra
  partida o insumo del catálogo se deja vacío, con aviso. Después, las filas
  del presupuesto quedan enlazadas a esas partidas (hay que Guardar el
  presupuesto). El responsable de la EDT no pasa al catálogo.
- **Precios del presupuesto.** Al usarse por primera vez, cada insumo copia el
  precio del catálogo. Cambiar su PU (en un APU o en la Lista de insumos) lo
  cambia en todas las partidas de ese presupuesto. "Actualizar precios del
  catálogo" vuelve a traer los del catálogo.
- **Cálculo** (igual que en la referencia, verificado con sus cifras):
  - cantidad de una línea con cuadrilla = cuadrilla × jornada ÷ rendimiento
    para los insumos por hora (HH, HM), y cuadrilla ÷ rendimiento para los
    que se pagan por día o jornal (DIA, JR) (si escribes la cantidad, se
    recalcula la cuadrilla);
  - parcial = cantidad × PU, redondeado a 2 decimales (cantidades a 4);
  - una línea %MO = su porcentaje de la mano de obra de la partida, y una
    línea % = su porcentaje de la suma de las demás líneas (MO, MT, EQ, SC y
    SP, sin otras de porcentaje); su PU se calcula solo y su cantidad es el
    porcentaje;
  - una subpartida aporta su CU por la cantidad;
  - CU = MO + MT + EQ + SC + SP;
  - el parcial de una partida es metrado × CU, y un título suma sus partidas
    por columna;
  - CD (costo directo) es la suma del subpresupuesto.
- Al seleccionar una partida se abre abajo su **análisis de precios
  unitarios**, editable: rendimiento, jornada, cuadrillas, cantidades, PU,
  agregar insumo (buscador por nombre o código; si lo que escribes no existe,
  aparece un botón flotante **Crear Insumo** que abre el diálogo de nuevo insumo
  con el nombre ya escrito y, al aceptar, lo agrega a la partida), agregar subpartida (del
  presupuesto o del catálogo) o crear una nueva. Se impide una subpartida que
  se contenga a sí misma.
- **La mano de obra y los equipos por tiempo** (HH, HM, DIA, JR) se calculan
  solos con el rendimiento y la jornada: basta la **cuadrilla** (1 al
  agregarlos), y su cantidad aparece en gris, calculada, con la cuenta al
  pasar el mouse. Si se escribe la cantidad, se guarda la cuadrilla que la da,
  así sigue cambiando con el rendimiento y la jornada. Las líneas que tienen la
  cantidad escrita a mano (sin cuadrilla, por ejemplo de un Excel o de una
  versión anterior) se señalan con un aviso y **Calcular con cuadrilla** las
  pasa a la cuadrilla que da su cantidad de hoy; una cuadrilla de más de 20 se
  marca en amarillo (casi siempre es una cantidad escrita como cuadrilla). La
  jornada cambia lo que se paga por hora; lo que se paga por día depende solo
  del rendimiento.
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

### Origen del metrado, memoria de cantidades y EDT

- **Origen del metrado.** En el diálogo de cada partida, "Origen del metrado"
  elige **Manual** (el metrado que escribes) o **Asociado al modelo 3D** (la
  suma de sus elementos). En la grilla, cada partida muestra una marca:
  **3D** (automático desde el modelo) o **Manual**; el panel de análisis
  también lo dice. Una partida en modo manual conserva sus elementos
  asociados, pero no toma el metrado de ellos. Si no se elige, la partida usa
  el modelo cuando mide sus elementos.
- **Memoria de cantidades.** Las partidas con elementos asociados muestran
  junto a su nombre un botón ▼ con el número de elementos. Al pulsarlo, el
  listado **se despliega dentro del presupuesto**, entre sus filas: las
  partidas de abajo se corren y la barra lateral se ajusta. Cada elemento
  muestra las columnas elegidas, su **cantidad**, el **PU** de la partida y el
  **valor** (cantidad × PU), con los totales abajo. Ejemplo: una partida de
  5 m² con tres elementos de 2, 2 y 1 m² da valores de 2×PU, 2×PU y 1×PU. Si
  la suma de los elementos no coincide con el metrado de la partida, lo avisa.
  Con muchos elementos el listado muestra 12 filas y se desplaza por dentro.
  **Ordenar:** al pulsar el título de una columna (también Cantidad y Valor) el
  listado se ordena de forma ascendente (▲); otro clic, descendente (▼); un
  tercero vuelve al orden de siempre. Los textos se ordenan en orden natural
  ("Nivel 2" antes que "Nivel 10"), los números por valor, y los elementos sin
  dato en esa columna quedan al final. El orden es solo para verlos: no cambia
  nada guardado y se reinicia al abrir otra partida.
- **Columnas de la memoria (⚙ Configuración).** Administradores y editores
  eligen hasta 6 columnas, en el orden que quieran y con el título que
  quieran. Cada una puede ser:
  - una **propiedad del modelo**, elegida de la **lista de propiedades de los
    modelos cargados** en el visor (con su grupo, tipo y cuántos elementos la
    tienen), o escrita por su nombre si no aparece (sin importar mayúsculas ni
    tildes). Se lee al asociar los elementos en el visor y se guarda con ellos;
    tras cambiar las columnas, el botón **Actualizar los datos de la memoria
    desde el modelo** del panel del visor la vuelve a leer;
  - un **atributo de la app Propiedades** (se ve siempre el valor actual,
    con las fechas como DD-MM-AAAA);
  - el **IFCGUID** del elemento.

  Las de fábrica son Bloque, Conjunto, Zona, Nombre de zona y Espacio.

  **Los datos del modelo no aparecen solos.** Se leen del modelo cuando los
  elementos se asocian. Los elementos asociados antes de elegir las columnas no
  los tienen: en el visor, ⚙ Columnas o el botón **"Actualizar la memoria de
  todas las partidas"** los lee de una vez (y el de cada partida, solo esa). El
  panel del visor siempre usa las columnas vigentes del proyecto, aunque las
  hayas cambiado después de abrirlo. Si todas las filas salen sin datos, el
  pie de la memoria lo avisa.

  **Actualizar todas las partidas desde Configuración.** En el menú del
  proyecto, ⚙ Configuración → *Columnas de la memoria de cantidades* tiene el
  botón **"Actualizar la memoria de todas las partidas"**. El menú no puede leer
  los modelos (Trimble solo da el visor 3D en su propio panel), así que el botón
  lo hace en dos pasos, como "Ver 3D": deja la tarea guardada para esa persona
  (`presupuesto_vistas.tarea = 'memoria'`, 30 minutos, una sola vez) y abre el
  visor con el modelo que tiene más elementos asociados. Al abrirse, el panel
  **Presupuesto** del visor ve la tarea y por sí solo: busca los modelos de todos
  los elementos asociados, **carga los que no estén cargados** (y espera a que
  terminen), lee las columnas elegidas de cada elemento, guarda la memoria en
  cada partida y **descarga los modelos que cargó** para dejar el visor como
  estaba. El botón del panel (con el número de partidas) hace lo mismo sin pasar
  por el menú. Guarda el presupuesto antes de pulsarlo: abrir el visor cierra el
  menú y los cambios sin guardar se perderían (la app lo avisa y no continúa).
  Los elementos que no se encuentran conservan sus datos; el resultado aparece
  en el panel (cuántos elementos, cuántos modelos se cargaron y cuáles no
  existen en el proyecto o no terminaron de cargar).

  **De dónde sale la lista de propiedades.** El menú del proyecto no ve el
  visor, así que la lista se lee **desde el panel Presupuesto del visor 3D**
  (botón ⚙ Columnas → "Leer las propiedades de los modelos cargados") y se guarda
  en el proyecto (`presupuesto_campos_modelo`). Desde ahí aparece en
  Configuración del menú del proyecto, para todo el equipo. La lectura rápida
  usa una muestra al azar de 2.000 elementos por modelo; una propiedad que casi
  ningún elemento tiene puede no aparecer, y para eso está la opción "Leer todos
  los elementos". Si cambian los modelos, se vuelve a leer.
- **Ver en 3D.** Cada fila de la memoria tiene **Ver 3D** y el encabezado
  **Ver todos en 3D**. Trimble no deja abrir el visor ya con elementos
  seleccionados desde el menú del proyecto (solo permite abrirlo con un modelo
  cargado), así que se hace en dos pasos: la app deja los elementos pedidos
  guardados para esa persona (`presupuesto_vistas`, duran 30 minutos y se
  usan una sola vez) y abre el visor con el modelo. Al abrir el panel
  **Presupuesto** del visor, este espera a que el modelo termine de cargar,
  selecciona esos elementos y acerca la cámara. Antes de salir hay que haber
  guardado el presupuesto (si no, la app avisa). "Seleccionar sus elementos en el
  modelo" también acerca la cámara.
- **Diccionario de la EDT.** Cada partida guarda **Descripción del trabajo**,
  **Criterios de aceptación** y **Responsable** (texto libre). Se editan en el
  diálogo de la partida y el panel de análisis muestra el responsable y un
  resumen de los otros dos.

### Importar desde Excel

"Importar Excel" descarga una plantilla con instrucciones y estas hojas:

- **Insumos**
- **Partidas**, con las columnas del diccionario EDT: Descripción del trabajo,
  Criterios de aceptación y Responsable (en blanco, borran el dato guardado; sin
  las columnas, se conserva).
- **Insumos de partida** (antes APU): una fila por insumo o subpartida de cada
  partida, con su cuadrilla o cantidad. Es lo que arma el análisis de precios
  de la partida; la hoja Partidas solo trae sus datos generales.
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

### Programación (Gantt)

El botón **📅 Programación (Gantt)** del encabezado cambia el presupuesto por su
programación. Se arma sola desde la EDT del presupuesto: cada subpresupuesto,
título y partida es una fila (con su número de fila, que es como se escriben
las predecesoras), y los títulos abarcan sus partidas. Usa lo que se ve en
pantalla, aunque el presupuesto tenga cambios sin guardar. La programación se
guarda aparte (botón **Guardar** o Ctrl+S, con su propia versión); al volver
al presupuesto los cambios sin guardar se conservan y la barra lo avisa.

- **Duración.** Si no se escribe, sale de **metrado ÷ (rendimiento ×
  cuadrillas)**. El rendimiento es por jornada de la partida (normalmente
  8 h) y se convierte a la jornada del calendario. Escrita a mano se ve en
  negrita; borrarla vuelve a la estimada. 0 días es un hito (rombo).
- **⏱ Estimar duración** muestra, partida por partida, la duración actual, la
  estimada y la que queda. Se elige el redondeo (días enteros, medios días o
  sin redondear) y si reemplaza también las escritas a mano.
- **Inicio y fin.** El proyecto tiene una fecha de **Inicio** y el **Fin** se
  calcula (con los días hábiles). **Fecha fin** es opcional: se marca con una
  línea morada y avisa si el proyecto termina después.
- **Predecesoras.** En la columna se escriben filas: `4` (fin-comienzo),
  `6CC+2` (empieza 2 días después de que empiece la 6), `9FF` (termina
  cuando termina la 9), `3CF`, y con **desfase negativo para adelantarse**:
  `5-1` empieza un día antes de que termine la 5. Se separan con `;`. Solo
  se enlazan partidas; no se aceptan ciclos ni filas inexistentes (el error
  aparece en la barra y en la celda). Doble clic en una partida abre su
  detalle, con las predecesoras en lista (partida, tipo, desfase), sus
  sucesoras, las cuadrillas y la fecha "no comenzar antes de".
- **Enlazar arrastrando.** En el diagrama, se pulsa sobre la barra de una
  actividad y se arrastra: sale una línea verde punteada y la fila de destino
  se resalta. Al soltar sobre otra partida, la primera queda como su
  predecesora **fin a comienzo** y aparece la flecha (si ya estaba enlazada,
  sería un ciclo o es un título, la barra de estado lo dice). Cerca del borde,
  el diagrama se desplaza para llegar a filas o días fuera de la vista.
- **Doble clic en una flecha** abre *Dependencia entre tareas*: De, Con, el
  **Tipo** (fin a comienzo, comienzo a comienzo, fin a fin, comienzo a fin) y el
  **Retardo** en días hábiles (con flechas; negativo para adelantarse), con
  **Eliminar**, **Aceptar** y **Cancelar**. Al pasar el ratón la flecha se
  resalta en azul.
- **Fecha fija.** Escribir una fecha en *Inicio* de una partida fija "no
  comenzar antes de" (📌); borrarla la quita.
- **Calendario laboral.** Horas de trabajo de cada día de la semana (un
  sábado de 4 h cuenta medio día), las horas que equivalen a un día de
  duración y los **días especiales**: festivos (0 horas) o días con otro
  horario, uno por uno. El botón **Festivos de Colombia** agrega los del año
  elegido (Ley Emiliani: los que se corren al lunes, y Semana Santa).
  El diagrama sombrea los días sin trabajo.
- **Ruta crítica.** Se calcula con el método de la ruta crítica (CPM), en horas
  de trabajo: holgura = inicio tardío − inicio temprano. **Mostrar ruta
  crítica** pinta de rojo las barras y los enlaces sin holgura; la columna
  *Holgura* dice cuántos días puede retrasarse cada partida.
- **📈 Curva S** semanal (lunes a domingo) o mensual: valor de cada periodo
  (barras) y % acumulado (línea), con su tabla, por subpresupuesto o de todo.
- **Calendario valorizado**: el parcial de cada partida repartido mes a mes (o
  semana a semana) según sus horas de trabajo en cada periodo; los títulos
  suman sus partidas y cada mes muestra su % del total.
- **Calendario de insumos**: cada insumo (de las partidas y sus subpartidas,
  también los "%MO") repartido mes a mes siguiendo a las partidas que lo usan,
  en **costo** o en **cantidades**.
- **Excel**: la programación, el calendario valorizado, el de insumos y la
  curva S en un libro; cada ventana exporta también lo suyo.

### EDT de la programación: entregables, actividades y su enlace con el presupuesto

Como pide el PMI, cada estructura tiene su uso y aquí quedan **enlazadas, no
copiadas**:

- **Presupuesto (estructura de costos):** cuánto cuesta, por capítulos y
  partidas con su análisis de precios. No cambia.
- **EDT de la programación (WBS):** qué se entrega, por entregables y ubicación
  (torre, piso, zona). Sus nodos de abajo son los **paquetes de trabajo**, con
  su **responsable** (la cuenta de control) y su **ubicación en el modelo**
  (filtros sobre las columnas de la memoria de cantidades, por ejemplo Nivel =
  PISO 3).
- **Actividades:** cómo y cuándo. Cada una está en un paquete y hace un **% de
  una o varias partidas** (sin partidas: un hito, un curado o un trámite, sin
  costo). De ahí salen su **cantidad** (% del metrado), su **costo** (el
  parcial de la partida se reparte al centavo entre sus actividades) y su
  **duración estimada** (la suma de cantidad ÷ (rendimiento × cuadrillas) de
  cada partida, como si la misma cuadrilla las hiciera una tras otra; si
  trabajan en paralelo se escribe la duración).

**🗂 Estructura (EDT)** en la barra de Programación. Al principio la
programación sigue el presupuesto (cada partida es una tarea); **Crear la EDT
de la programación** la convierte: cada subpresupuesto y título pasa a ser un
nodo y cada partida una actividad del 100 % **con su mismo id**, sus enlaces y
su duración, así que la línea base, los cortes de avance y las marcas del visor
siguen sirviendo. En la ventana:

- El **árbol** con los paquetes (responsable 👤, ubicación 📍, costo) y sus
  actividades; a la derecha se edita lo elegido: nombre, responsable, dónde va,
  filtros de ubicación, subir y bajar, agregar subpaquetes o actividades,
  eliminar (lo que contiene pasa al paquete de arriba). En una actividad, las
  partidas que hace con su %, su cantidad y su costo, y cuánto suma cada partida
  entre todas sus actividades.
- **Regla del 100 %:** cada partida debe quedar asignada completa y una sola vez.
  Muestra las que les falta y las que tienen de más (también como aviso en la
  barra de Programación) y crea actividades con lo que falta (en el paquete de
  su título del presupuesto si existe, o en SIN CLASIFICAR).
- **Dividir por ubicación** (fase 2): parte una o varias partidas en una
  actividad por ubicación. Las ubicaciones salen **del modelo 3D** (los
  elementos asociados a cada partida, agrupados por una columna de la memoria
  de cantidades, con el % de cada una por cantidad medida o por conteo; los que
  no tienen dato van a «(sin dato)»), o se **escriben a mano** (partes iguales).
  Crea un paquete por ubicación con su filtro del modelo (o los pone en el
  paquete elegido) y arma el **tren**: en cada piso una partida tras otra (fin a
  comienzo) y cada partida de un piso al siguiente, con días de espera. Las
  actividades que reemplaza entregan sus enlaces: lo que iba antes de ellas va
  antes del tren, y lo que venía después, después de su última actividad. Se
  puede invertir el orden (de arriba hacia abajo).
- **🤖 Proponer paquetes y secuencia** (fase 4): para las actividades de un
  alcance (hasta 150), el asistente propone el paquete de trabajo (una ruta
  dentro del alcance) y las predecesoras (FC, CC o FF con desfase en días) con
  la lógica constructiva colombiana. Se revisa fila por fila y se aplica lo
  marcado: crea los paquetes que falten, mueve las actividades y agrega (o
  reemplaza) las predecesoras, descartando las que cerrarían un ciclo. Queda
  como borrador en la evaluación del asistente (tarea «Secuencia
  (programación)»). Se envían nombre, unidad, cantidad, duración y paquete de
  cada actividad, sin precios.

**📐 Línea de balance** (fase 4): las ubicaciones hacia arriba (el primer piso
abajo) y el tiempo hacia la derecha; cada tipo de trabajo (la partida que hacen
sus actividades) es una banda que sube de piso en piso, con su avance del
último corte. Si dos bandas se acercan o se cruzan, esas cuadrillas se van a
estorbar. Se ven hasta 8 trabajos a la vez (cada uno conserva su color) y
también como tabla.

En el Gantt, la columna de la tarea se llama *EDT / actividad* y *Cantidad*; el
calendario valorizado, la curva S y el de insumos se filtran por el primer
nivel de la EDT y siguen a cada partida de cada actividad.

### Línea base y control de avance (valor ganado)

Tres botones de la barra de Programación:

- **Línea base**: congela la programación aprobada: las fechas, las horas, la
  duración y el costo de cada partida, título y subpresupuesto, con el
  calendario. Solo se guarda con el presupuesto y la programación guardados.
  Una sola es la **vigente** (contra ella se mide el avance); al reprogramar se
  guarda otra y las anteriores se conservan (no se borran) y se puede volver a
  medir contra cualquiera. La ventana compara la programación de hoy con la
  vigente (fin y costo). En el Gantt, **Ver línea base** dibuja bajo cada barra
  la de la línea base (gris), y cada barra se rellena con el % del último corte.
- **Avance**: los **cortes** de avance, uno por fecha. Un corte nuevo parte del
  anterior (el avance y el costo son acumulados). Por partida se escribe el
  **% real** o la **cantidad ejecutada** (se convierte en % con el metrado) y,
  si se lleva, el **costo real acumulado**. Al lado: costo, inicio y fin de la
  línea base, el **% planeado** a la fecha del corte, el valor ganado y el
  estado (sin iniciar, atrasada, al día, adelantada, terminada); los títulos
  suman sus partidas. Avisa si un % es menor que en el corte anterior. **Leer el
  avance del modelo 3D** trae, a la fecha del corte, el % que dan los
  elementos marcados como ejecutados en el visor (por cantidad medida, o por
  conteo si la partida no mide); se usa partida por partida o en bloque, siempre
  confirmándolo: nunca reemplaza lo escrito sin preguntar. Las partidas que no
  están en la línea base se pueden registrar, pero no cuentan en el valor ganado
  hasta guardar otra línea base.
- **📊 Valor ganado**: a la fecha de un corte, de todo el presupuesto, de un
  subpresupuesto o de un capítulo: costo de la línea base (**BAC**), valor
  **planeado (PV)**, **ganado (EV)** y **costo real (AC)**; **SPI** = EV ÷ PV y
  **CPI** = EV ÷ AC (con las partidas que tienen costo real), **SV**, **CV**,
  costo estimado al final (**EAC** = BAC ÷ CPI) y, con el **cronograma ganado**
  (la fecha en que la línea base preveía lo ejecutado), el **desfase en días
  hábiles** y la **fecha fin estimada** al ritmo actual. Lo que todavía no debía
  empezar no cuenta como atraso. Una lectura en palabras ("la obra va atrasada 5
  días hábiles y gasta más de lo previsto"), la **curva S planeada contra la
  real** (PV, EV y AC por semana o mes), la tabla de cortes y la tabla por
  capítulo. Se exporta a Excel.

**Con la EDT de la programación** (fase 3): la línea base guarda, de cada
actividad, qué % hace de cada partida con su costo, su ubicación en el modelo y
el responsable de cada paquete. «Leer el avance del modelo 3D» calcula el % de
cada actividad con los elementos de sus partidas **que están en su ubicación**
(las columnas del piso 3 solo cuentan para la actividad del piso 3). En **📊
Valor ganado**, «Ver por» muestra el mismo valor ganado **por la EDT** de la
programación, **por los capítulos del presupuesto** (cada actividad reparte sus
valores entre las partidas que hace) o **por responsable** (cuenta de control: el
paquete con responsable más cercano a cada actividad).

**En el visor 3D** (panel Presupuesto → *Avance de obra*): se seleccionan
elementos y se marcan como **ejecutados** un día, en la partida elegida o en
todas las partidas de esos elementos; si alguno ya estaba ejecutado con otra
fecha, pregunta si cambiarlos todos o marcar solo los pendientes. **Desmarcar**
los vuelve a pendientes. **Colorear** pinta el modelo (todo, o la partida
elegida) a una fecha: verde ejecutado, rojo pendiente y atrasado (su partida
debía terminar según la línea base), amarillo pendiente con su partida en
ejecución, gris pendiente que todavía no le toca; un elemento de varias
partidas toma la peor. El día de ejecución se guarda en la base de datos del
presupuesto, nunca en las propiedades del modelo.

### Asistente IA (fases 0 a 5)

El botón **🤖 Asistente IA** del encabezado abre el asistente. Usa Claude
(Anthropic) o Gemini (Google AI Studio) desde el servidor; la clave vive solo en Vercel. **Nada de lo que
propone entra al presupuesto hasta que una persona lo acepta.**

**Fase 5: preguntas** (pestaña *Preguntar*). Un chat sobre el presupuesto
abierto: qué capítulos y partidas pesan más, qué partidas no tienen análisis,
metrado o precios, cuánto pesa la mano de obra, qué insumos concentran el
costo, qué costos unitarios parecen fuera de lo normal. **Solo lee**: no cambia
nada. Con cada pregunta el navegador envía un resumen del presupuesto tal como
está en pantalla (capítulos y partidas con metrado, costo unitario, parcial y
su división MO/MT/EQ/SC/SP, notas como "sin análisis", el pie, los gastos
generales y la lista de insumos con precios), hasta 150.000 caracteres: si no
cabe, deja fuera las partidas y los insumos de menor valor y lo dice. El
resumen va como datos fijos (en caché entre las preguntas) y la conversación
(las últimas 12 intervenciones) como datos. Las partidas que menciona la
respuesta aparecen como enlaces que cierran el asistente y seleccionan la
partida (abriendo sus títulos). La conversación y la pestaña se conservan
durante la sesión del navegador.

**Fase 4: análisis de precios** (pestaña *Análisis (APU)*). Para las partidas
sin análisis (o todas) propone el **rendimiento**, las **cuadrillas** de mano
de obra y equipos que se pagan por hora o por día (la cantidad sale de
cuadrilla × jornada ÷ rendimiento, o cuadrilla ÷ rendimiento por día, como en
el editor de APU), las **cantidades** de
materiales y subcontratos con su desperdicio, y el porcentaje de lo que se cobra así
(%MO de la mano de obra, lo usual para la herramienta menor, o % de la
partida). Usa los **insumos del catálogo** y, como ejemplo,
hasta 3 **partidas parecidas del catálogo** que ya tienen análisis (por
palabras de la descripción y unidad), sin precios. Si falta un insumo
indispensable, lo propone como **nuevo**. Lo que el servidor acepta: solo
partidas pedidas, rendimiento mayor que 0, códigos del catálogo que se
ofrecieron, un insumo "nuevo" que el catálogo ya tiene se toma del catálogo,
la cuadrilla solo para MO y EQ por hora (HH, HM) o por día (DIA, JR), y si la
IA da una cantidad en su lugar se pasa a la cuadrilla que significa (se
descarta si da más de 100: era una cuadrilla escrita como cantidad); en
%MO o % la cantidad es el porcentaje (hasta 100); nada repetido; sin subpartidas (así
no hay ciclos). El navegador envía lotes de 3 partidas. Cada análisis llega
como borrador con su **confianza** y sus **supuestos**, y la revisión muestra
cada línea con los precios del presupuesto (o del catálogo), el **costo
unitario propuesto**, el actual si la partida ya tenía análisis (al aplicar se
reemplaza), el rango de las **partidas parecidas** con un aviso si queda por
debajo del 75 % de la más barata o por encima del 125 % de la más cara, y
cuántos insumos quedan **sin precio**. Se corrigen el rendimiento, las
cuadrillas y las cantidades, o se quitan líneas, y se **aplica** (los insumos
nuevos se crean una vez en el catálogo sin precio, si la persona puede
editarlo; si no, esas líneas no se agregan) o se **descarta**. Lo aplicado va
al presupuesto: después se guarda como siempre. Los precios nunca vienen de la
IA.

**Evaluar con el catálogo** (en la misma pestaña). Pide el análisis de
partidas del catálogo que ya lo tienen (al menos dos insumos y costo
unitario), sin mostrarle el suyo ni sus copias con la misma descripción, y
compara el costo unitario con los precios del catálogo. Elige siempre la
misma muestra repartida en el catálogo (6, 10, 20 o 30 partidas), así se
puede repetir al cambiar de modelo. Muestra el % de partidas con costo
unitario dentro de ±25 % (meta: 50 %), los insumos inventados (meta: 0) y las
que quedaron sin análisis (meta: 0). No guarda borradores; el uso queda en el
registro como "Evaluación".

**Fase 3: crear la EDT** (pestaña *Crear EDT*). Se describe el proyecto (por
ejemplo "edificio de vivienda estrato 6, 15 pisos, 4 apartamentos por piso, 2
pisos de comercio, sótanos de parqueadero") y se elige agrupar **solo por
capítulos** o **por capítulos y pisos** (con el número de pisos tipo, que se
lee de la descripción), el **detalle** (resumido o detallado) y el
subpresupuesto donde insertar. Primero propone los **capítulos** en orden de
ejecución, con la práctica colombiana; se pueden quitar, renombrar o marcar
"por piso". Luego propone las **partidas de cada capítulo**, una llamada por
capítulo, y **usa las partidas del catálogo** cuando corresponden: así llegan
con su análisis de precios. Las que no están en el catálogo quedan como
partidas nuevas sin análisis. Cada capítulo llega como borrador: se quitan o
corrigen partidas y se **inserta** al final del subpresupuesto (los capítulos
"por piso" se repiten bajo PISO 1, PISO 2...) o se **descarta**. Los metrados
quedan en 0. No pone precios ni metrados.

**Fase 2: insumos** (pestaña *Insumos*). Para las partidas sin análisis de
precios (o todas), revisa qué insumos necesitan (MO, MT, EQ, SC) contra el
catálogo: los que el catálogo ya tiene se señalan, y los que faltan llegan
como borradores con las partidas que los usan (si el mismo insumo sale en
varios lotes, se acumulan sus partidas). Se corrigen tipo, descripción y
unidad, y se **crean en el catálogo sin precio** (quien puede editar el
catálogo); el precio lo pone la persona. El análisis de cada partida se arma
en la fase 4.

El catálogo se envía como **datos fijos** que el proveedor guarda en caché
entre las llamadas de una tarea; si tiene más de 1.500 entradas, se envían las
que más se parecen a lo que se está trabajando.

**Fase 1: diccionario EDT.** Redacta la *descripción del trabajo* y los
*criterios de aceptación* de cada partida para el mercado colombiano:
terminología de obra de Colombia y referencias a la NSR-10, las NTC, el RETIE,
el RETILAP, el RAS (Resolución 0330 de 2017), la NTC 1500 y la NTC 2050, sin
inventar numerales ni valores que no sean seguros. El **responsable** no se
propone. Se eligen las partidas (este subpresupuesto o todo, y solo las que
no tienen texto) y un contexto opcional del proyecto. El navegador envía
lotes de 5 partidas, muestra el avance y el costo, y se puede cancelar. Cada
propuesta llega como **borrador** con su nivel de confianza (alta, media o
baja). En **Revisar diccionario** se corrige el texto si hace falta y se
**acepta** (pasa a la partida; después se guarda el presupuesto como
siempre) o se **rechaza**. Pedir de nuevo una partida reemplaza su borrador
pendiente.

**Qué se envía.** En el diccionario, número, descripción, unidad, capítulo y
OmniClass de cada partida, su texto actual y el contexto escrito. En crear la
EDT, insumos y análisis, además la descripción, unidad y tipo de los insumos y
partidas del catálogo, y los análisis de las partidas parecidas, **sin
precios**. En las preguntas, el resumen del presupuesto **con sus costos y
precios** (la pestaña lo advierte). Nunca nombres de personas ni correos. Los
textos van como datos: si una descripción trae instrucciones, el modelo las
ignora.

**Cupo (fase 0).** Lo fijan los **administradores del proyecto gestor** de la
plataforma (`PRESUPUESTO_IA_PROYECTO_GESTOR`, por ejemplo tu MANAGER
PROJECT), no los clientes. Por proyecto se define si está **habilitado**, el
**cupo mensual del proyecto** y el **cupo mensual por persona**, en pesos
colombianos. Hay valores por defecto para los proyectos sin cupo propio y la
**TRM** con que se pasa el costo del proveedor (en dólares) a pesos. El mes
se cuenta en hora de Colombia. Aviso al 80 % y bloqueo al 100 %: antes de
cada lote se calcula su costo máximo y no se envía si supera lo que queda.
Sin configurar, el asistente está **apagado**. Desde el proyecto gestor (o desde cualquier proyecto, si eres administrador del gestor) la pestaña **Uso y cupo → Administrar cupos** tiene: el cupo del proyecto abierto, **Habilitar otro proyecto** pegando su dirección de Trimble Connect o su id, la lista de **proyectos con cupo propio** con lo gastado en el mes (editable en la misma fila) y los valores por defecto con la TRM. El cupo es por proyecto, no por persona: en un proyecto habilitado lo usan sus administradores y los editores del presupuesto, cada uno con el tope mensual por persona.

**Registro.** Cada llamada queda en `presupuesto_ia_uso`: fecha, persona,
tarea, modelo, partidas, tokens, costo en dólares y en pesos con la TRM
usada, versión de las instrucciones y resultado (correcto, error, rechazado
por la IA o incompleto). La pestaña **Uso y cupo** muestra las barras del
cupo, las últimas 50 solicitudes y la **evaluación por tarea** (crear EDT,
diccionario, insumos, análisis): cuántos borradores se aceptaron sin cambios,
con cambios o se rechazaron (la meta del diccionario es al menos 70 %
aceptados sin cambios; en Crear EDT, "con cambios" es que se quitaron o
corrigieron partidas antes de insertarlas; en Análisis, que se cambió el
rendimiento, una cuadrilla o una cantidad, o se quitaron líneas). Lo aplicado
se compara con lo propuesto sin importar el orden de las claves (la base de
datos, jsonb, no lo conserva). Las preguntas quedan en el registro con sus
primeras palabras.

**Protecciones (fase 5).**

- Cada persona puede hacer hasta **20 solicitudes por minuto** en un proyecto
  (429 `ia-frecuencia`): un ciclo que se descontrole no agota el cupo. El
  navegador no reintenta por cupo ni por frecuencia; sí una vez, a los 6
  segundos, cuando el proveedor está ocupado o limitado.
- Antes de cada llamada: permiso de edición, clave del proveedor, asistente
  habilitado, cupo y costo máximo de la llamada contra lo que queda.
- Todo lo que llega del navegador se valida (tamaños, números, códigos) y todo
  lo que responde el modelo se vuelve a validar antes de mostrarlo o
  guardarlo.
- Para apagar el asistente en un proyecto, se desmarca **Habilitado** en su
  cupo; para apagarlo en toda la plataforma, se quita la clave del proveedor en
  Vercel y se vuelve a desplegar.

**Proveedor y modelo.** La app funciona con dos proveedores detrás de la
misma interfaz y usa el que tenga clave en Vercel (Anthropic primero si hay
las dos; `PRESUPUESTO_IA_PROVEEDOR` lo fuerza):

- **Anthropic (Claude):** `claude-opus-5-5` por defecto, con esfuerzo bajo,
  salida estructurada (JSON Schema), instrucciones en caché y respaldo
  automático del proveedor si un filtro de seguridad rechaza la solicitud
  (`fallbacks: "default"`).
- **Google AI Studio (Gemini):** `gemini-3.8-flash` por defecto, con
  razonamiento bajo y salida en JSON con el mismo esquema. Tiene **nivel
  gratuito** con límites de solicitudes por minuto y por día (los muestra AI
  Studio); en ese nivel **Google puede usar lo enviado para mejorar sus
  productos**, así que sirve para pilotos con datos no confidenciales. En el
  nivel de pago no. Si Google falla de su lado (errores 500/503), el servidor reintenta dos
  veces y, si sigue fallando o si el modelo se queda sin cuota (429), prueba una
  vez con `gemini-3.5-flash-lite` y una solicitud más sencilla (`PRESUPUESTO_IA_MODELO_RESPALDO` lo cambia; `no` lo
  apaga). El registro de uso dice qué modelo respondió, y los errores muestran
  el mensaje de Google.

`PRESUPUESTO_IA_MODELO` cambia el modelo (por ejemplo `claude-sonnet-5-5`
o `gemini-3.5-flash-lite`); su nombre también elige el proveedor. El costo
usa el precio de lista del modelo que respondió; en el nivel gratuito de
Google no se cobra, pero el cupo cuenta ese valor de referencia para seguir
limitando el uso. Google anunció que los precios de 3.8 y 3.6 Flash se
duplican el 01-01-2027.

### Permisos

| Acción | Quién |
|---|---|
| Ver el presupuesto, los catálogos y los elementos asociados | Cualquier miembro del proyecto |
| Usar el asistente IA (también las preguntas) y revisar sus borradores | Administradores del proyecto y los editores del presupuesto |
| Fijar los cupos del asistente IA y la TRM | Administradores del proyecto gestor de la plataforma |
| Editar el presupuesto y su programación, y asociar elementos en el visor | Administradores del proyecto y los **editores** (personas o grupos) que elijan en ⚙ Configuración |
| Guardar líneas base, registrar el avance y marcar elementos ejecutados | Los mismos (los demás miembros consultan el avance, el valor ganado y los colores del modelo) |
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
| `presupuesto_modelos_usados` | Vista: modelos (archivos) de los elementos asociados y cuántos elementos tiene cada uno |
| `presupuesto_guardar_insumos` / `_partidas` | Guardan lotes; una fila con el id de otro catálogo no se toca |
| `presupuesto_guardar` | Guarda el presupuesto si la versión coincide y limpia los elementos de partidas borradas |
| `presupuesto_programacion` | La programación (Gantt) de cada proyecto (jsonb: inicio, fecha fin, calendario, redondeo y, por partida, duración, cuadrillas, predecesoras y fecha fija; o, con la EDT propia, sus nodos y sus actividades con sus asignaciones) con su `version` |
| `presupuesto_guardar_programacion` | Guarda la programación si la versión coincide |
| `presupuesto_lineas_base` | Las líneas base de cada proyecto (jsonb con las filas congeladas), una vigente; no se borran |
| `presupuesto_crear_linea_base` / `presupuesto_usar_linea_base` | Guardan una línea base nueva (queda vigente) / cambian la vigente |
| `presupuesto_avance` / `presupuesto_guardar_avance` | Los cortes de avance (por fecha: % acumulado y costo real de cada partida) con su `version` |
| `presupuesto_elementos.ejecutado` | El día en que se ejecutó cada elemento para su partida (marcado en el visor) |
| `presupuesto_resumen_ejecucion` | Por partida: elementos y cantidades ejecutadas hasta una fecha |
| `presupuesto_ia_cupos` | Cupo del asistente IA por proyecto (`_global`: valores por defecto y TRM) |
| `presupuesto_ia_uso` | Registro de cada llamada al modelo: persona, modelo, tokens, costo USD y COP, resultado |
| `presupuesto_ia_borradores` | Propuestas de la IA con su estado (pendiente, aceptado, rechazado, reemplazado), si se editaron y quién decidió |
| `presupuesto_ia_gasto` / `presupuesto_ia_gasto_proyectos` | Lo gastado en el mes por un proyecto y una persona, y por cada proyecto |
| `presupuesto_ia_resumen_tareas` | La evaluación de los borradores de cada tarea |

RLS está activado y sin políticas: solo el servidor, con la clave de
servicio, lee y escribe.

### API

Todas las rutas usan `?projectId=` y el token del usuario
(`Authorization: Bearer`).

| Método y ruta | Uso |
|---|---|
| `GET /api/presupuesto/estado` | Configuración y qué puede hacer el usuario (`canEdit`, `canEditBase`) |
| `PUT /api/presupuesto/config` | `{ baseProjectId?, editores?, memoriaColumnas? }` (base y editores: administradores; columnas de la memoria: editores) |
| `GET /api/presupuesto/contactos` | Personas y grupos para elegir editores (administradores) |
| `GET /api/presupuesto/atributos` | Atributos de la app Propiedades y propiedades de los modelos (última lectura del visor) para elegir columnas de la memoria de cantidades |
| `POST /api/presupuesto/memoria` | Pedir al panel del visor que actualice la memoria de todas las partidas; responde `{ modelId, modelos, elementos }` (el modelo con que abrir el visor). Solo administradores y editores; 400 si no hay elementos asociados |
| `PUT` / `GET /api/presupuesto/vista` | Pedir ver elementos en 3D `{ itemId, elementos: [{ ifcGuid, modelId }] }` / recogerlos una vez (cualquier miembro, solo los suyos) |
| `PUT /api/presupuesto/campos-modelo` | `{ modelos, campos: [{ key, label, group, kind, count }] }`: guarda las propiedades leídas de los modelos cargados (editores) |
| `GET /api/presupuesto/catalogo` | Insumos, partidas y códigos OmniClass de la base |
| `POST /api/presupuesto/catalogo/insumos` · `.../partidas` · `.../omniclass` | Crear o actualizar en lote (hasta 1.000 por envío) |
| `DELETE /api/presupuesto/catalogo/insumos/{id}` · `.../partidas/{id}` | Eliminar (409 `in-use` si se usa) |
| `GET` / `PUT /api/presupuesto/documento` | Leer / guardar `{ doc, version }` (409 `version-conflict`) |
| `GET /api/presupuesto/ia` | Estado del asistente: disponible, permisos, cupo del mes, registro de uso y evaluación |
| `PUT /api/presupuesto/ia/cupo` | `{ proyecto?, global? }`: cupos y TRM (solo administradores del proyecto gestor) |
| `POST /api/presupuesto/ia/edt` | `{ contexto, partidas }` (hasta 12): propone el diccionario EDT; responde los borradores, el costo y el cupo (402 si no alcanza el cupo) |
| `POST /api/presupuesto/ia/estructura/capitulos` | `{ descripcion, agrupacion, detalle }`: los capítulos de la EDT |
| `POST /api/presupuesto/ia/estructura/partidas` | `{ descripcion, agrupacion, detalle, capitulo, otros, catalogo }`: las partidas de un capítulo, guardadas como borrador |
| `POST /api/presupuesto/ia/insumos` | `{ contexto, partidas, catalogo }`: insumos de un lote; los que faltan quedan como borradores |
| `POST /api/presupuesto/ia/apu` | `{ contexto, partidas, catalogo, evaluar? }` (hasta 6 partidas, cada una con hasta 3 parecidas): el análisis de precios de un lote, guardado como borrador (con `evaluar`, solo se responde) |
| `POST /api/presupuesto/ia/programa` | `{ contexto, alcance, actividades }` (hasta 150): paquetes de trabajo y predecesoras propuestos, guardados como borrador |
| `POST /api/presupuesto/ia/chat` | `{ pregunta, contexto, historial }`: responde una pregunta sobre el presupuesto (`{ respuesta, items }`, con los códigos de las partidas que menciona) |
| `GET` / `PUT /api/presupuesto/ia/borradores` | Borradores pendientes de una tarea (`?tarea=edt\|estructura\|insumos\|apu`) / `{ decisiones: [{ id, estado, final? }] }` (`final` es lo que se aplicó; si difiere de la propuesta cuenta como editado) |
| `GET` / `PUT /api/presupuesto/programacion` | Leer (`programacion: null` hasta el primer guardado) / guardar `{ programacion, version }` (solo quien edita; 409 `version-conflict`) |
| `GET` / `PUT /api/presupuesto/avance` | Los cortes, las líneas base y la vigente con sus filas / guardar `{ avance, version }` (409 `version-conflict`) |
| `GET` / `POST` / `PUT /api/presupuesto/avance/lineas-base` | Una línea base (`?id=`) / guardar `{ nombre, datos }` como vigente / `{ id }` medir contra otra |
| `GET` / `PUT /api/presupuesto/elementos/ejecucion` | Por partida, elementos ejecutados hasta `?hasta=` / marcar `{ marcas: [{ itemId, ifcGuid }], fecha }` (`null`: pendiente; no en el futuro) |
| `GET /api/presupuesto/elementos/avance` | Todos los elementos asociados con su día de ejecución (para colorear el modelo) |
| `GET /api/presupuesto/elementos/resumen` | Mediciones y conteos por partida |
| `POST /api/presupuesto/elementos/consulta` | `{ itemIds }` o `{ ifcGuids }` |
| `PUT /api/presupuesto/elementos` | `{ itemId, upsert: [{ ifcGuid, modelId, cantidad }], remove: [ifcGuid] }` |
| `PUT /api/presupuesto/mediciones` | `{ itemId, campo, campoLabel, unidad }` |

### Configuración

Usa las mismas `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Basta con
ejecutar una vez [`supabase/presupuesto.sql`](supabase/presupuesto.sql) en el
**SQL Editor** de Supabase: mientras no se haga, la API responde con un
mensaje que indica ese paso.

Asistente IA (variables de Vercel, nunca en el repositorio):

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Clave del API de Anthropic (proveedor Claude) |
| `GEMINI_API_KEY` | Clave de Google AI Studio (proveedor Gemini). Sin ninguna de las dos, el asistente dice que no está configurado |
| `PRESUPUESTO_IA_PROVEEDOR` | Opcional. `anthropic` o `google` cuando hay las dos claves |
| `PRESUPUESTO_IA_PROYECTO_GESTOR` | Id del proyecto de Trimble Connect cuyos administradores fijan los cupos (por ejemplo, MANAGER PROJECT) |
| `PRESUPUESTO_IA_MODELO` | Opcional. Modelo a usar (por defecto `claude-opus-5-5` o `gemini-3.8-flash`) |
| `PRESUPUESTO_IA_MODELO_RESPALDO` | Opcional (Google). Modelo que responde si el principal falla o se queda sin cuota (por defecto `gemini-3.5-flash-lite`; `no` lo apaga) |
| `PRESUPUESTO_IA_TRM` | Opcional. TRM inicial (por defecto 4.000) mientras no se guarde una en el asistente |

---

## Manuales (proyecto)

Los manuales de la empresa viven en **una carpeta de un solo proyecto** de
Trimble Connect, el "MANAGER PROJECT", que funciona solo como repositorio. En
cada proyecto donde se instala, **Manuales** (`/manuales`) muestra esa
carpeta: se recorren sus subcarpetas, se busca por nombre y los documentos se
leen dentro de la app.

**Los lectores no entran a MANAGER PROJECT.** La app lee la carpeta con una
**cuenta técnica**: un usuario de Trimble Connect, idealmente dedicado (por
ejemplo `manuales@empresa.com`), miembro solo de MANAGER PROJECT y con permiso
de lectura sobre la carpeta. Quién puede leer lo decide la app, con una
**lista de personas autorizadas por correo**. Quien abre Manuales sin estar
autorizado ve **"No tiene acceso"**. Los administradores de MANAGER PROJECT
siempre pueden leer, y son los únicos que ven la pestaña **"Administrar
acceso"**, donde:

- conectan la cuenta técnica: un inicio de sesión de Trimble en una pestaña
  nueva; la sesión se guarda **cifrada** y se renueva sola;
- autorizan o quitan personas, pegando varios correos a la vez, incluso con
  la forma `Nombre <correo>`;
- dan a cada persona una **licencia**: de 1 a 12 meses desde una fecha, hasta
  una fecha elegida, o sin vencimiento.

**Licencias.** La fecha de vencimiento es el último día con acceso, contado
en hora de Colombia (`MANUALES_ZONA` cambia la zona).

| Estado | Cuándo |
|---|---|
| Activa | La licencia está vigente |
| Por vencer | Le quedan 15 días o menos |
| Vencida | Pasó su último día |
| Suspendida | El administrador la suspendió, aunque siga vigente |
| Sin vencimiento | No tiene fecha de fin |

En cada persona, el botón **Licencia** la cambia o renueva: si sigue
vigente, la renovación empieza al terminar la actual, y si venció, empieza
hoy. **Suspender** y **Reactivar** cortan y devuelven el acceso sin perder la
licencia. Quien tiene la licencia vencida o suspendida ve "No tiene acceso"
con el motivo y la fecha. La lista muestra cuántas personas hay en cada
estado y se puede filtrar por estado.

**Venta en línea con Mercado Pago y Wompi.** En la pestaña **"Ventas"**,
el administrador abre la venta y define los planes: meses (1 a 12) y precio
en pesos. Quien no tiene acceso, o tiene la licencia vencida, ve los planes
en "No tiene acceso". Quien tiene la licencia vigente ve **Renovar** en la
cabecera, resaltado cuando está por vencer. La persona elige un plan y
**con qué pagar**: Mercado Pago (Checkout Pro: tarjetas, PSE, Efecty) o
Wompi (Web Checkout: Nequi, PSE, Bancolombia, tarjetas), según las que
estén configuradas. Paga en una pestaña nueva y, **al aprobarse el pago,
su licencia se crea o se extiende sola**, sin que el administrador haga
nada:

- La licencia va al correo de Trimble Connect de quien compra, y el precio
  sale del plan, nunca de la solicitud.
- Si la licencia sigue vigente, los meses se suman desde su vencimiento; si
  venció (o es nueva), desde hoy.
- Cada compra se aplica **una sola vez** (`manuales_aplicar_pago`, todo en
  una transacción), aunque el pago se notifique varias veces.
- El pago siempre se lee de la pasarela de esa compra antes de aplicarlo,
  así que un aviso falso no abre los manuales; y un pago solo se aplica a
  una compra hecha con esa misma pasarela. En Wompi, cada checkout va
  firmado con el secreto de integridad, así que el monto y la referencia no
  se pueden cambiar. El pago se confirma por cuatro caminos:
  1. el aviso de la pasarela (`notification_url` de cada compra en Mercado
     Pago; la URL de eventos del panel de Wompi);
  2. la página a la que vuelve quien paga;
  3. la pantalla de Manuales, que espera el pago y consulta cada 5 segundos;
  4. la tarea diaria, que revisa las compras pendientes de los últimos 3
     días.
- Un pago por menos del valor queda en **Revisar**, sin licencia.
- Un reembolso o contracargo marca la compra **Reembolsada**. La licencia
  no se quita sola: el administrador decide si la suspende.
- Las cuentas suspendidas o sin vencimiento no pueden comprar.

Los estados de Wompi se traducen a los de Mercado Pago (APPROVED →
aprobado, PENDING → pendiente, DECLINED/ERROR → rechazado, VOIDED →
reembolsado), así que las dos pasarelas comparten las mismas reglas.

La pestaña "Ventas" muestra cómo está configurada cada pasarela y lista las
compras con su estado (pendiente, aprobada, revisar, reembolsada), la
pasarela, el pago y el nuevo vencimiento. Las compras pendientes tienen el
botón **Verificar pago**, que consulta la pasarela al momento.

**Estados de cuenta.** La pestaña **"Estados de cuenta"** (administradores) arma,
para un mes o un año, el estado de las ventas para revisiones fiscales y
control financiero ([`lib/manuales/contabilidad.ts`](lib/manuales/contabilidad.ts)):

- **Recaudo** (caja): ventas aprobadas y reembolsos en el día en que
  ocurrieron (hora de Colombia), recaudo neto y ticket promedio.
- **Ingresos**: cada licencia se reconoce día a día durante su término
  (desde el pago, o desde el vencimiento anterior si se renovó antes de
  vencer). Se muestra el ingreso devengado del período y el diferido al
  cierre, con su conciliación: diferido inicial + ventas no reembolsadas −
  devengado = diferido final. Las compras reembolsadas no generan ingreso.
- Desglose por pasarela, por plan y mes a mes; libro de movimientos con el
  id del pago para conciliar con los extractos de Mercado Pago y Wompi; y
  los pagos por revisar.
- **Exportar a Excel**: hojas Resumen, Por mes, Movimientos y Por revisar.

**Pagos manuales.** Al autorizar o renovar a alguien a mano ("Autorizar" y
el botón "Licencia"), el administrador registra cómo pagó: **pago recibido**
(valor, medio: transferencia, consignación, efectivo, Nequi o Daviplata
directo, datáfono u otro; fecha, referencia y soporte), **cortesía** (queda
en $ 0) o **registrar después**. Esos pagos quedan en `manuales_pagos` con
pasarela `manual` y entran a los estados de cuenta como los de las
pasarelas. En "Ventas" se pueden **anular** con un motivo: quedan como un
reverso, nunca se borran. La alerta **"Licencias sin pago registrado"** de
"Estados de cuenta" lista a quienes tienen acceso sin una compra, un pago
manual o una cortesía que termine cuando termina su licencia, y permite
registrar el pago ahí mismo.

Los valores son brutos: las comisiones, retenciones e impuestos que
descuentan las pasarelas están en sus extractos. No reemplaza la
contabilidad formal ni la facturación electrónica.

Los documentos se suben y actualizan en MANAGER PROJECT como siempre, y Manuales
muestra siempre la versión actual.

**Cómo funciona la cuenta técnica.** Trimble Connect no acepta tokens de
aplicación (*client credentials*): una persona inicia sesión una vez con la
cuenta y el servidor guarda su *refresh token*.

- El inicio de sesión usa el flujo *authorization code* con PKCE de Trimble
  Identity y la app OAuth "apibasedatos".
- Los *refresh tokens* son de un solo uso: cada renovación guarda el nuevo, y
  solo un servidor renueva a la vez (`manuales_tomar_turno`).
- Se cifran con AES-256-GCM, con una clave derivada de
  `TRIMBLE_CLIENT_SECRET`: sin ese secreto, una fila robada no sirve.
- Trimble pide renovar al menos cada 9 días. La tarea diaria de Vercel
  ([`vercel.json`](vercel.json) → `/api/manuales/mantener`) la renueva si
  la última renovación tiene más de 20 horas.

Si la sesión se pierde (por ejemplo, porque cambió el secreto), Manuales
pide al administrador volver a conectar la cuenta.

| Archivo | Cómo se ve |
|---|---|
| PDF | Dentro de la app, dibujado con **pdf.js**. El visor PDF de Chrome no funciona en el marco restringido donde Trimble Connect carga las extensiones ("Chrome ha bloqueado esta página") |
| Word, Excel, PowerPoint, DWG/DXF | La versión PDF que genera Trimble Connect, cuando la tiene |
| Imágenes, video, audio | Dentro de la app |
| TXT, CSV, MD | Como texto |
| Otros (ZIP...) | "Descargar" |

"Abrir en Trimble Connect" aparece solo para los administradores, que son
miembros de MANAGER PROJECT. Los PDF de más de 100 MB no se cargan dentro de
la app.

**Configuración (una vez):**

1. Supabase → SQL Editor: ejecuta [`supabase/manuales.sql`](supabase/manuales.sql).
2. Vercel → Environment Variables:
   - `TRIMBLE_CLIENT_SECRET`, con el Client Secret de "apibasedatos";
   - opcional: `CRON_SECRET`, para que solo Vercel llame a la tarea diaria;
   - para vender licencias: `MERCADOPAGO_ACCESS_TOKEN`, el Access Token de
     tu aplicación de Mercado Pago (Tus integraciones → Credenciales de
     producción). Las de prueba también empiezan por `APP_USR-`: la pestaña
     "Ventas" muestra la cuenta de Mercado Pago conectada y si es de prueba
     (`/users/me`, etiqueta `test_user`), y entonces se paga con una cuenta
     compradora de prueba y las tarjetas de prueba;
   - opcional: `MERCADOPAGO_WEBHOOK_SECRET`, la clave secreta de los
     Webhooks de Mercado Pago, configurados con la URL
     `https://trimble-docs.vercel.app/api/manuales/pagos/webhook` y el evento
     "Pagos": se verifica la firma de los avisos. Sin ella, igual funciona,
     porque cada pago se lee de Mercado Pago antes de aplicarlo;
   - para cobrar con Wompi: `WOMPI_PUBLIC_KEY` (llave pública) y
     `WOMPI_INTEGRITY_SECRET` (secreto de integridad), del panel de
     comercios de Wompi. Las llaves `pub_test_`/`test_` usan el Sandbox y
     las `pub_prod_`/`prod_`, producción; todas deben ser del mismo
     ambiente (la pestaña "Ventas" avisa si no);
   - recomendadas para Wompi: `WOMPI_PRIVATE_KEY` (para consultar las
     compras pendientes por su referencia) y `WOMPI_EVENTS_SECRET` (para
     verificar el checksum de los eventos). En el panel de Wompi, configura
     la URL de eventos `https://trimble-docs.vercel.app/api/manuales/pagos/wompi`;
   - opcional: `MANUALES_URL_PUBLICA`, la dirección pública de la app, si no
     es la de las solicitudes.

   Después, vuelve a desplegar.
3. En MANAGER PROJECT, invita a la cuenta técnica con permiso de lectura
   sobre la carpeta.
4. Conéctala en Manuales → "Administrar acceso" → **Conectar cuenta
   técnica**:
   1. Inicia sesión con la cuenta técnica en la pestaña que se abre.
   2. Al terminar, esa pestaña muestra una página de `http://localhost` que
      no carga.
   3. Copia la dirección completa de la barra y pégala en **Completar
      conexión**.

   **Por qué hay que pegar la dirección:** la app "apibasedatos" solo tiene
   registradas como *Callback URLs* `http://localhost` y la de Postman, y
   la consola de Trimble (console.trimble.com) hoy solo admite usuarios
   internos de Trimble, así que no se puede agregar la de esta app.
   Comprobado contra id.trimble.com: la URL de Manuales responde
   `invalid_grant`, `http://localhost` sí se acepta.

   Si algún día se registra
   `https://trimble-docs.vercel.app/api/manuales/oauth/callback`, define
   `MANUALES_REDIRECT_URI` con esa URL y la conexión se completa sola.

La carpeta está fijada en
[`lib/manuales/config.ts`](lib/manuales/config.ts) (`CARPETA_PREDETERMINADA`):
`https://web.connect.trimble.com/projects/KU8qY2Zf234/data/folder/T3InEwS6b9g`.
La variable `MANUALES_CARPETA` en Vercel la reemplaza por el enlace de otra
carpeta o proyecto.

**API.** Todas las rutas llevan el token del usuario en
`Authorization: Bearer` y `?projectId=` del proyecto donde se abrió.

| Ruta | Uso |
|---|---|
| `GET /api/manuales/estado` | Quién es el usuario, si está autorizado o es administrador, y (para administradores) la cuenta técnica |
| `GET /api/manuales/carpeta?folderId=` | La carpeta de manuales o una subcarpeta (403 `no-autorizado`; 404 `fuera` si no es de los manuales) |
| `GET /api/manuales/buscar?q=` | Búsqueda por nombre en todas las subcarpetas (hasta 400 carpetas o 200 resultados) |
| `GET /api/manuales/archivo?fileId=&pdf=1` | Enlace nuevo al archivo (o a su versión PDF) |
| `GET /api/manuales/archivo/contenido?fileId=&pdf=1` | El contenido, transmitido desde el almacenamiento de Trimble |
| `POST /api/manuales/admin/conectar` | URL de inicio de sesión para conectar la cuenta técnica (administradores) |
| `POST /api/manuales/admin/completar` | `{ enlace }`: la dirección de `http://localhost/?code=…&state=…` pegada por el administrador; completa la conexión |
| `DELETE /api/manuales/admin/cuenta` | Desconectar la cuenta técnica (revoca su sesión) |
| `GET` / `POST` / `PATCH` / `DELETE /api/manuales/admin/autorizados` | Listar (con el estado de cada licencia), autorizar (`{ texto, licencia, pago? }`), cambiar la licencia, suspender/reactivar o registrar un pago (`{ email, licencia?, suspendido?, pago? }`) o quitar (`?email=`). El pago es `{ tipo: "pago", valor, medio, fecha, referencia?, soporte? }` o `{ tipo: "cortesia", fecha?, soporte? }`. La licencia es `{ meses: 1-12, inicio? }`, `{ vence, inicio? }` o `{ sinVencimiento: true }` |
| `GET` / `PUT /api/manuales/admin/venta` | La venta en línea y cómo están configurados Mercado Pago y Wompi; guardar `{ habilitada, planes: [{ meses, precio }] }` (administradores) |
| `GET` / `POST /api/manuales/admin/pagos` | Las compras, de la más nueva a la más vieja; `{ orden }` consulta la pasarela por una compra pendiente; `{ orden, anular: true, motivo }` anula un pago manual (administradores) |
| `GET /api/manuales/admin/contabilidad` | Todas las compras con pago (aprobadas, por revisar y reembolsadas), `hoy` y la zona horaria, para los estados de cuenta (administradores) |
| `POST /api/manuales/pagos` | `{ meses, pasarela: "mercadopago" \| "wompi" }`: inicia la compra de una licencia para el correo de quien llama y devuelve el checkout de la pasarela (`url`) y la compra (`orden`) |
| `GET /api/manuales/pagos/orden?id=` | Cómo va la compra de quien llama; mientras está pendiente, también consulta su pasarela |
| `POST /api/manuales/pagos/webhook` | Avisos de pago de Mercado Pago (Webhooks e IPN). Sin token: el pago se lee de Mercado Pago, y con `MERCADOPAGO_WEBHOOK_SECRET` se exige la firma de los avisos firmados |
| `GET /api/manuales/pagos/retorno` | Página a la que vuelve quien paga en Mercado Pago (`back_urls`); aplica el pago al momento. Sin token |
| `POST /api/manuales/pagos/wompi` | Eventos de Wompi (`transaction.updated`). Sin token: la transacción se lee de Wompi, y con `WOMPI_EVENTS_SECRET` se exige un checksum válido |
| `GET /api/manuales/pagos/retorno/wompi` | Página a la que vuelve quien paga en Wompi (`redirect-url`, `?id=`); aplica el pago al momento. Sin token |
| `GET /api/manuales/oauth/callback` | Vuelta automática del inicio de sesión, si esa URL está registrada (`MANUALES_REDIRECT_URI`). Sin token: la valida el `state` de un solo uso |
| `GET /api/manuales/mantener` | Tarea diaria que mantiene viva la sesión y revisa las compras pendientes |

Códigos de error:

- `no-autorizado` (403);
- `sin-cuenta`, `cuenta-vencida`, `cuenta-sin-acceso`, `sin-oauth` (503:
  el administrador debe revisar la cuenta técnica);
- `trimble-session` (401: recargar Trimble Connect);
- compras (409): `venta-cerrada`, `sin-pasarela`, `pasarela`,
  `suspendida`, `sin-vencimiento`, `plan`; `demasiadas` (429: más de 10
  compras en una hora).

---

## Compras y Contratación (proyecto)

Abastecimiento de la obra a partir de los insumos planificados en
Presupuesto: requisiciones, cotizaciones y proveedores, órdenes de compra y
contratos, documentos en el CDE del proyecto y recepción en obra. Se
construye por fases; ya están **el acceso por rol, la auditoría, la consulta
de los insumos del presupuesto, las requisiciones, los proveedores, las
cotizaciones con su comparativo, las órdenes de compra y contratos, sus documentos en el CDE, la recepción en obra y el panel con la trazabilidad de cada insumo**. Aparece en el menú lateral del
proyecto (`/compras`, `manifest-compras.json`); no tiene panel del visor 3D.

Presupuesto sigue siendo la única fuente de insumos, cantidades y precios:
Compras solo los lee y nunca escribe en las tablas `presupuesto_*`.

### Quién entra

- La identidad es la del usuario de Trimble Connect, comprobada en el
  servidor con su token (igual que en Presupuesto; no hay Supabase Auth).
  Ser miembro del proyecto **no basta**: hace falta un acceso a Compras
  vigente en ese proyecto. Sin él, la página solo dice a quién pedírselo.
- **Activar Compras.** En un proyecto sin administrador de Compras, un
  administrador del proyecto en Trimble Connect ve el botón "Activar Compras
  en este proyecto". Queda como **Administrador de plataforma** (todos los
  permisos, desde hoy y sin fecha final) y se crean los 9 roles iniciales.
  Desde ese momento el botón desaparece y los demás administradores de
  Trimble también necesitan que se les dé acceso. No hay claves ni listas de
  personas en el código.
- Cada acceso es **un rol por persona**, con fecha de inicio y, si se
  quiere, fecha final (ambas incluidas, en hora de Colombia). Revocar no
  borra el registro: queda "Revocada" y se puede reactivar.
- La autorización se lee de la base en **cada solicitud**, sin caché: un
  acceso revocado deja de servir en la siguiente acción, aunque la página
  siga abierta. (La pertenencia al proyecto en Trimble se recuerda 2
  minutos, como en las demás extensiones.)

### Roles y matriz de permisos

Un permiso es un módulo con una acción. Los módulos son todos los de la
herramienta, aunque algunos lleguen en fases siguientes: Accesos y roles,
Auditoría, Insumos del presupuesto, Requisiciones, Proveedores, Cotizaciones
y comparativos, Órdenes de compra, Contratos, Documentos (CDE), Recepción en
obra y Panel y trazabilidad. Las acciones: ver, crear, editar,
aprobar/rechazar, aprobar sobre el presupuesto (solo en Requisiciones),
anular, cargar/descargar documentos y administrar (dar accesos; en
Documentos, preparar las carpetas y los tipos de documento). Solo se ofrecen
las combinaciones que tienen sentido: 43 permisos.

| Rol inicial | Para qué |
|---|---|
| Administrador de plataforma | Todo, incluido dar y revocar accesos. Su matriz no se puede cambiar |
| Director | Ve todo y aprueba requisiciones (también sobre el presupuesto), comparativos, órdenes, contratos y recepciones |
| Residente | Pide insumos (requisiciones) y registra lo que llega a la obra |
| Compras | Proveedores, cotizaciones, comparativos y órdenes de compra |
| Presupuesto y costos | Revisa que lo pedido quepa en el presupuesto y aprueba requisiciones |
| Jurídica | Documentación legal de proveedores y contratos |
| Almacén | Recepción en obra: recibido, aceptado, rechazado o devuelto, con su acta |
| Finanzas | Aprueba órdenes y contratos desde lo financiero |
| Auditor | Consulta todo, incluida la auditoría, sin cambiar nada |

Al principio solo el Administrador de plataforma administra accesos. En
**Accesos y roles → Roles y permisos** se ajusta la matriz de cada rol con
casillas (la celda cambiada se ilumina en amarillo hasta guardar) y se crean
roles nuevos. Los roles no se borran: los creados se desactivan (quien lo
tenga deja de entrar) y los iniciales no se desactivan.

### Reglas que nadie se salta

Se revisan en el servidor y otra vez en PostgreSQL (funciones
`compras_guardar_usuario` y `compras_guardar_rol`), con un candado por
proyecto para que dos cambios al mismo tiempo no se crucen:

- **Se niega por defecto**: sin acceso vigente o sin el permiso, la
  respuesta es 403 y el intento queda en la auditoría.
- Nadie cambia su propio acceso ni el rol que tiene asignado.
- Nadie da un rol, edita un rol ni cambia el acceso de otra persona si eso
  supone permisos que no tiene: así nadie se sube de nivel ni baja a quien
  está por encima.
- La matriz del Administrador de plataforma no cambia: siempre tiene todo.
- Siempre queda al menos un Administrador de plataforma vigente y sin fecha
  final.
- Solo se da acceso a personas del equipo del proyecto en Trimble Connect
  (revocar sí funciona con quien ya salió del proyecto).
- Guardar sobre un cambio de otra persona responde 409 `version-conflict` y
  la pantalla vuelve a cargar los accesos.

### Auditoría

Pestaña **Auditoría** (permiso Auditoría: ver). Cada fila dice quién, a
quién, qué, en qué proyecto, cuándo (DD-MM-AAAA y hora de Colombia) y el
resultado (hecho, negado o error), con el detalle: rol y fechas antes →
después, permisos agregados o quitados, o el motivo de la negación. Se
registran todos los cambios y todos los intentos negados, incluido entrar
sin acceso. Es **solo inserción**: un trigger rechaza cualquier cambio,
borrado o vaciado de la tabla, y al rol de servicio se le quitaron esos
permisos. Se filtra por fechas, resultado y módulo, de 200 en 200.

### Insumos del presupuesto

Pestaña **Insumos del presupuesto** (permiso Insumos: ver). Lista los insumos
planificados del proyecto con su código, unidad, tipo, precio, cantidad y
monto planificados, y con un clic las partidas que usan cada uno (ítem,
metrado, si el metrado viene del modelo "3D" y cuánto del insumo pide cada
una). Se filtra por texto, tipo y forma de compra, y dice qué versión del
presupuesto se leyó y quién la guardó.

- Las cantidades son **las mismas de la "Lista de insumos" de Presupuesto**
  (todos los subpresupuestos, entrando en las subpartidas): Compras usa las
  mismas funciones de cálculo (`listaInsumos`, `consumoDeApu`) y una prueba
  compara el resultado. El metrado del modelo cuenta igual que en Presupuesto:
  la suma de los elementos (o cuántos son, si se cuentan), salvo en las
  partidas puestas en "manual".
- Un insumo se identifica por su clave en el presupuesto (el id del insumo
  del catálogo); las requisiciones guardarán además una copia de sus datos.
- Forma de compra: materiales y equipos por **orden de compra**;
  subcontratos y mano de obra por **contrato**. Los insumos en porcentaje
  (herramienta menor, "%MO") no se compran: se listan aparte con su valor.
- Es solo lectura: `lib/compras/presupuestoLectura.ts` solo hace consultas
  GET a `presupuesto_documentos`, `presupuesto_mediciones` y la vista
  `presupuesto_resumen_elementos` (una prueba lo verifica).
- Columnas **Solicitado** (requisiciones enviadas con lo pedido, y aprobadas
  con lo aprobado), **Aprobado**, **Comprometido** (órdenes y contratos
  emitidos) y **Por solicitar** (planificado menos solicitado; en rojo si se
  pasó) y **Recibido** (aceptado en obra, en recepciones aprobadas).

### Requisiciones

Pestaña **Requisiciones** (permiso Requisiciones: ver). Lista con número
(REQ-0001, consecutivo por proyecto), fecha de creación, solicitante, fecha
requerida en obra (en rojo si ya pasó y sigue pendiente), prioridad, estado,
cuántos insumos y el valor estimado a precios del presupuesto. Se filtra por
estado y "solo las mías"; un atajo muestra las que están por aprobar.

**Cómo se usa:** ＋ Nueva requisición → fecha requerida (DD-MM-AAAA),
prioridad (baja, normal, alta, urgente) y para qué se necesita → en
"Agregar un insumo" se escribe el código o la descripción y se elige de la
lista (dice cuánto queda disponible) → cada línea propone lo disponible
como cantidad, se puede asignar a una partida o dejar "Todo el proyecto" →
**Guardar borrador** o **Enviar a aprobación**. Quien aprueba abre la
requisición, ajusta la columna "Aprobar" si aprueba menos, y elige
**Aprobar** (nota opcional), **Devolver** (vuelve a borrador para corregir)
o **Rechazar**; también se puede **Anular**. Devolver, rechazar y anular
piden el motivo, que queda a la vista en la requisición.

Estados: borrador → por aprobar → aprobada o rechazada; devuelta vuelve a
borrador; borrador, por aprobar o aprobada se pueden anular. Nunca se borran.

Reglas (en `lib/compras/requisiciones.ts` con pruebas, y otra vez en
PostgreSQL dentro de una transacción con candado por proyecto):

- Solo insumos que están en el presupuesto vigente (no los de porcentaje), y
  la partida, si se elige, debe usar ese insumo. Código, descripción,
  unidad, tipo y precio se copian del presupuesto en el servidor (no los
  manda el navegador); el mismo insumo y partida no se repite.
- **Límite por insumo para todo el proyecto**: lo ya pedido en otras
  requisiciones enviadas o aprobadas más lo de esta no puede pasar lo
  planificado más la **tolerancia** (0 % de entrada; la cambia quien
  administra accesos, con "Cambiar" junto a la lista, donde también va el
  mínimo de cotizaciones). Para pasarlo hay que
  escribir la **justificación del exceso** en la línea; el mensaje dice
  cuánto se pediría, cuánto ya se pidió y el límite.
- Aprobar por encima del límite requiere el permiso **Aprobar sobre el
  presupuesto** (el Director lo trae en los proyectos que se activen desde
  ahora; en un proyecto ya activado, el administrador lo marca en la matriz).
- **Quien pide no decide** sobre su propia requisición (aprobar, devolver o
  rechazar), aunque tenga el permiso.
- El borrador lo cambia quien lo pidió (si puede crear) o quien puede editar
  requisiciones. Para enviar hace falta al menos un insumo, la justificación
  y una fecha requerida que no haya pasado.
- Se aprueba entre 0 y lo pedido por línea, y al menos una línea; al enviar
  se guarda lo planificado de cada insumo y la versión del presupuesto.
- Dos personas enviando o aprobando a la vez no pasan juntas el límite: la
  base las atiende una por una (prueba incluida).
- Todo queda en la auditoría: crear, editar, enviar, aprobar (con lo
  aprobado), devolver, rechazar y anular (con el motivo), los intentos sin
  permiso y los cambios de tolerancia.

### Proveedores

Pestaña **Proveedores** (permiso Proveedores: ver). Cada proyecto tiene los
suyos: NIT o cédula con su **dígito de verificación** (se calcula con el
método de la DIAN; si se escribe uno equivocado, la pantalla dice cuál es),
persona natural o jurídica, razón social, nombre comercial, contacto,
teléfono, correo, ciudad, dirección, qué suministra (materiales, equipos,
subcontratos, mano de obra), si es responsable de IVA y observaciones. El NIT
no se repite en el proyecto. Al abrir uno se ven sus cotizaciones.

Un proveedor no se borra: con **Inactivar o bloquear** (permiso Proveedores:
anular) pasa a inactivo o bloqueado con el motivo (por ejemplo "RUT
vencido"), y así no recibe cotizaciones nuevas ni puede ser elegido. Se
reactiva igual.

### Cotizaciones y comparativo

Pestaña **Cotizaciones** (permiso Cotizaciones: ver). Lista las requisiciones
aprobadas con cuántas cotizaciones vigentes tienen (en naranja si son menos
del mínimo), el estado de su comparativo y el proveedor elegido.

**Cómo se usa:** abrir la requisición → **＋ Registrar cotización** → elegir
el proveedor (activo y sin cotización en esa requisición), número del
proveedor, fecha, vigencia, plazo de entrega en días, días de pago (0 =
contado), anticipo y condiciones → por cada insumo aprobado: si lo cotiza,
cantidad (hasta lo aprobado), precio unitario sin IVA, descuento e IVA (19 %
de entrada; 0 % si el proveedor no es responsable de IVA). Las cotizaciones
se ven lado a lado: precio unitario neto de cada insumo con su diferencia
contra el precio del presupuesto (verde si es menor, rojo si es mayor),
subtotal, IVA, total, entrega, pago, vigencia, si cubre todo lo aprobado y
el puntaje. Se elige una y **Proponer este proveedor**; otra persona con el
permiso de aprobar la **aprueba** (nota opcional) o la **devuelve** con el
motivo para corregir.

Reglas (`lib/compras/cotizaciones.ts` con pruebas, y en PostgreSQL):

- **Puntaje** con pesos que suman 100 (70 precio, 20 entrega, 10 pago de
  entrada; se cambian en el comparativo): precio = el total más bajo entre
  las que cubren todo ÷ el total de cada una; entrega = (plazo más corto +
  1) ÷ (plazo + 1); pago = (días de crédito + 1) ÷ (los más largos + 1). La
  **mejor** es la de mayor puntaje entre las que cubren todo lo aprobado.
- No se pueden elegir las **vencidas** ni las de proveedores no activos.
- La **justificación** es obligatoria si la elegida no es la mejor, si no
  cubre todo lo aprobado o si hay menos cotizaciones vigentes que el
  **mínimo** (3 de entrada; lo cambia quien administra accesos).
- **Quien propone no aprueba**; el rol Compras propone y el Director
  aprueba (Cotizaciones: aprobar).
- Mientras el comparativo está propuesto o aprobado, sus cotizaciones no se
  corrigen ni se anulan; si lo devuelven, sí. Anular una cotización pide
  motivo y no la borra.
- Una cotización por proveedor y requisición, solo sobre requisiciones
  aprobadas y sus líneas aprobadas, sin pasar la cantidad aprobada.
- Todo queda en la auditoría: proveedores creados, corregidos, bloqueados;
  cotizaciones registradas, corregidas y anuladas; comparativos guardados,
  propuestos (con la elegida y la justificación), aprobados y devueltos.

### Órdenes de compra y contratos

Pestaña **Órdenes y contratos** (permiso Órdenes: ver o Contratos: ver; cada
quien ve los tipos que su rol le deja). Arriba, **Por ordenar**: las
requisiciones con proveedor elegido y aprobado que aún tienen cantidades
pendientes, con su valor; desde ahí **Crear orden de compra** (permiso
Órdenes: crear, rol Compras) o **Crear contrato** (Contratos: crear, rol
Jurídica). Abajo, la lista con número (OC-0001 y CT-0001, cada tipo con su
consecutivo), proveedor, requisición, fecha de entrega o terminación, estado
(con "rev. N" si se modificó), total y quién la elaboró.

**Cómo se usa:** fecha de entrega (o de terminación del contrato), lugar,
forma de pago, días de pago y anticipo (vienen de la cotización); en
contratos además objeto, pólizas exigidas y retención de garantía (5 % de
entrada). Cada insumo de la cotización elegida se incluye o no, con la
cantidad que se ordena (propone lo pendiente). Los precios, descuentos e IVA
son los de la cotización. **Guardar borrador** o **Enviar a aprobación**;
otra persona con el permiso de aprobar (Director o Finanzas) la **aprueba y
emite** o la **devuelve**. Una emitida se puede **Modificar** (en contratos,
otrosí) con el motivo: la versión vigente queda guardada sin cambios
posibles, la orden vuelve a borrador como revisión siguiente, ahí sí se
pueden ajustar precios y cantidades, y vuelve a aprobación. **Anular** pide
motivo, no borra y libera lo comprometido.

Reglas (`lib/compras/ordenes.ts` con pruebas, y en PostgreSQL):

- **No se compromete dos veces la misma cantidad**: lo ordenado de cada
  línea de la requisición, sumando todas las órdenes y contratos no anulados
  (también los borradores), no pasa lo aprobado ni lo cotizado por el
  proveedor elegido. La función que guarda lo revisa con candado por
  proyecto, y un trigger diferido lo vuelve a revisar al cerrar cada
  transacción aunque alguien escriba directo en la tabla (probado).
- Solo desde requisiciones aprobadas con comparativo aprobado, y solo con
  los insumos que cotizó el proveedor elegido.
- En la revisión 0 los precios deben ser los de la cotización (la base lo
  exige); solo una modificación los cambia.
- Quien elabora (o modifica) no aprueba; devolver, anular y modificar piden
  motivo; el contrato no se envía sin objeto; la fecha no puede haber pasado.
- Una requisición con órdenes o contratos vigentes no se anula (primero se
  anulan ellos).
- Todo queda en la auditoría: crear, editar, enviar, aprobar, devolver,
  anular y modificar, con la revisión y el motivo.

### Recepción en obra

Pestaña **Recepción en obra** (permiso Recepción en obra: ver). Arriba están
las órdenes y contratos emitidos con su avance de recibo (**Sin recibir**,
**Parcial** con su porcentaje o **Completa**) y, con **Ordenado vs.
recibido**, la tabla de diferencias por insumo: ordenado, aceptado (en
recepciones aprobadas), en trámite (en borrador o por aprobar), rechazado,
devuelto y pendiente. Quien la ve no ve precios: solo cantidades.

**Registrar recepción** (Recepción en obra: crear; por ejemplo el
residente) abre la recepción REC-0001 de esa orden: fecha de recibo (no
posterior a hoy), remisión del proveedor, observaciones y, por insumo, lo
**recibido**, lo **rechazado** con su motivo y lo **devuelto** al
proveedor. Lo **aceptado** es recibido menos rechazado. Se admiten entregas
parciales: cada entrega es una recepción.

Reglas (en el servicio y otra vez en PostgreSQL, bajo el mismo bloqueo que
las órdenes):

- Aceptado + rechazado = recibido; lo devuelto no pasa lo rechazado; un
  rechazo necesita su motivo.
- Lo aceptado de una línea, sumando todas las recepciones no anuladas
  (borradores incluidos), no pasa lo ordenado. Si llegó de más, el
  excedente se rechaza. Un trigger diferido lo vuelve a revisar aunque
  alguien escriba directo en la tabla.
- Solo se recibe contra órdenes y contratos **emitidos** (no en borrador,
  por aprobar, en modificación ni anulados).
- Borrador → **Enviar a aprobación** → **Aprobar** (Recepción en obra:
  aprobar; por ejemplo almacén o el director). Quien la registró no la
  aprueba ni la devuelve. Devolver y anular piden motivo. Una recepción
  aprobada se puede anular (Recepción en obra: anular) y deja de contar.
- Al aprobarse, lo aceptado aparece como **Recibido** en Insumos del
  presupuesto y en el avance de la orden.

**La orden respeta lo recibido:** una orden o contrato con recepciones
vigentes no se anula (`con-recepciones`), y una modificación no puede dejar
una línea, ni quitarla, por debajo de lo ya aceptado (`bajo-lo-recibido`).
Ambas cosas las revisan también triggers en la base.

**Acta y soportes:** cada recepción tiene su sección de documentos (en
"Actas y recepciones" del CDE): la remisión del proveedor, fotos o soportes
y, cuando está aprobada, **Guardar el acta en el CDE**, que genera el acta
en PDF (orden, proveedor, fecha, remisión, ordenado, recibido, aceptado,
rechazado, devuelto, motivos del rechazo y firmas de quien recibió y quien
aprobó). El acta es reproducible, como el PDF de la orden.

### Documentos en el CDE

Los archivos de Compras viven en las carpetas del proyecto en Trimble
Connect, nunca en la base de datos ni en Supabase Storage. Compras guarda
solo la referencia: id del archivo y de su versión en Trimble, carpeta,
nombre, tamaño, huella SHA-256, quién lo cargó y el estado de sincronización.

**Carpetas.** En la pestaña **Documentos (CDE)**, quien tiene Documentos:
administrar pulsa **Revisar en Trimble** (no crea nada: muestra qué existe)
y luego **Preparar carpetas**, que pide confirmación con la lista exacta de lo
que va a crear. En la raíz del proyecto queda:

```
Compras y Contrataciones/
  Requisiciones/
  Cotizaciones/
  Órdenes de compra/
  Contratos/
  Documentación legal de proveedores/
    890.903.938-8 Ferretería A/   (una por proveedor, al cargar su primer documento)
  Actas y recepciones/
```

Si ya hay carpetas con esos nombres, se usan (no se duplican); si alguien
movió o borró una, se vuelve a buscar o crear. Repetirlo no cambia nada.
Queda en la auditoría.

**Cargar.** Cada requisición, cotización, orden, contrato y proveedor tiene
su sección **Documentos** (permiso "Documentos" del módulo: por ejemplo,
Requisiciones: documentos). Se elige el tipo, el archivo (hasta 100 MB) y,
para los legales del proveedor, el vencimiento (sugerido según el tipo).
Antes de cargar dice en qué carpeta quedará. El archivo toma un nombre fijo:
`REQ-0001 - Soporte - cotización ferretería [d0000000].pdf` (registro, tipo,
nombre original y el inicio de su id), así un reintento nunca crea otro.

Cómo viaja: el servidor registra el documento como **Pendiente de respaldo**
y abre la subida en Trimble; el **navegador** envía el archivo directo a la
URL firmada de Trimble (no pasa por Vercel). Si el navegador no puede
(CORS), lo envía el servidor, solo hasta 4 MB (el límite de Vercel), y
comprueba que su huella es la registrada. Luego se pregunta a Trimble hasta
que confirma la carga: solo entonces queda **Respaldado en el CDE**, con su
revisión. Una restricción de la base lo garantiza: un documento no puede
quedar respaldado sin el id y la versión que dio Trimble, ni volver atrás.

**Si algo falla** (se cerró la página, se cayó la red, la subida venció):
queda Pendiente o Error, en la sección del registro y en la cola
**Pendientes de respaldo** de la pestaña Documentos (CDE). **Reintentar**
primero pregunta a Trimble: si el archivo ya llegó, solo se confirma; si la
subida sigue abierta, se reenvía; si venció, se abre otra con el mismo nombre
y con `If-None-Match`, así no hay duplicados. El navegador guarda una copia
local (IndexedDB) hasta la confirmación; si no la tiene, pide el archivo y
revisa que sea el mismo (huella). Cada paso queda en el historial del
documento (**Historial**).

**Abrir** pide a Trimble un enlace de descarga de corta duración con los
permisos del usuario; no hay enlaces públicos. **Anular** pide motivo y deja
el archivo en Trimble (no se borra nada); el nombre queda libre.

**PDF de la orden.** En una orden o contrato emitido, **Guardar el PDF en
el CDE** genera el PDF en el navegador (encabezado, proveedor con NIT,
condiciones, objeto y pólizas del contrato, líneas, IVA y total, quién
elaboró y aprobó) y lo carga en "Órdenes de compra" o "Contratos". El PDF es
reproducible (misma orden, mismo archivo), así un reintento lleva la misma
huella. Una modificación emitida (revisión 1, 2...) se guarda como otro PDF.

**Expediente legal del proveedor.** En la ficha de cada proveedor,
**Expediente legal** muestra cada tipo de documento (RUT, Cámara de
Comercio, cédula del representante, certificación bancaria, seguridad
social, pólizas, otro) con su estado: Falta, Cargado sin confirmar, Vigente,
Por vencer (15 días) o Vencido. Solo cuenta lo que Trimble confirmó. El
expediente queda **Completo**, **Por vencer**, **Vencido** o **Incompleto**;
sale en la lista de proveedores y en la pestaña Documentos (CDE) con lo que
falta. Quien tiene Documentos: administrar ajusta los tipos (nombre,
obligatorio, días de vigencia, activo) o agrega otros; no se quitan, se
desactivan.

La pestaña Documentos (CDE) tiene además **Todos los documentos** (con
búsqueda) y, para administradores, la prueba de escritura.

### Prueba de escritura en el CDE

Al final de la pestaña **Documentos (CDE)** (solo quien tiene Documentos:
administrar). Antes de guardar los documentos de
Compras en las carpetas del proyecto, **Hacer la prueba** confirma que la
extensión puede escribir en Trimble Connect con la sesión del usuario (su
token; no hay cuenta técnica):

1. Lee la carpeta raíz del proyecto (`GET /projects/{id}` → `rootId`,
   `GET /folders/{id}`) y busca la carpeta "Compras - prueba de conexión (se
   puede borrar)" (`GET /folders/{id}/item?name=&type=FOLDER`).
2. Si no existe, la crea (`POST /folders` con el id de versión de la raíz
   como `parentId`, como dice la API; si no lo acepta, con el id).
3. Sube `prueba-compras.txt`: el servidor abre la subida
   (`POST /files/fs/upload` con `If-None-Match: *`) y el **navegador** envía
   el contenido directo a la URL firmada de Trimble (sin pasar por Vercel,
   que limita los envíos a 4.5 MB). Si el navegador no puede (por ejemplo, por
   CORS), lo envía el servidor.
4. Espera a que Trimble confirme la carga (`GET /files/fs/upload`, estado
   DONE con su revisión).
5. Lo sube otra vez con el mismo nombre (con `If-Match` de la versión
   vigente) y comprueba que sale la revisión siguiente.
6. Pide un duplicado con `If-None-Match: *` y comprueba que Trimble lo
   rechaza (así los reintentos no duplicarán archivos).

No borra nada. Muestra cada paso con ✔ o ✖ y en palabras ("Trimble negó el
permiso", "CORS"...), un resumen para copiar y cada paso queda en la
auditoría (acción "Prueba de escritura en el CDE"). El código está en
`lib/compras/cde.ts` (con un Trimble falso en las pruebas que se comporta
como la API documentada) y `components/compras/PruebaCde.tsx`.

### Panel y trazabilidad

Pestaña **Panel** (permiso Panel: ver), la segunda después de Inicio.

**Indicadores** (cada tarjeta dice cómo se calcula; si no hay con qué
calcularlo dice **Sin datos suficientes**, nunca un cero inventado; las que
piden atención se marcan en amarillo):

- Presupuesto de compras comprometido: valor de las órdenes y contratos
  emitidos (sin IVA) sobre el valor planificado de los insumos que se compran.
- Valor comprometido (sin IVA).
- Precio comprado frente al presupuesto: lo comprometido frente a las mismas
  cantidades al precio del presupuesto (positivo: se compró más caro).
- Comprometido ya recibido: lo aceptado en recepciones aprobadas, al precio
  de su orden, sobre el valor comprometido.
- Rechazado en obra: rechazado sobre recibido (alerta por encima de 5 %).
- Tiempo para aprobar una requisición: promedio en días entre envío y
  aprobación.
- Esperando aprobación: requisiciones, órdenes o contratos y recepciones
  enviadas.
- Entregas vencidas: órdenes emitidas con la fecha de entrega pasada sin
  recibir todo.
- Documentos sin respaldo en el CDE y proveedores con expediente por
  completar.

**Insumos: de lo planificado a lo recibido.** Cada insumo con planificado,
solicitado, aprobado, comprometido, recibido, por solicitar, por recibir y
el precio comprado frente al presupuesto, con una barra de avance (recibido
en verde, comprometido por recibir en azul, aprobado sin ordenar en
amarillo). Se puede buscar y dejar solo los que tienen movimiento.

**Ruta del insumo.** Al pulsar un insumo se abre su recorrido:
presupuesto → requisición → cotizaciones (la elegida marcada) → orden o
contrato → recepciones, cada etapa con su estado, cantidades, precios sin
IVA y sus documentos del CDE (con **Abrir** si el rol tiene el permiso de
documentos de ese módulo). La ruta muestra solo lo que el rol puede ver: si
no ve cotizaciones, órdenes o recepciones, esa etapa dice que está oculta;
si no ve requisiciones, la ruta no se muestra.

**Exportar a Excel** descarga un libro con tres hojas: Indicadores, Insumos
y Trazabilidad (una fila por etapa de cada insumo, con sus documentos).
Fechas como fechas (DD-MM-AAAA) y cantidades con 4 decimales.

El plan proponía una vista SQL (`compras_insumo_estado`); el panel se
calcula en el servidor con las mismas funciones que ya usan las demás
pestañas (y sus pruebas), porque lo planificado sale del cálculo del
presupuesto, que vive en el código y no en la base. Por eso esta fase no
cambia `supabase/compras.sql`.

### Esquema de la base de datos

[`supabase/compras.sql`](supabase/compras.sql) (se puede volver a ejecutar
sin perder datos). RLS activado sin políticas en todas las tablas: solo el
servidor (clave de servicio) lee y escribe, y las funciones no las puede
ejecutar nadie más (`revoke` a `public`, `anon` y `authenticated`).

| Tabla / función | Contenido |
|---|---|
| `compras_roles` | Roles de cada proyecto con sus permisos (`text[]`, solo los válidos) y versión |
| `compras_usuarios` | Un acceso por persona y proyecto: rol, desde, hasta, activo, quién lo dio, versión |
| `compras_auditoria` | El registro de solo inserción |
| `compras_permisos_validos()` | La lista de los 43 permisos (la misma de `lib/compras/types.ts`; una prueba lo verifica) |
| `compras_permisos_de(proyecto, persona)` | Los permisos vigentes hoy de una persona |
| `compras_activar(...)` | Activa Compras si el proyecto no tiene administrador vigente |
| `compras_guardar_usuario(...)` / `compras_guardar_rol(...)` | Dan, cambian o revocan con todas las reglas de arriba y su fila de auditoría |
| `compras_config` | Por proyecto: tolerancia sobre lo planificado (%) y mínimo de cotizaciones |
| `compras_consecutivos` | Último número por proyecto y tipo de documento (REQ...) |
| `compras_requisiciones` | Requisiciones: número, estado, solicitante, fecha requerida, prioridad, justificación, motivo, versión del presupuesto, quién envió y decidió |
| `compras_requisicion_lineas` | Líneas: insumo (clave en el presupuesto), partida opcional, copia del insumo, cantidad, cantidad aprobada, planificado al enviar, justificación del exceso. Única por requisición, insumo y partida |
| `compras_solicitado(proyecto, insumo, excluir)` | Lo pedido de un insumo en el proyecto |
| `compras_guardar_requisicion(...)` / `compras_cambiar_estado_requisicion(...)` / `compras_guardar_config(...)` | Guardan con permisos, estados, límites y su fila de auditoría |
| `compras_proveedores` | Proveedores: NIT, dígito de verificación (revisado con `compras_dv`), datos, categorías, IVA, estado y motivo. NIT único por proyecto |
| `compras_cotizaciones` / `compras_cotizacion_lineas` | Cotizaciones (COT-0001) por requisición y proveedor (una registrada por pareja), con fecha, vigencia, entrega, pago, anticipo; líneas con cantidad, precio, descuento e IVA sobre las líneas aprobadas |
| `compras_comparativos` | Por requisición: pesos, cotización elegida, justificación, estado (borrador, propuesto, aprobado), quién propuso y aprobó |
| `compras_guardar_proveedor` / `compras_estado_proveedor` / `compras_guardar_cotizacion` / `compras_anular_cotizacion` / `compras_accion_comparativo` | Guardan con permisos, estados y su fila de auditoría |
| `compras_ordenes` / `compras_orden_lineas` | Órdenes (OC) y contratos (CT): requisición, cotización, proveedor, estado, revisión, quién la elaboró y aprobó, entrega, pago, anticipo, retención, objeto, pólizas; líneas con la cantidad y el precio por línea de requisición |
| `compras_orden_revisiones` | Cómo era cada orden emitida antes de cada modificación (solo inserción) |
| `compras_comprometido(línea, excluir)` + trigger `compras_orden_lineas_sin_doble` | Lo ordenado de una línea; el trigger diferido impide pasar lo aprobado |
| `compras_guardar_orden` / `compras_accion_orden` | Guardan y cambian de estado con permisos, compromiso, precios de la cotización y auditoría |
| `compras_cde_carpetas` | Las carpetas de Compras en Trimble de cada proyecto: clave, nombre, id de la carpeta, ruta, quién y cuándo |
| `compras_documentos` | Referencias a los archivos del CDE: registro al que pertenece, tipo, título, nombre original y en Trimble, carpeta, tamaño, huella, vencimiento, estado (pendiente, respaldado, error, anulado), id de subida, de archivo y de versión, revisión, intentos, último error, motivo de anulación, versión. Nombre único por carpeta; restricciones: respaldado exige archivo, versión y confirmación; anulado exige motivo |
| trigger `compras_documentos_sin_retroceso` | Un documento respaldado no vuelve a pendiente ni cambia de archivo; uno anulado no cambia |
| `compras_sync_historial` | Cada paso de cada carga con Trimble (solo inserción) |
| `compras_recepciones` / `compras_recepcion_lineas` | Recepciones (REC) contra una orden o contrato: estado, fecha, remisión, quién registró y aprobó; líneas por línea de la orden con recibido, aceptado, rechazado, devuelto y motivo (restricciones: aceptado + rechazado = recibido, devuelto ≤ rechazado, rechazo con motivo) |
| `compras_recibido(orden, línea, excluir)` + triggers `compras_recepcion_lineas_sin_exceso` y `compras_recepciones_sin_exceso` | Lo aceptado de una línea de la orden; los triggers diferidos impiden pasar lo ordenado |
| triggers `compras_orden_lineas_sobre_lo_recibido` y `compras_ordenes_con_recepciones` | Una orden no baja de lo aceptado ni se anula con recepciones vigentes |
| `compras_guardar_recepcion` / `compras_accion_recepcion` | Guardan y cambian de estado con permisos, cantidades y auditoría |

### API

Todas bajo `/api/compras`, con `?projectId=` y el token de Trimble
(`Authorization: Bearer`). Cada una revisa el permiso en cada llamada.

| Ruta | Qué hace | Permiso |
|---|---|---|
| `GET estado` | Quién eres, tu acceso y permisos, si se puede activar y a quién pedir acceso | Ninguno (sin acceso deja registro) |
| `POST activar` | Activa Compras en el proyecto | Administrador del proyecto en Trimble, sin administrador de Compras |
| `GET accesos` | Roles y personas | Accesos y roles: ver |
| `PUT accesos/usuarios` | Da, cambia o revoca un acceso | Accesos y roles: administrar |
| `PUT accesos/roles` | Crea o cambia un rol | Accesos y roles: administrar |
| `GET contactos` | Equipo del proyecto en Trimble (solo personas) | Accesos y roles: administrar |
| `GET insumos` | Insumos planificados del presupuesto, con las partidas que los usan y lo solicitado | Insumos: ver |
| `GET requisiciones` | Requisiciones con sus líneas y la tolerancia | Requisiciones: ver |
| `PUT requisiciones` | Crea o cambia un borrador | Requisiciones: crear (o editar) |
| `POST requisiciones/{id}/estado` | Enviar, aprobar, rechazar, devolver o anular | Según la acción |
| `PUT config` | Tolerancia y mínimo de cotizaciones | Accesos y roles: administrar |
| `GET proveedores` / `PUT proveedores` | Proveedores (y sus cotizaciones) / crear o corregir | Proveedores: ver / crear o editar |
| `POST proveedores/{id}/estado` | Activar, inactivar o bloquear | Proveedores: anular |
| `GET cotizaciones` / `PUT cotizaciones` | Requisiciones aprobadas con cotizaciones y comparativos / registrar o corregir | Cotizaciones: ver / crear o editar |
| `POST cotizaciones/{id}/anular` | Anular con motivo | Cotizaciones: anular |
| `POST comparativos/{requisición}` | Guardar, proponer, aprobar o devolver | Cotizaciones: crear o editar / aprobar |
| `GET ordenes` / `PUT ordenes` | Órdenes y contratos visibles, sus revisiones y lo pendiente por ordenar / crear o editar un borrador | Órdenes o Contratos: ver / crear o editar |
| `POST ordenes/{id}/estado` | Enviar, aprobar, devolver, anular o modificar | Según la acción y el tipo |
| `GET cde/carpetas` / `POST cde/carpetas` | Revisar / preparar las carpetas de Compras en el CDE | Documentos: administrar |
| `GET documentos` | Documentos (de un registro con `entidadTipo` y `entidadId`, o todos los visibles), carpetas y tipos legales | Ver del módulo del registro (o Documentos: ver) |
| `POST documentos` | Registrar un documento y abrir su subida en Trimble | Documentos del módulo del registro |
| `POST documentos/{id}/contenido` | El servidor envía el archivo a Trimble (hasta 4 MB, misma huella) | Documentos del módulo |
| `POST documentos/{id}/confirmar` / `reintentar` | Preguntar a Trimble si ya está / reintentar sin duplicar | Documentos del módulo |
| `POST documentos/{id}/abrir` | Enlace de descarga de corta duración de Trimble | Documentos del módulo |
| `POST documentos/{id}/anular` | Anular con motivo (el archivo sigue en Trimble) | Documentos del módulo |
| `GET documentos/{id}/historial` | Los pasos de la carga con Trimble | Ver del módulo |
| `PUT documentos/tipos` | Tipos de documentos legales de proveedores | Documentos: administrar |
| `POST cde/prueba` | Un paso de la prueba de escritura en el CDE | Documentos: administrar |
| `GET recepciones` / `PUT recepciones` | Recepciones y órdenes emitidas con lo pendiente (sin precios) / registrar o editar un borrador | Recepción en obra: ver / crear o editar |
| `POST recepciones/{id}/estado` | Enviar, aprobar, devolver o anular | Según la acción |
| `GET panel` | Indicadores, estado de cada insumo y su ruta (solo con los módulos que el rol ve) | Panel: ver |
| `GET auditoria` | La auditoría con filtros | Auditoría: ver |

Errores (`code`): `sin-acceso`, `sin-permiso`, `propio`, `escalamiento`,
`rol-protegido`, `no-admin-trimble`, `no-miembro` (403/400); `ultimo-admin`,
`ya-activo`, `nombre-repetido`, `version-conflict` (409); `datos`,
`rol-no-valido` (400); `trimble-session` (401: recargar Trimble Connect).
Requisiciones: `auto-aprobacion`, `exceso-sin-permiso` (403);
`cantidad-excedida`, `estado-no-valido`, `linea-duplicada` (409);
`insumo-no-valido`, `cantidad-no-valida`, `motivo-requerido`,
`justificacion-requerida`, `sin-lineas`, `fecha-pasada` (400); `no-existe` (404).
Proveedores y cotizaciones: `nit-repetido`, `proveedor-no-activo`,
`cotizacion-duplicada`, `cotizacion-no-elegible`, `comparativo-cerrado`,
`requisicion-no-aprobada` (409). Órdenes: `doble-compromiso`,
`sin-proveedor-elegido`, `con-ordenes` (409); `objeto-requerido` (400).
Documentos: `carpetas-sin-preparar`, `documento-duplicado` (409);
`archivo-grande`, `archivo-distinto` (400). Recepciones: `orden-no-emitida`,
`recepcion-excedida`, `con-recepciones`, `bajo-lo-recibido` (409);
`rechazo-no-valido`, `fecha-futura` (400).

El código está en `lib/compras/` (`types`, `roles`, `accesos` con las
reglas puras, `validate`, `store` con Supabase o memoria, `service`,
`routes`, `client`, `formato`, `planificado`, `presupuestoLectura`,
`requisiciones`, `proveedores`, `cotizaciones`, `ordenes`, `cde` (la API de
Trimble), `documentos` (carpetas, nombres, expediente), `subida` (el lado del
navegador), `pdfOrden`, `recepciones`, `pdfRecepcion`, `panel` y `excelPanel`, con sus pruebas; `pruebas/trimbleFalso` es un
Trimble Connect falso que se comporta como su API) y `components/compras/`.

### Lo que sigue

Las ocho fases del plan están hechas. Falta probar de punta a punta dentro
de Trimble Connect real: la prueba de escritura en el CDE (pestaña
Documentos (CDE)) y el recorrido completo con personas de distintos roles.

---

## Control de Obra (proyecto)

Control de cantidades, costos, avance físico y calidad de la obra, ligado a
los elementos de los modelos 3D por IFCGUID + modelo + versión, con
empresas, licencias, roles y permisos, estructura de obra y bitácora de
auditoría. Es un producto **comercial y multiempresa**: cada empresa cliente
tiene su licencia y registra sus proyectos de Trimble Connect. Aparece en el
menú lateral del proyecto (`/control-obra`, `manifest-control-obra.json`) y
como panel del visor 3D (`/control-obra/visor`, `manifest-control-obra-visor.json`)
para medir desde el modelo.

La base se construyó según el diagnóstico y el diseño aprobados
([`docs/control-obra/diagnostico.md`](docs/control-obra/diagnostico.md) y
[`docs/control-obra/diseno.md`](docs/control-obra/diseno.md)): empresas,
licencias, personas, roles, accesos, estructura de obra y bitácora. Desde el
21-10-2026 el resto sigue el **plan de actas**
([`docs/control-obra/plan-actas.md`](docs/control-obra/plan-actas.md)), que
reemplazó las fases 4 a 8 del diseño: 1) flujos de aprobación y roles
(**hecha**), 2) ubicaciones y mediciones (**hecha**), 3) calidad, 4) actas al cliente y a
subcontratistas, 5) enlace con Presupuesto, 6) almacén, 7) costo real,
8) panel y estados en el visor.

Presupuesto y Compras son la fuente oficial del presupuesto, los precios y
los contratos: Control de Obra solo los lee y nunca escribe en
`presupuesto_*` ni `compras_*`. Con la fase 5, Presupuesto leerá las
mediciones de las actas aprobadas como fuente de su avance.

### Quién hace qué

Tres niveles de administración, separados de los permisos de obra:

- **Administrador técnico del producto**: los IDs de usuario de Trimble
  Connect que estén en la variable `CONTROL_OBRA_ADMINS` de Vercel (nunca un
  botón). Ve la pestaña **Empresas y licencias**: crea empresas (con NIT y
  dígito de verificación), registra los eventos de su licencia y nombra o
  quita a sus administradores por su correo de Trimble Connect. No entra a
  los datos de obra de las empresas. Para saber tu ID, abre Control de Obra
  en un proyecto donde no tengas acceso: la pantalla lo muestra con un botón
  "Copiar".
- **Administrador de la empresa**: registra proyectos, da accesos en ellos,
  configura los roles de la empresa, desactiva personas y configura la
  estructura de obra (la plantilla de la empresa y la de cada proyecto). La
  primera vez que abre Control de Obra queda ligado a su usuario por el
  correo con que lo nombraron (el correo lo da Trimble Connect con su sesión).
- **Administrador del proyecto**: da accesos y configura la estructura y la
  configuración de su proyecto. No nombra otros administradores ni cambia a
  otro administrador de proyecto.

Administrar **no da permisos de obra**: para reportar, verificar o aprobar
hace falta un rol en el proyecto, y **nadie se lo da a sí mismo**. Por eso el
administrador de la empresa nombra a un administrador de proyecto, y este le
da su rol operativo a él.

### Licencias

Cada cambio de la licencia es un **evento nuevo** del historial (activación,
renovación, cambio de plan o límites, suspensión, reactivación); nada se
sobrescribe ni se borra, y la vigente es la última. Lleva plan, desde,
hasta (último día con acceso; vacía = sin vencimiento), proyectos y personas
activas permitidos, módulos contratados y soporte. Suspender y reactivar
piden motivo.

- Estados: activa, por vencer (15 días antes), vencida, suspendida, empieza
  más adelante, sin licencia, empresa desactivada. **Solo activa, por vencer
  y sin vencimiento dejan trabajar**: en los demás nadie de la empresa entra,
  tampoco sus administradores; los datos se conservan.
- Los módulos se venden por grupos (estructura y modelos 3D; mediciones,
  actas y avance físico; costos; almacén y consumo de materiales; calidad;
  documentos; reportes); panel, bitácora y accesos vienen siempre. El grupo
  de almacén se agregó con el plan de actas: una licencia registrada antes no
  lo incluye hasta que el administrador técnico registre un evento "Cambio de
  plan o límites" con él. Un permiso de un módulo no contratado no sirve aunque el
  rol lo tenga, y la API responde `modulo-no-contratado`.
- Un proyecto activo pertenece a **una sola empresa**. Registrar un proyecto
  ocupa un cupo; retirarlo (con motivo) lo libera y conserva sus datos.
  Cada persona activa de la empresa ocupa un cupo de personas; desactivarla
  lo libera.

### Roles y matriz de permisos

Un permiso es un módulo con una acción (ver, crear o reportar, editar,
verificar, aprobar o aceptar, anular o revocar, adjuntar documentos,
exportar, configurar): 95 permisos, ya con los módulos de las fases
siguientes para dejar los roles listos (con el plan de actas llegaron Actas
al cliente, Actas de subcontratistas y Almacén, y Cantidades pasó a llamarse
Mediciones de obra). Cada empresa nace con nueve roles iniciales (los cinco
del documento y cuatro más); su matriz se puede cambiar, se pueden crear
otros, y se desactivan, no se borran.

| Rol inicial | Para qué |
|---|---|
| Director de proyecto | Consulta indicadores y aprueba según sus atribuciones |
| Residente de obra | Reporta cantidades, avance y observaciones (no verifica lo suyo) |
| Profesional de costos | Costos autorizados y cortes de avance |
| Inspector de calidad | Inspecciones, ensayos, no conformidades; verifica cantidades |
| Auditor | Consulta todo, incluida la bitácora |
| Responsable técnico de calidad | Aprueba criterios de aceptación y ensayos; cierra no conformidades |
| Laboratorio | Muestras y resultados de ensayos |
| Interventoría | Interventoría o cliente: consulta y aprueba en su paso las actas al cliente y el cierre de no conformidades; no ve subcontratos, costos ni almacén |
| Almacenista | Elabora los vales de salida y consulta existencias y consumos (no aprueba sus vales) |

Las empresas creadas antes del plan de actas reciben Interventoría y
Almacenista al volver a ejecutar el SQL (queda en la bitácora como
"Actualización de Control de Obra"). A sus otros roles **no se les cambia
nada solo**: en **Administración → Roles y permisos**, un rol inicial al que
le faltan los permisos de los módulos nuevos muestra un aviso con la lista y
el botón **Marcarlos**; quedan solo si el administrador de la empresa guarda.

### Reglas que nadie se salta

Se revisan en el servidor y otra vez en PostgreSQL, con un candado por
empresa:

- **Se niega por defecto**: sin empresa con licencia vigente, sin rol
  vigente o sin el permiso, la respuesta es 403 y el intento queda en la
  bitácora. Los permisos y la licencia se leen en **cada solicitud**, sin
  caché: revocar, desactivar a la persona o suspender la licencia corta el
  acceso en la siguiente acción.
- Nadie cambia su propio acceso, ni el rol que tiene asignado, ni su
  licencia; nadie nombra un administrador de su nivel o superior.
- **La empresa la deduce el servidor** del proyecto: el navegador nunca la
  envía, así no hay forma de pedir datos de otra empresa.
- Todas las tablas llevan `empresa_id` y `project_id` con **claves foráneas
  compuestas**: la base de datos impide ligar un acceso, un rol o un valor de
  la estructura a otra empresa u otro proyecto, aunque el servidor se
  equivocara. Una prueba revisa que cada consulta del servidor lleve los dos
  filtros.
- El servidor **solo puede leer** las tablas (y agregar filas a la
  bitácora): todo cambio pasa por funciones de la base de datos que revisan
  las reglas (`security definer`), así ni con la clave del servidor se escribe
  saltándose las reglas.
- Guardar sobre un cambio de otra persona responde 409 `version-conflict`.

### Flujos de aprobación

Pestaña **Flujos de aprobación** (la configuran los administradores de la
empresa o del proyecto; la consultan quienes tienen Accesos: ver). Por cada
tipo de documento (actas al cliente, actas de subcontratistas, inspecciones
de calidad, cierre de no conformidades y vales de salida, los de los módulos
que tenga la licencia) se definen de 2 a 6 pasos, cada uno con su nombre
("Elabora", "Preaprueba", "Aprueba") y el rol que lo atiende. Ejemplo
sugerido para las actas al cliente: Residente de obra (elabora) → Director
de proyecto (preaprueba) → Interventoría (aprueba).

- **Configurar** propone el flujo sugerido (sale de los roles iniciales); se
  cambia el nombre o el rol de cada paso, se ordenan, se agregan o se
  quitan. Muestra quiénes tienen hoy cada rol y avisa si un paso quedaría sin
  nadie que lo atienda.
- Cada rol necesita el permiso del módulo: el del primer paso, crear
  (editar, en el cierre de no conformidades); los demás, aprobar. Si no lo
  tiene, la pantalla lo dice y no deja guardar ("el rol Residente de obra no
  tiene permiso de crear en actas al cliente").
- Reglas al recorrer un flujo (en el servidor y en PostgreSQL): el primer
  paso elabora y envía; los siguientes aprueban, el último en firme;
  **devolver exige motivo y regresa al paso anterior**, no al principio (al
  paso 0 el documento queda devuelto a quien lo elabora); **quien elabora no
  aprueba lo suyo y una persona firma un solo paso del mismo documento**;
  un documento enviado guarda la copia del flujo con que salió, así cambiar
  el flujo no altera lo que ya está en trámite. Cada envío, aprobación,
  devolución o anulación queda en un historial que no se puede cambiar
  (`obra_aprobaciones`) y en la bitácora.
- Sin flujo configurado, ese tipo de documento no se puede enviar a
  aprobación. Los documentos llegan en las fases siguientes (inspecciones y
  cierre de no conformidades en la 3, actas en la 4, vales en la 6).

### Mediciones de obra

Lo ejecutado se mide por partida del presupuesto, con su ubicación y quién lo
hizo. Pestaña **Mediciones de obra** (permiso Mediciones de obra: ver) y panel
**Control de Obra** del visor 3D.

- **Desde el modelo** (panel del visor): se busca la partida, se seleccionan
  los elementos y la tabla muestra lo que da cada uno según Presupuesto (la
  misma regla de metrado: la cantidad que tiene el elemento en esa partida),
  cuánto lleva medido y el % que se mide ahora (por defecto lo que le falta;
  "Mismo % para todos" lo aplica a la vez). Solo se miden elementos
  **asociados a esa partida en Presupuesto**; los demás se avisan ("asócialos
  allí o mídelos a mano"), y los que ya están al 100 % se dejan fuera.
- **A mano** (botón **＋ Medición a mano**): para lo que no está modelado, con
  memoria de cantidades: cada línea es veces × largo × ancho × alto, sin
  contar las dimensiones vacías (solo veces = un conteo; veces negativo
  descuenta un vano).
- **Ubicación obligatoria**: un valor de cada nivel de la estructura de obra
  (Torre 1 · Piso 2). Un piso solo se puede elegir dentro de su torre. En
  Proyecto y estructura de obra se marcan los niveles que toda medición debe
  indicar. Desde el modelo, la ubicación se sugiere con la memoria de
  cantidades de Presupuesto (la columna con la misma propiedad del modelo o el
  mismo nombre que el nivel); si los elementos están en ubicaciones distintas
  se avisa: una medición tiene una sola ubicación.
- **Quién la ejecutó**: un contrato aprobado en Compras que tenga un insumo de
  subcontrato o mano de obra del APU de la partida (también dentro de
  subpartidas, y no destinado a otra partida), o **obra propia**. Una partida
  puede tener varios subcontratistas (por pisos, por ejemplo): cada medición
  dice el suyo.
- **Regla del 100 %**: un elemento se puede medir por partes (50 % y luego
  50 %) y pagar en varias partidas (1.1 Muros y 2.1 Lavada de muro), pero por
  elemento y partida lo medido en mediciones sin anular nunca pasa del 100 %.
  Se revisa en el servidor, en la función de la base de datos con un bloqueo
  por proyecto y otra vez con un trigger que revisa al final de la
  transacción, aunque alguien escriba directo en la tabla.
- Cada medición se numera (MED-0001), copia la partida (número, descripción,
  unidad), el contrato y el texto de la ubicación con que se registró, y el
  modelo y su versión de cada elemento. Las cantidades las calcula la base de
  datos (4 decimales). La fecha no puede ser futura.
- **Estados**: registrada (se puede cambiar, con versión), en acta y aprobada
  (llegan con las actas, fase 4), anulada (con motivo; no se borra y sus
  elementos vuelven a quedar disponibles). Permisos: crear para registrar,
  editar para cambiar, anular para anular (el residente registra; el
  director anula).
- **Por partida**: contratado (metrado del presupuesto), medido y %; lo que
  pasa del 100 % se ve en rojo (mayor cantidad).
- **Ver en 3D** abre el visor y su panel selecciona los elementos de la
  medición (tarea de un solo uso, 30 minutos).
- Todo queda en la bitácora; nada se escribe en el modelo, en Presupuesto ni
  en Compras.

### Estructura de obra

Pestaña **Proyecto y estructura de obra** (permiso Estructura: ver; la
cambian los administradores):

- **Configuración del proyecto**: responsable técnico de calidad (aprueba
  los criterios de aceptación en la fase 6), tolerancia entre cantidad
  reportada y verificada (%) y si se permite "aceptado con observaciones"
  (apagado por defecto).
- **Niveles**: capítulo, actividad y paquete de trabajo vienen de
  Presupuesto y no se duplican. Los demás (torre, etapa, zona, nombre de
  zona, nivel, frente, disciplina y los que agregue la empresa) los define la
  plantilla de la empresa, que cada proyecto hereda y puede reemplazar con su
  propio nivel de la misma clave. Cada nivel dice de dónde sale su valor:
  propiedad del modelo (solo lectura), atributo de Propiedades por IFCGUID, o
  asignación a mano. Un nivel no puede ser su propio superior.
- **Valores** de cada nivel (Torre 1, Piso 5…), dentro de su valor superior,
  con responsable (del equipo del proyecto), inicio, fin, estado y nota. Un
  valor no se repite dentro del mismo valor superior (sin importar
  mayúsculas): el Piso 2 de cada torre es otro lugar. No se borra: se deja
  inactivo.
- **Traer ubicaciones de la EDT**: los paquetes de trabajo por ubicación de la
  EDT de la programación (Nivel = PISO 2) proponen los valores que faltan en
  el nivel que corresponde a esa columna de la memoria; se marca cuáles crear
  y dentro de qué valor superior. Nada se crea sin confirmar.
- **Niveles obligatorios de la ubicación** de las mediciones, en la
  configuración del proyecto.

### Bitácora

Pestaña **Bitácora** (permiso Bitácora: ver solo de este proyecto; los
administradores de la empresa ven toda la empresa). Cada fila: posición,
fecha y hora (Colombia), quién, qué, sobre qué, resultado (hecho, negado,
error) y el detalle (antes → después, motivo). Quedan todos los cambios y
todos los intentos negados, incluido entrar sin acceso. Nunca guarda tokens
ni secretos.

Es **inmodificable** en tres capas: el rol de servicio solo tiene `select,
insert`; triggers rechazan `update`, `delete` y `truncate` aunque alguien
recupere esos permisos; y cada fila guarda la **huella SHA-256 de la
anterior** (una cadena por empresa, otra para el administrador técnico),
calculada por PostgreSQL. El botón **Verificar integridad** recalcula la
cadena: si alguien cambió o borró una fila a mano desde el SQL Editor, dice
desde qué fila no cuadra.

### Esquema de la base de datos

[`supabase/control-obra.sql`](supabase/control-obra.sql) (se puede volver a
ejecutar sin perder datos; va por bloques numerados y cada bloque queda en
`obra_migraciones`). RLS activado sin políticas en todas las tablas.

| Tabla / función | Contenido |
|---|---|
| `obra_empresas` | Empresas: razón social, NIT y dígito, activa, versión |
| `obra_licencias` | Historial de la licencia (solo inserción): evento, plan, vigencia, cupos, módulos, suspendida, motivo, soporte |
| `obra_empresa_proyectos` | Proyectos de Trimble registrados por cada empresa (uno activo por proyecto) |
| `obra_roles` | Roles de la empresa con sus permisos (solo los válidos) |
| `obra_usuarios` | Personas de la empresa: usuario de Trimble (o invitado por correo), administrador de la empresa, activa |
| `obra_asignaciones` | El rol de cada persona en cada proyecto: administrador del proyecto, desde, hasta, activo |
| `obra_config` | Por proyecto: responsable técnico, tolerancia, aceptado con observaciones |
| `obra_niveles` / `obra_nodos` | Niveles de la estructura (plantilla o proyecto) y sus valores |
| `obra_bitacora` | La bitácora encadenada (solo inserción) |
| `obra_mediciones` | Mediciones: número, partida (copia), contrato o obra propia, ubicación (valor de cada nivel y su texto), fecha, origen, cantidad, estado, motivo, versión |
| `obra_medicion_elementos` | Elementos del modelo de cada medición: modelo, versión, IFCGUID, % medido, cantidad del modelo y cantidad (la partida repetida con clave compuesta, para la regla del 100 %) |
| `obra_medicion_lineas` | La memoria de cantidades de las mediciones a mano |
| `obra_consecutivos` | Último número por proyecto y tipo de documento |
| `obra_vistas` | Lo que el panel del visor debe seleccionar al abrirse (un uso, 30 minutos) |
| `obra_flujos` | Por proyecto y tipo de documento: los pasos del flujo de aprobación (nombre y rol), versión |
| `obra_aprobaciones` | Cada envío, aprobación, devolución o anulación de un documento (solo inserción; devolver y anular con motivo) |
| `obra_migraciones` | Los bloques del SQL ya ejecutados |
| `obra_permisos_de(empresa, proyecto, persona)` | Permisos vigentes hoy, recortados a la licencia |
| `obra_licencia_usable`, `obra_es_admin_empresa`, `obra_es_admin_proyecto` | Las condiciones que revisan las funciones |
| `obra_guardar_*`, `obra_registrar_licencia`, `obra_vincular_*`, `obra_desvincular_proyecto` | Los cambios, con sus reglas y su fila de bitácora |
| `obra_bitacora_verificar(cadena)` | Recalcula una cadena y dice dónde se rompe |
| `obra_guardar_medicion`, `obra_anular_medicion` | Registrar, cambiar o anular una medición, con permisos, ubicación, cantidades y la regla del 100 % |
| `obra_medicion_elementos_100`, `obra_mediciones_revisar` | Triggers diferidos: el 100 % por elemento y partida, la cantidad igual a la suma, una anulada no vuelve |
| `obra_guardar_flujo` | Guarda un flujo revisando roles activos con el permiso del módulo y la licencia |
| `obra_flujo_accion` | El recorrido de un documento por su flujo (lo usan las funciones de cada documento; el servidor no la llama directo) |

### API

Todas bajo `/api/control-obra`, con `?projectId=` y el token de Trimble
(`Authorization: Bearer`).

| Ruta | Qué hace | Quién |
|---|---|---|
| `GET estado` | Quién eres, la empresa, su licencia, tu acceso y a quién pedirlo | Cualquiera del proyecto (sin acceso deja registro) |
| `POST vincular` / `POST desvincular` | Registrar o retirar (con motivo) el proyecto | Administrador de la empresa que sea ADMIN del proyecto en Trimble |
| `GET accesos` | Roles, personas y accesos del proyecto | Administradores o Accesos: ver |
| `PUT accesos/asignaciones` | Dar, cambiar o revocar un acceso | Administradores |
| `PUT accesos/roles` / `PUT accesos/usuarios` | Roles de la empresa / activar o desactivar una persona | Administrador de la empresa |
| `GET contactos` | Equipo del proyecto en Trimble | Administradores |
| `GET estructura` | Niveles, plantilla, valores y configuración | Estructura: ver o administradores |
| `PUT estructura/niveles` / `PUT estructura/nodos` / `PUT config` | Cambiar la estructura y la configuración | Administradores (la plantilla, solo el de la empresa) |
| `GET bitacora` / `POST bitacora/verificar` | Consultar y verificar | Bitácora: ver o administrador de la empresa |
| `GET mediciones` / `PUT mediciones` | Mediciones con las partidas del presupuesto, los contratos aprobados y la estructura / registrar o cambiar | Mediciones: ver / crear o editar |
| `POST mediciones/anular` | Anular con motivo | Mediciones: anular |
| `POST mediciones/elementos` | Los elementos seleccionados según la partida: asociados, cantidad, % medido, ubicación sugerida | Mediciones: crear |
| `GET vistas` / `POST vistas` | Tomar o pedir los elementos a seleccionar en el visor | Mediciones: ver |
| `GET estructura/edt` | Valores de la estructura propuestos por la EDT | Administradores |
| `GET flujos` / `PUT flujos` | Consultar los flujos de aprobación / guardar el de un tipo de documento | Accesos: ver o administradores / administradores |
| `GET/PUT admin/empresas`, `GET/POST admin/licencias`, `PUT admin/administradores`, `GET admin/bitacora`, `POST admin/bitacora/verificar` | Empresas, licencias y administradores | Administrador técnico |

Errores (`code`): `sin-acceso`, `sin-permiso`, `no-admin`,
`solo-admin-tecnico`, `solo-admin-empresa`, `es-administrador`, `propio`,
`licencia-no-vigente`, `modulo-no-contratado`, `no-admin-trimble`,
`otra-empresa`, `paso-ajeno`, `auto-aprobacion` (403); `ya-vinculado`,
`cupo-proyectos`, `cupo-usuarios`, `usuario-inactivo`, `nombre-repetido`,
`nit-repetido`, `clave-repetida`, `valor-repetido`, `version-conflict`,
`sin-flujo`, `estado-no-permite`, `supera-100` (409); `datos`, `no-miembro`,
`rol-no-valido`, `nivel-no-valido`, `padre-no-valido`, `motivo-requerido`,
`flujo-no-valido`, `fecha-futura`, `ubicacion-no-valida`,
`cantidad-no-valida`, `partida-no-valida`, `contrato-no-valido`,
`elemento-no-asociado` (400); `sin-empresa` (404); `trimble-session` (401: recargar Trimble Connect).

El código está en `lib/control-obra/` (`types`, `roles`, `licencias`,
`accesos`, `estructura`, `flujos` y `mediciones` con las reglas puras, `bitacora` (la cadena),
`formato`, `validate`, `store` con Supabase o memoria, `service`, `routes`,
`client`, con sus pruebas) y `components/control-obra/` (`PanelControl` es el
panel del visor). Lo que se lee de Presupuesto y de Compras está en
`lib/lecturas/` (`presupuesto.ts`, `compras.ts`, `metrado.ts`): solo
consultas GET, con una prueba que lo verifica; Compras usa el mismo lector
del presupuesto.

### Instalar y poner en marcha

1. En Supabase → SQL Editor, ejecuta `supabase/control-obra.sql` (cada vez
   que cambie: se puede volver a ejecutar sin perder datos).
2. En Vercel → Settings → Environment Variables, agrega
   `CONTROL_OBRA_ADMINS` con tu ID de usuario de Trimble Connect (varios,
   separados por coma) y vuelve a desplegar.
3. Instala `https://trimble-docs.vercel.app/manifest-control-obra.json` en
   el proyecto (Configuración del proyecto → Apps & Capabilities → Add
   Custom) y, para medir desde el modelo,
   `https://trimble-docs.vercel.app/manifest-control-obra-visor.json` (panel
   del visor 3D).
4. Ábrelo: en **Empresas y licencias** crea la empresa, registra la
   activación de su licencia y nombra a su administrador por correo.
5. El administrador de la empresa abre Control de Obra en un proyecto donde
   sea ADMIN en Trimble Connect, lo registra, nombra a un administrador del
   proyecto y da los accesos.

---

## Requisitos BIM (LOIN) (proyecto)

Define **qué se modela, con qué nivel de detalle y con qué información** en
cada disciplina y etapa del proyecto, para después auditar los modelos 3D
contra eso. Se apoya en el nivel de información necesaria (LOIN, ISO
7817-1:2024): el requisito se define por propósito, hito, actor que entrega y
objeto, y se divide en información geométrica (detalle, dimensionalidad,
ubicación, apariencia y comportamiento paramétrico), información alfanumérica
y documentación.

Se construye por fases. Están la **fase 1** (catálogo de parámetros,
disciplinas, elementos a modelar con sus imágenes y parámetros exigidos,
Excel y plantillas), la **fase 2** (etapas y matriz LOIN, con exportación a
Excel y PDF para el BEP) y la **fase 3** (panel del visor 3D: modelos por
disciplina, reglas de asociación, "Probar regla", asociación manual y objetos
sin clasificar). Un solo manifiesto (`manifest-loin.json`) la pone en el menú
lateral del proyecto (`/loin`) y en el panel de extensiones del visor;
`manifest-loin-visor.json` (`/loin/visor`) es el respaldo solo para el visor.

Reglas que no cambian:

- **Nunca escribe en los Property Sets ni en los UDA de Trimble Connect.** La
  auditoría solo leerá los modelos; lo propio va a Supabase.
- **Nada del catálogo, las disciplinas, los elementos ni las plantillas se
  borra: se desactiva.** La base de datos también rechaza el borrado. Las
  imágenes sí se pueden quitar (son una ayuda, no un requisito).
- **Nada se sobrescribe en silencio**: al importar, lo que cambiaría un
  parámetro existente se muestra y se decide fila por fila.
- Guardados con versión: si otra persona guardó antes, sale el aviso y los
  cambios siguen en pantalla.

### Catálogo de parámetros (diccionario de datos)

Pestaña **Catálogo de parámetros**: buscador (código, N°, nombre,
descripción) y filtros por TDI, NDI, origen del dato, "equivalencias por
confirmar" e inactivos. Un clic en una fila abre la ficha del parámetro.

- **Cargar listado DYCO** compara los 89 parámetros del listado DYCO con el
  catálogo: los que faltan entran (marcados) y los que existen con datos
  distintos se muestran con sus diferencias (sin marcar). Volver a pulsarlo
  no cambia nada si el catálogo ya los tiene. Los cuatro que no traían N°
  quedaron con 86 (Espacio), 87 (Clasificación de ocupación según NSR-10),
  88 (Bloque o etapa) y 89 (Paquete de trabajo o conjunto); el código interno
  es `DYCO-` + N°.
- Correcciones aprobadas del listado: Decripcion → Descripción,
  permehabilidad, contructor, famila, deriba, grnade, compañia,
  DEMOLISION → DEMOLICION y las tildes de los nombres. Cada parámetro guarda
  además una equivalencia con su nombre original del listado, así que un
  modelo con "Decripcion" o "Codigo de proyecto" se sigue encontrando.
- Ficha: código interno, N°, nombre, descripción, **TDI** (grupo), **NDI**
  (1 a 3, acumulativo), **origen del dato** (Automática / A ingresar / Por
  definir), **tipo de dato** (texto, número con unidad, sí/no, fecha, lista
  de valores), regla de valor, equivalencias de lectura, URI IDS / bSDD y
  activo. Los tipos de dato de la semilla salen de la descripción del
  listado (los TRUE/FALSE son sí/no, Estado del elemento y Función de la
  edificación son listas, las medidas son números en unidades SI); son
  editables.
- **Regla de valor**: siempre se exige que no esté vacío. Los valores de
  relleno ("N/A", "-", "Default"…, editables en ⚙) solo cuentan en texto y
  listas: **un 0 en un número es válido** (el listado dice que una
  inclinación de 0° es un plano horizontal) salvo que el mínimo lo impida.
  Números: mínimo y máximo. Texto: patrón (expresión regular sobre el valor
  completo; Espacio trae `[A-ZÑ0-9_ ]+`, mayúsculas sin tildes). Listas: solo
  sus valores, sin distinguir mayúsculas ni tildes. **Probar un valor** dice
  al momento si un valor cumple y por qué no.
- **Equivalencias de lectura**: dónde se busca el parámetro en el modelo, en
  orden de preferencia (se usa la primera que tenga valor):
  `Pset_WallCommon.LoadBearing`, `Datos de identidad.Capacidad de carga`,
  `*.Capacidad de carga` (cualquier grupo), `Qto_*BaseQuantities.NetVolume`
  (comodín en el grupo) o `@Name` (atributo IFC). Los nombres no distinguen
  mayúsculas ni tildes. Las equivalencias IFC que propuso la app quedan
  **sugeridas** hasta que alguien pulse Confirmar; se revisaron contra las
  definiciones de IFC 4.3 de buildingSMART (por ejemplo, el espesor de una
  losa es `Qto_SlabBaseQuantities.Width`; su Depth es una medida en planta).
  "Resistencia al Fuego" (sí/no en DYCO) no lleva `FireRating`, que en IFC es
  un texto ("2h"): ese va con "Tiempo de resistencia al fuego (horas)".
- **Grupos TDI**: A proyecto / administrativo, B dimensiones y cantidades,
  C ubicación y espacios, D identificación y materiales, E producto y
  fabricante, J sistemas (MEP), K requisitos técnicos, seguridad y ocupación,
  L programación (4D). Los nombres se editan en ⚙ Configuración; una letra
  que usa algún parámetro no se puede quitar.
- **Exportar Excel**: hoja "1. Lista de parámetros DYCO" con las columnas del
  listado (N°, TDI, NDI, Dato, Parámetro, Descripción) y después las que
  agrega la app (código, tipo, unidad, valores, mínimo, máximo, patrón,
  equivalencias, URI, activo), más las hojas Grupos TDI e Instrucciones.
  Sirve de plantilla para importar.
- **Importar Excel**: busca la hoja con la columna "Parámetro" (el listado
  original, con su título arriba, también sirve). Reconoce cada fila por su
  código, luego por N° y luego por nombre; **solo compara y cambia las
  columnas que trae el archivo** (importar el listado original no borra las
  equivalencias). Las filas con errores se listan y no se importan. Cada
  envío de hasta 200 parámetros se guarda completo o no se guarda.

### Disciplinas y elementos

Pestaña **Disciplinas y elementos**: las disciplinas a la izquierda (código,
nombre, color) y los elementos a modelar de la elegida a la derecha, cada uno
con su miniatura, clase IFC y cuántos parámetros exige por NDI.

- **Cargar disciplinas sugeridas** agrega las que el proyecto no tenga
  (se reconocen por código): General, Arquitectura, Estructura,
  Hidrosanitaria, Eléctrica, Mecánica, Red contra incendio, Gas,
  Telecomunicaciones y Urbanismo, con unos 50 elementos usuales y su clase
  IFC. Los parámetros empiezan vacíos, salvo **Información del proyecto**
  (General, IfcProject), que exige los 14 parámetros TDI-A NDI-1: los datos
  del proyecto se piden a ese objeto y no a cada muro.
- Ficha del elemento, en tres pestañas:
  - **Ficha**: código, nombre, disciplina, clase IFC (con lista de las
    usuales), tipo predefinido, clasificación (OmniClass / Uniclass y código)
    y notas de modelado (por capas, por nivel, uniones, qué no se modela).
  - **Parámetros exigidos**: se agregan del catálogo con buscador, o con
    **Agregar todos los NDI-n del grupo TDI-X**. Cada uno es obligatorio u
    opcional y puede tener **su propio NDI o su propia regla solo para este
    elemento** (p. ej. Grosor de losa entre 0.08 y 0.50 m). El NDI es
    acumulativo: cuando una etapa pida NDI-2, el elemento deberá tener sus
    parámetros NDI-1 y NDI-2.
  - **Imágenes**: hasta 6 por elemento (PNG, JPG o WebP). Se reducen en el
    navegador a 1600 px por lado (WebP, o JPEG si el navegador no escribe
    WebP) antes de subirlas: una foto de celular de varios MB queda en unos
    cientos de KB. El servidor
    revisa que el archivo sea de verdad una imagen (por sus primeros bytes) y
    lo guarda en el bucket **privado** `loin-imagenes` de Supabase Storage;
    el navegador solo recibe enlaces firmados que vencen en una hora.
- **Plantillas…**: una disciplina completa (elementos, parámetros exigidos,
  notas e imágenes) se guarda como plantilla en el proyecto base del catálogo
  y cualquier proyecto con la misma base la copia con **Usar en este
  proyecto**. La copia es independiente; si el código ya existe se le agrega
  -2, -3…; los parámetros que el catálogo del proyecto no tenga se dejan
  fuera y se avisa. Las plantillas se desactivan, no se borran.

### Etapas y matriz LOIN

Pestaña **Matriz LOIN**: una fila por elemento activo (agrupados por
disciplina) y una columna por etapa activa. Cada celda dice qué se exige a
ese elemento en esa etapa: **LOD** (detalle geométrico, 100 / 200 / 300 /
350 / 400 / 500), **NDI** (nivel de información, acumulativo), **propósito**
(coordinación, cantidades, licencia, construcción…; se pueden agregar otros)
y **actor responsable** (quién entrega), más una nota opcional.

- **Etapas…**: código, nombre, **fecha del hito** (DD-MM-AAAA) y orden
  (↑ ↓). **Cargar etapas sugeridas** agrega Anteproyecto, Proyecto / diseño
  de detalle, Licencia, Construcción y As-built / entrega a operación. Las
  etapas se desactivan, no se borran.
- **Clic en una celda**: se eligen el LOD (con su descripción corta) y el
  NDI; cada botón de NDI dice cuántos parámetros exigiría ese elemento
  ("NDI-2 · 20 parám.") y abajo cuántos son obligatorios y opcionales. **No
  se exige en esta etapa** deja la celda sin LOD ni NDI (no se borra).
- **Asignar a todos** (fila de cada disciplina, en cada etapa): el mismo LOD,
  NDI, propósito y actor para todos los elementos de la disciplina.
- **Copiar de la anterior** (encabezado de cada etapa): cada elemento toma lo
  que pide en la etapa anterior (respeta el filtro de disciplina).
- En las dos acciones masivas se muestra antes cuántas celdas vacías se
  llenan, cuántas ya tienen esos valores y cuántas **ya piden otra cosa**:
  esas no se tocan salvo que se marque "Cambiar también…".
- **Colores**: un solo azul, de claro (LOD 100) a oscuro (LOD 500); gris
  claro si solo se pide NDI, y "—" si no se exige. Cada celda dice además su
  texto ("LOD 300 · NDI-2"), así que no depende solo del color. Al pasar el
  mouse se ven el detalle, los parámetros, el propósito y el actor.
- **⚠ Revisar**: la celda avisa si el LOD o el NDI bajan respecto a una
  etapa anterior, o si pide un NDI y el elemento no tiene parámetros exigidos
  de ese nivel.
- **Exportar Excel** (para el BEP): hoja "Matriz LOIN" con los colores y la
  leyenda, "Detalle por celda" (LOD, NDI, propósito, actor, nota y cuántos
  parámetros), "Información exigida" (cada parámetro que cada elemento debe
  llevar en cada etapa, con su regla y dónde se lee) y "Etapas".
- **Exportar PDF**: la matriz con sus colores en hojas horizontales (A3
  cuando hay más de 6 etapas), con leyenda, el encabezado repetido en cada
  página, la disciplina repetida si continúa y "Página x de y".
- Las descripciones de LOD son un resumen propio de la convención BIMForum
  (sus definiciones completas tienen derechos de la AIA, G202-2013; el 350
  es de BIMForum). El LOD no se puede medir automáticamente en el modelo:
  queda como requisito declarado; la auditoría (fase 4) revisa la
  información.

### Panel del visor: modelos, reglas y asociación

Panel **Requisitos BIM (LOIN)** en el visor 3D. **Solo lee los modelos**:
nunca escribe en sus Property Sets ni en los UDA. Lee los objetos por lotes
de 250, con barra de avance y **Cancelar**, una vez por sesión (botón
"Volver a leer" después de cargar una versión nueva).

- **Modelos**: cada modelo cargado con botones por disciplina (ARQ, EST…):
  se marca a cuál o cuáles pertenece. Se guarda por archivo, así que vale
  también para sus versiones nuevas. Los objetos de un modelo solo se
  comparan con los elementos de sus disciplinas; un modelo sin disciplina no
  se clasifica.
  - **Leer los modelos**: lee todos sus objetos (se ve cuántos tiene cada uno).
  - **Guardar nombres de propiedades**: guarda los nombres reales de grupos
    y propiedades (con cuántos objetos los tienen) para que en el menú del
    proyecto, en la ficha de cada parámetro, se elijan como equivalencias de
    lectura con un clic ("Agregar" o "*.Propiedad" para cualquier grupo).
- **Reglas**: por disciplina y elemento, condiciones combinadas con **Y**
  (todas) u **O** (alguna) sobre **Clase IFC** (sin mayúsculas; un subtipo
  como IfcWallStandardCase cuenta como IfcWall), **Nombre**, **Tipo**,
  **Descripción**, **Nivel** (de las propiedades usuales: Nivel, Nivel de
  referencia, Restricción de base, Level, Building Storey…) o cualquier
  **propiedad** escrita como Grupo.Propiedad o *.Propiedad. Operadores: es,
  no es, contiene, no contiene, empieza por, tiene valor, no tiene valor. Los
  campos y los valores más comunes de los modelos se sugieren al escribir.
  Ejemplo: Losa = Clase IFC es IfcSlab **y** Tipo contiene "LOSA".
  - **Usar la clase IFC del elemento** arma la primera condición.
  - **Probar regla**: cuenta los objetos que toma en los modelos de la
    disciplina, muestra ejemplos de sus tipos, y los **selecciona y pinta**
    con el color de la disciplina. **Quitar resaltado** los devuelve.
  - **Guardar regla** la guarda en el elemento. La regla también se ve y se
    edita en la ficha del elemento, en el menú del proyecto.
  - Las disciplinas sugeridas traen una regla inicial por clase IFC cuando
    la clase no se repite en la disciplina (Piso y Cielo raso son los dos
    IfcCovering: esos quedan sin regla para que se distingan por el tipo).
- **Clasificación**: **Clasificar los modelos** dice, por disciplina y
  elemento, cuántos objetos hay (por regla y a mano), los elementos sin
  ningún objeto (en rojo) y los **sin clasificar**, agrupados por clase y
  tipo con un botón **Seleccionar** por grupo. Si un objeto cumple la regla
  de varios elementos queda en el primero (por el orden de disciplinas y
  elementos) y se avisa cuántos son. Los objetos del árbol del modelo
  (proyecto, sitio, edificio, niveles, aberturas, ejes…) no cuentan como sin
  clasificar, salvo que una regla los pida (como Información del proyecto).
  **Colorear por disciplina** pinta cada objeto con el color de su disciplina
  y los sin clasificar en gris.
- **Asociación manual** (gana sobre las reglas): con objetos seleccionados
  en el visor se elige el elemento y **Asociar**. Se guarda por IFCGUID, así
  que sigue valiendo en la versión nueva del modelo si el objeto sigue ahí.
  **Quitar asociación manual** los devuelve a las reglas. Los objetos sin
  IFCGUID no se pueden asociar ni auditar (se cuentan aparte).

### Permisos

| Acción | Quién |
|---|---|
| Ver catálogo, disciplinas, elementos, imágenes y plantillas | Cualquier miembro del proyecto |
| Editar disciplinas, elementos e imágenes, etapas y matriz LOIN, usar plantillas, valores de relleno y umbral; en el visor: disciplinas de los modelos, reglas, asociación manual y nombres de propiedades | Administradores del proyecto y **editores** elegidos en ⚙ Configuración |
| Probar reglas y clasificar en el visor | Cualquier miembro (solo lee) |
| Editar el catálogo, los grupos TDI y las plantillas | Administradores y editores del proyecto **base** del catálogo |
| Elegir editores y proyecto base | Administradores del proyecto |

Como en Presupuesto, un proyecto puede usar el catálogo de otro (⚙ → proyecto
base): así se mantiene un solo diccionario de datos para toda la empresa. Las
disciplinas y elementos siguen siendo de cada proyecto.

### Esquema de la base de datos

[`supabase/loin.sql`](supabase/loin.sql) (se puede volver a ejecutar sin
perder datos; probado dos veces seguidas con PGlite). RLS activado sin
políticas: solo el servidor (clave de servicio) lee y escribe.

| Tabla / función | Contenido |
|---|---|
| `loin_config` | Por proyecto: proyecto base, editores, valores de relleno, umbral del amarillo |
| `loin_catalogos` | Por proyecto base: nombres de los grupos TDI |
| `loin_parametros` | El catálogo (código único por base, sin importar mayúsculas), con versión |
| `loin_disciplinas` | Por proyecto (código único), con versión |
| `loin_elementos` | Por proyecto (código único dentro de su disciplina); los parámetros exigidos van en la misma fila (`parametros` jsonb), con versión |
| `loin_imagenes` | Dónde está cada imagen en el bucket, sus medidas y quién la subió |
| `loin_plantillas` | Por proyecto base; el contenido no cambia después de guardarla |
| `loin_etapas` | Por proyecto (código único): nombre, fecha del hito, orden, activa; con versión |
| `loin_matriz` | Una celda por elemento × etapa (única): LOD, NDI, propósitos, actor, nota; con versión. Sin LOD ni NDI = no se exige |
| `loin_guardar_etapa(...)`, `loin_guardar_matriz(proyecto, celdas, usuario)` | Como las demás; la matriz guarda todas las celdas o ninguna y exige que el elemento y la etapa sean del proyecto |
| `loin_elementos.regla` | La regla de asociación del elemento (jsonb: modo y condiciones; vacía = sin regla) |
| `loin_modelos` | Por proyecto y archivo: nombre y disciplinas del modelo |
| `loin_asociaciones` | Por proyecto e IFCGUID (único): archivo y elemento asociado a mano |
| `loin_campos_modelo` | Por proyecto: los nombres de grupos y propiedades leídos de los modelos, cuándo y quién |
| `loin_asociar(proyecto, elemento, objetos, usuario)` | Asocia (o con elemento vacío, quita) varios objetos: todos o ninguno; el elemento debe ser del proyecto |
| `loin_guardar_parametros(base, filas, usuario)` | Guarda varios: todos o ninguno (`version-conflict`, `duplicate-code`) |
| `loin_guardar_disciplina`, `loin_guardar_elemento`, `loin_guardar_plantilla` | Crean (versión 0) o cambian si la versión coincide; el elemento debe ser de una disciplina del proyecto |
| `loin_sin_borrar()` | Trigger que rechaza borrar parámetros, disciplinas, elementos, plantillas, etapas y celdas de la matriz |
| Bucket `loin-imagenes` | Privado, 2 MB por archivo, solo PNG / JPG / WebP |

### API

Todas las rutas piden `?projectId=` y el token de Trimble del usuario, y
comprueban que sea miembro del proyecto (`lib/loin/routes.ts`).

| Ruta | Qué hace |
|---|---|
| `GET /api/loin/estado` | Configuración, grupos TDI y qué puede hacer quien llama |
| `PUT /api/loin/config` | Editores y base (administradores); valores de relleno y umbral (editores) |
| `GET /api/loin/contactos` | Personas y grupos del proyecto, para elegir editores |
| `GET /api/loin/catalogo` | Parámetros y grupos TDI del proyecto base |
| `POST /api/loin/catalogo/parametros` | Crea o cambia parámetros (todos o ninguno) |
| `PUT /api/loin/catalogo/tdi` | Nombres de los grupos TDI |
| `GET/PUT /api/loin/elementos` | Disciplinas, elementos e imágenes (con enlaces firmados) / guarda un elemento |
| `POST /api/loin/elementos/sugeridas` | Agrega las disciplinas sugeridas que falten |
| `PUT /api/loin/disciplinas` | Guarda una disciplina |
| `POST /api/loin/imagenes` | Sube una imagen (el cuerpo es la imagen ya reducida) |
| `DELETE /api/loin/imagenes/[id]` | Quita una imagen |
| `GET/POST/PUT /api/loin/plantillas` | Lista, crea desde una disciplina, renombra o desactiva |
| `POST /api/loin/plantillas/aplicar` | Copia una plantilla a este proyecto |
| `PUT /api/loin/etapas` | Guarda una etapa |
| `POST /api/loin/etapas/sugeridas` | Agrega las etapas usuales que falten |
| `GET/POST /api/loin/matriz` | Etapas y celdas / guarda celdas (todas o ninguna) |
| `GET /api/loin/visor` | Disciplinas de los modelos y asociaciones manuales |
| `PUT /api/loin/modelos` | Disciplinas de un modelo |
| `POST /api/loin/asociaciones` | Asocia objetos a un elemento (o los desasocia) |
| `GET/PUT /api/loin/campos-modelo` | Nombres de propiedades leídos de los modelos |

Lógica pura con pruebas en `lib/loin/` (`alias.ts`, `reglas.ts`, `ndi.ts`,
`semilla.ts`, `importar.ts`, `plantillas.ts`, `excel.ts`, `matriz.ts`,
`exportarMatriz.ts`, `clasificacion.ts`) y servicio probado contra
`memoryStore()` (`service.test.ts`). La lectura del visor
(`lecturaVisor.ts`) usa los lectores de Gráficos de Modelos.

### Lo que sigue

4. **Auditoría**: presencia, contenido, regla y origen de cada parámetro,
   colores en el visor, excepciones, historial y reportes.
5. **IDS**: exportar (luego importar) y, con confirmación, ToDos/BCF.

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
   | Manuales | `https://trimble-docs.vercel.app/manifest-manuales.json` |
   | Compras y Contratación | `https://trimble-docs.vercel.app/manifest-compras.json` |
   | Control de Obra | `https://trimble-docs.vercel.app/manifest-control-obra.json` |
   | Requisitos BIM (LOIN) | `https://trimble-docs.vercel.app/manifest-loin.json` |

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
   **Requisitos BIM (LOIN)** también: los requisitos en el menú lateral y la
   asociación con los modelos en el visor (respaldo:
   `https://trimble-docs.vercel.app/manifest-loin-visor.json`).
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
