# Flujo de aprobación

Extensión de proyecto (`/flujo-aprobacion`, `manifest-flujo-aprobacion.json`,
código en `lib/flujo-aprobacion/`, `components/flujo-aprobacion/`,
`app/api/flujo-aprobacion/`). Pedida el 04-11-2026: revisión y aprobación de
entregables (modelos .rvt, planos .pdf y .dwg, fotos, documentos, Excel) y su
paso controlado a una carpeta destino, para que en ella solo haya aprobados.
Pantallas pedidas: configuración del flujo (+ adicionar, − quitar, guardar),
roles por carpeta o archivo (selección múltiple) con personas o grupos de la
lista de Trimble, estados, avisos, traslado y trazabilidad exportable a PDF.

## Contradicciones de la especificación (señaladas y resueltas por el dueño)

1. Orden de pasos: la imagen decía realiza → aprueba → revisa, la tabla
   "revisa – aprueba – revisa", las secciones 6 y 7 un solo "Revisor-Aprobador"
   y la 2.1 un flujo con + / −. Resuelto: pasos configurables.
2. "En destino sale v1" contra "sobrescribe como versión nueva": en Trimble el
   mismo nombre crea v2, v3… Resuelto: v1 la primera vez, luego v2, v3.
3. Mover contra copiar: mover lleva todas las versiones y saca el archivo de la
   carpeta de revisión. Resuelto: copiar siempre.
4. "Sobrescribe" contra la regla fija 2. Resuelto: lo que no llegó por el flujo
   se muestra y se pregunta.
5. "Solo vean aprobados": la extensión no puede impedir subidas directas desde
   Trimble; depende de los permisos nativos de la carpeta.
6. Tres vocabularios de permisos (acceso completo / mover o copiar / ver y
   descargar; Edita / Consulta; revisa / aprueba). "Mover o copiar" no es un
   permiso de Trimble.
7. "Administrador de la extensión" y "administrador general de la plataforma".
8. Trimble no avisa subidas (sin webhooks) ni deja a una extensión usar su
   campana de notificaciones.

## Decisiones del dueño (04-11-2026: "sí acepto las recomendaciones")

1. Flujo configurable: **Realiza** (quien sube) + pasos que se agregan o quitan
   (por defecto **Revisa → Aprueba**); la aprobación del último paso dispara el
   traslado; un rechazo en cualquier paso vuelve a quien realizó.
2. **Copiar siempre**, nunca mover.
3. En el destino: v1 la primera vez, después v2, v3… (historial de aprobadas);
   el historial dice "v5 de revisión = v2 de destino".
4. Archivo en el destino que no llegó por el flujo: mostrar y preguntar antes de
   reemplazar (regla 2).
5. Aviso: bandeja **«Por revisar»** en la extensión + **ToDo de Trimble**
   asignado al revisor con el archivo (Trimble manda correo). Sin correo propio.
6. Detección **al abrir la extensión** + botón **«Revisar ahora»** (como
   Publicar). Revisión diaria con cuenta conectada solo si la pide.
7. Permisos nativos de Trimble: la extensión **revisa y avisa**, no los cambia.
8. Administradores = **administradores del proyecto en Trimble**.
9. **Quien sube no aprueba** su propio archivo. *Ajuste del 09-11-2026*: el
   dueño reportó "el usuario responsable no le sale el botón decidir" (en
   Supabase: «aprobar torre 2», responsable de «Aprueba» = Jaiden Rincon, que
   subió «CIRCUITOS TR1.rvt») y pidió que le salga. Ahora la **persona nombrada
   responsable** del paso decide aunque haya subido la versión (`meToca` true;
   `Firma.propia = true`; detalle «(su propia versión, como responsable del
   paso)»; la pantalla muestra «(su propia versión)» y lo advierte en
   Decidir). Sigue igual: en un **grupo** decide otro miembro (no quien subió) y
   un **administrador** que subió y no es el responsable no decide.
10. Paso asignado a un grupo: **basta con una persona** del grupo.
11. (Agregado por el dueño) Cada flujo tiene un **título o hito**, por ejemplo
    «Aprobar diseño arquitectónico Torre 1»: el nombre que los archivos del flujo
    soportan. Supuesto: aparece en la bandeja, la tarea de Trimble, el historial
    y el PDF; es obligatorio y no se repite en el proyecto. Nada dijo de un
    avance del hito ("3 de 5 aprobados"): no construirlo sin preguntar.

Supuestos declarados (los aceptó con el plan): solo menú del proyecto (sin
visor); carpeta destino en el mismo proyecto (entre proyectos es Publicar);
todos los tipos de archivo; subcarpetas siguen el flujo de su carpeta y se
recrean en el destino; asignación de un archivo manda sobre la de su carpeta;
"cargo" de la sección 7 = "cargó"; si llega otra versión mientras una está
pendiente, se revisa solo la última; "Aprobado" muestra si ya se trasladó o si
el traslado está pendiente (no es un estado nuevo); archivo retirado en Trimble
se marca "Retirado" y no se borra nada en el destino; historial solo inserción;
exportación solo a PDF.

## Fases

0. **Prueba en Trimble real** (hecha el 04-11-2026 en Laboratorio; resultado
   abajo). Sin Supabase.
1. **Configuración** (hecha el 04-11-2026, ver abajo): SQL
   `supabase/flujo-aprobacion.sql`, flujos con su hito, carpetas de revisión
   (selección múltiple) y destino, pasos + / −, personas y grupos por carpeta o
   archivo, revisión de permisos, historial de la configuración.
2. **Detección y registro** (hecha el 04-11-2026, ver abajo): al abrir y
   «Revisar ahora», estados, mensaje de versión nueva, «Por revisar», «Mis
   archivos» y «Archivos».
3. **Revisión** (hecha el 04-11-2026, ver abajo): aprobar por pasos, rechazar con motivo, avisos (bandeja + ToDo),
   aprobar solo la versión vista.
4. **Traslado** (hecho el 04-11-2026, ver abajo): copia automática de la última versión con la sesión de quien
   aprobó; reintento por el aprobador o un administrador si falla.
5. **Trazabilidad** (hecha el 04-11-2026, ver abajo): por archivo y general, filtros, PDF, README, guía y protocolo.

## Fase 0 (`lib/flujo-aprobacion/prueba.ts`, `components/flujo-aprobacion/PruebaFase0.tsx`)

`POST /api/flujo-aprobacion/prueba { paso }`, con el token del usuario:

- `equipo`: `listProjectUsers` (y con `groupId` para los miembros, hasta 40
  grupos) y `listProjectGroups`. Avisa si todos los grupos traen el proyecto
  entero (filtro ignorado) o si no coincide `usersCount`.
- `archivo`: `leerArchivo` + versiones por `GET /files/fs/{id}/versions` o
  `GET /files/{id}/versions` (no se sabe cuál existe; `versionesDe` acepta lista
  o `{ items }`; quién subió = `modifiedBy`, si no `createdBy`) + enlaces
  (`buildFileViewerUrl`, carpeta `data/folder/{id}`).
- `copiar`: `copiarUltimaVersion` de Publicar con origen = destino (mismo
  proyecto); archivo ya presente → `confirmar` con su `versionId`, y la copia
  solo con `siVersion` igual (regla 2). `estado-subida` / `estado-visor` como
  en Publicar.
- `tarea`: `GET /todos/types`, luego `POST /todos` probando `label` o `title` y
  `assignees` `[{ id, type: USER|GROUP }]` o `[id]` (se detiene en el primero
  aceptado o en 401/403), `POST /todos/{id}/attachments` (`[fileId]` o
  `[{ id, type: FILE }]`) y `GET /todos/{id}` para confirmar el asignado. La
  única fuente de esas rutas fue un envoltorio MCP de terceros: confirmarlas es
  el objetivo de la prueba.
- El explorador es `components/publicar/Explorador.tsx` (su `api` ahora es
  `Pick<PublicarApi, "carpeta">`).
- Pruebas: `prueba.test.ts` sobre `nubeFalsa` de Publicar con un cliente que
  responde versiones y ToDos. La página temporal del navegador puede correr el
  `pasoPrueba` real sobre la nube falsa (es pura).

## Resultado de la prueba real (Laboratorio, 04-11-2026)

- Equipo: 4 personas, 2 administradores; **Laboratorio no tiene grupos**, así
  que los miembros de grupo no se probaron aquí (Propiedades ya los lee en
  producción con `listProjectUsers(…, { groupId })` para sus responsables).
- Versiones: **`GET /files/{id}/versions`** sirve; `GET /files/fs/{id}/versions`
  da 404 `INVALID_ENDPOINT`. Cada versión trae `modifiedBy` = quien la subió
  (`createdBy` = quien creó el archivo). Hay nombres con doble espacio
  ("USUARIO  DE PRUEBA"): juntar espacios al mostrarlos.
- Enlace directo (`buildFileViewerUrl`): **abre el archivo**.
- Copia en el mismo proyecto: **`POST /files` con `fromFileVersionId` funciona**
  (copia dentro de Trimble, sin pasar por el servidor). Un `.rvt` en v12 llegó
  como **v1** al destino y, según el dueño, el visor lo mostró **sin
  «Conversión en curso»**. `GET /files/{id}/status` respondió
  `{"status":-3601}` (código sin documentar): no usarlo para decidir nada.
- ToDo: **`POST /todos` con `{ projectId, label, description, assignees: [{ id,
  type: "USER" }] }` → 201**. Al leerla, `assignees` trae id, tipo, correo y
  nombre. Llegó el correo de Trimble a la persona y la tarea se ve en ToDo.
  `GET /todos/types` devolvió una lista vacía.
- Adjuntar el archivo a la tarea **falló**: `POST /todos/{id}/attachments` con
  `{ attachments: [fileId] }` y con `[{ id, type: FILE }]` → 400 `INVALID_JSON`.
  El enlace en la descripción cumple el "enlace directo al archivo".

Sin probar todavía (antes de las fases 3 y 4, no frenan la 1): copiar otra vez
el mismo archivo a la misma carpeta (¿llega como v2 con `mergeExisting`, o
Trimble lo renombra?) y una tarea asignada a un grupo (`type: "GROUP"`), en un
proyecto que tenga grupos.

## Fase 1: configuración (`lib/flujo-aprobacion/flujos.ts`, `permisos.ts`, `service.ts`, `store.ts`)

Las 5 reglas que el dueño aprobó al decir "Sigue con la fase 1" (04-11-2026):

1. Una carpeta en **un solo flujo activo**; anidadas: manda la más cercana
   (`flujoDe`). En SQL: *trigger* `aprobacion_revisar_carpetas` con
   `pg_advisory_xact_lock` por proyecto (`carpeta-en-otro-flujo`).
2. Destino y revisión **nunca uno dentro del otro**, en el mismo flujo o entre
   flujos (`conflictos`; solo en el servicio: necesita las carpetas de arriba).
3. 1 a **5 pasos** después de «Realiza» (`MIN_PASOS`, `MAX_PASOS`), nombres
   distintos y distintos de «Realiza»/«Consulta».
4. Los archivos en trámite siguen con el flujo con el que empezaron: guardar
   **una copia de los pasos en cada archivo** desde la fase 2.
5. Hito único en el proyecto (`hito_clave` sin tildes ni mayúsculas, índice
   único sobre todos los flujos, activos o no: reactivar nunca choca).

Piezas:
- Los pasos tienen id estable (`p1`, `p2`… con `idsDePasos`): renombrar no
  rompe las asignaciones. Papel = `realiza`, `consulta` o el id de un paso.
- Carpetas y destino se guardan en jsonb con `ruta` y `ancestros` (ids de la
  raíz hacia abajo), leídos de Trimble (`getFolderDetails ?fields=path`,
  `elementoDe` en `routes.ts`, la raíz con el nombre del proyecto). Las
  asignaciones guardan también `objetivo_ancestros`: así `responsablesDe`
  resuelve por cercanía sin pedir nada a Trimble.
- `responsablesDe(x, papel, asignaciones)`: las del objetivo más cercano que
  tenga alguna para ese papel (archivo, luego sus carpetas hacia arriba). Lo
  usarán las fases 2 y 3 para saber a quién avisar y quién puede aprobar.
- Quitar un paso o una carpeta con asignaciones: 409
  `confirmar-asignaciones` y, con `confirmar: true`, se desactivan.
- Guardado optimista: `version` en la fila; PATCH con `version=eq.N`.
- `permisos.ts`: ACL efectiva = propias + heredadas si la herencia está
  encendida; acceso de una persona = su entrada propia, si no la mejor de sus
  grupos y de `tc-groups:*`; administradores = acceso completo. Avisos:
  `riesgo` (otros con acceso completo al destino), `falla` (aprobador del
  último paso sin acceso completo al destino; asignado sin acceso en su
  carpeta; «Realiza» con solo lectura), `info` (ACL vacía o no legible). No
  se sabe si Trimble da prioridad a la entrada propia o a la mejor de grupos:
  por eso los textos dicen "no aparece con…".
- El `store` se abre solo cuando se usa (getter en `routes.ts`): la prueba de
  la fase 0 sigue funcionando sin Supabase.
- Pruebas: `flujos.test.ts`, `permisos.test.ts`, `service.test.ts` (servicio
  real sobre `memoryStore` y un Trimble falso). SQL probado dos veces con
  PGlite y sus reglas (en PGlite el rol `service_role` necesita `bypassrls`,
  como en Supabase).
- La página temporal del navegador monta `FlujoAprobacionApp` con el servicio
  real sobre `memoryStore` (corre en el navegador) y un árbol de carpetas fijo.
  Ahí el error llega como `FlujoError` y no como `ApiError`: la pantalla lee
  `code` de cualquiera de los dos.

## Fase 2: detección y registro (`registro.ts`, `recorrido.ts`, `revision.ts`)

El dueño dijo "Sí, fase 2" (04-11-2026). Decisiones tomadas por lo más simple
(declaradas al entregar):

- La revisión la pide el navegador al abrir (cada flujo activo, uno tras otro)
  y con «Revisar ahora»; corre en el servidor con la sesión de quien abre.
  `POST /api/flujo-aprobacion/revisar { flujoId }`, `maxDuration = 120`.
- Candado por flujo: `aprobacion_flujos.revisando_hasta` (3 min), tomado con
  PATCH filtrado (`tomarRevision`), sin tocar `version`; al terminar se anota
  `revisado` y `revisado_por`. El *trigger* de carpetas corre también en ese
  PATCH (no choca: lo probó PGlite).
- `recorrer`: BFS en tandas de 6 carpetas, tope 50 s / 1500 carpetas / 5000
  archivos; no entra en subcarpetas que son carpeta de revisión de cualquier
  flujo activo (el más cercano manda; evita contar dos veces). Una carpeta que
  no se lee (403) o un tope deja `completo = false`.
- Quién subió = `modifiedBy` del item de la carpeta (la fase 0 confirmó que
  `modifiedBy` de una versión es quien la subió); fecha = `modifiedOn`.
- `planRegistro`: nuevo → `pendiente` con copia de `pasos` y `pasoActual 0`;
  versión distinta esperando → `version-reemplazada` (mismos pasos, paso 0);
  versión distinta tras aprobado/rechazado → `nueva-version` con los pasos
  actuales del flujo (un trámite nuevo); viene de otro flujo →
  `archivo-cambio-flujo` (pendiente, sin aprobada); retirado que vuelve →
  recupera su estado (`estadoAlReaparecer`); renombrado o movido dentro del
  flujo → solo ruta, sin historial.
- Retirar: solo con recorrido completo, por un **administrador**, y si
  `tc.archivo` da 404 o el archivo quedó fuera del flujo (`flujoDe`); hasta 50
  comprobaciones por revisión. Un miembro ve el aviso "N archivos registrados
  no aparecieron en tu revisión".
- Historial por archivo en `aprobacion_historial` (`archivo_id`, `file_id`,
  `version`, `ocurrido` = fecha de Trimble). Al subir: `usuario` = quien subió;
  el detalle dice quién lo registró. `registrarVarios` inserta en lotes de 500
  con todas las columnas (PostgREST pide las mismas claves en un lote). El
  servicio ordena por `ocurrido ?? creado`.
- `meToca`: el caller (o uno de sus grupos, `caller.memberOfGroups`) tiene el
  paso actual por `responsablesDe` y **no subió esa versión** (regla 9, ya
  aplicada para la bandeja; la fase 3 la debe exigir también al aprobar).
- Todos los miembros ven todos los archivos registrados (el papel «Consulta»
  aún no restringe nada).
- Pestañas: Por revisar (con «Ver todos los pendientes» para administradores),
  Mis archivos (`subidoPorId === yo`), Archivos (filtros), Flujos, Historial,
  Prueba de Trimble. `RevisionCarpetas` muestra el resultado arriba.
- Pruebas: `registro.test.ts`, `recorrido.test.ts`, `revision.test.ts`
  (servicio real sobre `memoryStore` con un árbol de carpetas que la prueba
  cambia). La página temporal monta la app con el servicio real y un árbol fijo;
  `window.nuevaVersion("f1")` simula una subida.

Para la fase 3: aprobar/rechazar deben comprobar que la versión vista sigue
siendo `versionId` (si llegó otra, rechazar con aviso), avanzar `pasoActual`,
guardar firmas por paso, exigir que quien subió no apruebe, y al último paso
dejar `aprobado` + `versionAprobadaId`/`revisionAprobada`.

## Fase 3: aprobar, rechazar y avisos (`decision.ts`, `avisos.ts`, `decisiones.ts`)

El dueño dijo "Sí, fase 3" (04-11-2026). Lo que se hizo y lo que se decidió
por lo más simple:

- `puedeDecidir`: decide quien tiene el paso actual (`meToca`: persona o
  cualquier miembro del grupo, uno basta) o un administrador (`comoAdmin`,
  queda en la firma y en el historial). **Quien subió la versión nunca
  decide**, administrador incluido (regla 9 aprobada).
- `planDecision`: aprobar un paso → `pasoActual + 1`; el último → `aprobado`
  con `versionAprobadaId`/`revisionAprobada`; rechazar → `rechazado` (motivo
  obligatorio, 3 a 1000 caracteres). Cada decisión agrega una `Firma` a
  `aprobacion_archivos.firmas` (jsonb); `planRegistro` la vacía al empezar una
  revisión nueva (versión nueva, reemplazo, cambio de flujo).
- No se pide que una persona firme un solo paso del mismo archivo (Control de
  Obra sí lo exige): no estaba en la especificación.
- `decidir` comprueba: la versión que mandó el navegador = la registrada; la
  última de Trimble (`tc.version` = `getFileDetails().versionId`) = la
  registrada (si no, "pulsa Revisar ahora"); y guarda con
  `decidirArchivo` (PATCH filtrado por `version_id`, `paso_actual` y
  `estado`): dos decisiones a la vez → la segunda `ya-decidido`.
- Avisos = ToDos (`tc.crearTarea` → `POST /todos` con `label`, `description`,
  `assignees [{ id, type }]`): `avisosRevision` junta por (flujo, paso, mismas
  personas), hasta 15 enlaces por tarea; se envían al registrar (nuevos,
  versión nueva, reemplazo, cambio de flujo; no al reaparecer) y al pasar al
  siguiente paso; `avisoRechazo` va a `subidoPorId` con el motivo y la carpeta.
  Tope 20 tareas por revisión o decisión. `enviarAviso` nunca lanza: si
  Trimble rechaza un grupo, repite con sus miembros como USER. Cada envío deja
  `aviso-enviado` o `aviso-fallido` en el historial. Si el paso no tiene a
  nadie asignado, no se avisa (los administradores lo ven con «Ver todos los
  pendientes»). Las tareas no se cierran solas (no se probó `PATCH /todos`).
- Pantalla: botón **Decidir** en la fila (si `meToca`, o administrador, y no
  subió esa versión), panel con la versión y el paso, cuadro de texto,
  «Aprobar «paso»» y «Rechazar». Las firmas se ven bajo el estado; un
  rechazado muestra "Corregir y subir una versión nueva — Motivo: …".
- Fechas de firmas con `fechaHora(...).slice(0, 10)` (hora de Colombia): con
  `slice` del ISO salía el día siguiente después de las 19:00.
- Pruebas: `decision.test.ts` (reglas y avisos puros) y `decisiones.test.ts`
  (servicio de punta a punta con `memoryStore`: aviso al registrar, paso a
  paso, rechazo y versión corregida, versión vieja, quien subió, decisiones a
  la vez).

Para la fase 4: al quedar `aprobado`, copiar `versionAprobadaId` a la carpeta
destino con la sesión de quien aprobó (`copiarUltimaVersion` de Publicar con
origen = destino); si el destino ya tiene el nombre y no llegó por el flujo,
mostrar y preguntar (regla 2); recrear subcarpetas; anotar quién trasladó y
cuándo; reintento por el aprobador o un administrador. Antes, que el dueño
pruebe la segunda copia como v2.

## Fase 4: copia a la carpeta destino (`traslado.ts`, `trasladar.ts`)

El dueño dijo "Sí, fase 4" (04-11-2026) sin haber probado aún la segunda copia
como v2. Por eso el diseño evita lo no comprobado:

- Primera copia (nada con ese nombre en el destino): `copiarUltimaVersion`
  normal (POST /files `fromFileVersionId`, comprobado en real: v1, sin
  reconversión; si falla, subida por el servidor).
- Archivo ya en el destino y es la última copia del flujo
  (`traslado.destinoVersionId`) o la versión que la persona confirmó
  reemplazar: **solo subida** con `If-Match` (opción nueva `soloSubida` de
  `copiarUltimaVersion`; lo comprobado en la prueba real de Publicar: mismo
  nombre = versión nueva). No se usa `POST /files` con `mergeExisting` (no se
  sabe si Trimble renombra).
- Se copia **`versionAprobadaId`** (opción nueva `versionFija`: la descarga y
  el TRB piden esa versión; en la nube falsa `downloadurl` ahora respeta
  `versionId`).
- `situacionDestino`: nuevo / version-nueva / diferencia. Diferencia → no se
  toca; `traslado.diferenciaVersionId` + texto (versión, quién, fecha); se
  reemplaza con `paso: "reemplazar", siVersion` = esa versión (si cambió otra
  vez, vuelve a diferencia).
- Subcarpetas: `carpetaDeRevision` (la más cercana del flujo) +
  `subcarpetas` (nombres desde la ruta) → `asegurarRuta` (busca o crea con
  `crearCarpeta`).
- Quién: `puedeTrasladar` = hay `versionAprobadaId` y no está retirado; el
  último aprobador (firma) o un administrador. Tras empezar una revisión nueva
  (firmas vacías) solo un administrador.
- Al aprobar el último paso, `decidir` llama a `trasladar` en la misma
  petición (`aprobar` con `maxDuration = 300`); un error del traslado nunca
  deshace la aprobación: queda `traslado.estado = "error"` y «Trasladar otra
  vez».
- Subida por el servidor → `en-curso` con `uploadId`; `confirmarTraslado`
  (GET /files/fs/upload) → hecho / error; la pantalla pregunta cada 4 s (hasta
  45 veces) por los que inició la persona (o todos, si es administrador).
- Candado por archivo `traslado_hasta` (6 min); `trasladar` sobre algo ya
  copiado responde "ya está"; sobre algo en curso, confirma.
- Historial: `trasladado` (quién, versión aprobada, versión en destino),
  `traslado-diferencia`, `traslado-error`.
- Pruebas: `traslado.test.ts` (puras) y `trasladar.test.ts` (servicio con la
  nube falsa de Publicar: v1, subcarpetas, v2 encima, ajeno con confirmación,
  reintento con la versión aprobada, no duplicar).

Para la fase 5: trazabilidad por archivo y general con filtros y PDF (quién
subió y cuándo, quién revisó, decisión y fecha, comentarios, quién trasladó y
cuándo); usar `aprobacion_historial` y `firmas`; las librerías de PDF ya
usadas en Compras (`lib/compras/pdfOrden.ts`).

## Fase 5: trazabilidad y PDF (`trazabilidad.ts`, `pdfTrazabilidad.ts`)

El dueño dijo "Sí, fase 5" (04-11-2026). Con esto las 6 fases (0–5) están en
código; falta la prueba completa en Trimble real (protocolo en el README,
"Protocolo de prueba en Trimble real").

- `armarTrazas`: por archivo, las líneas de `aprobacion_historial` con
  `archivo_id` (todas: `store.historialArchivos` lee por páginas con `all()`,
  porque PostgREST corta en 1000), ordenadas por `ocurrido ?? creado`; filtros
  por flujo, estado, texto y días de Colombia (`diaColombia` vía `fechaHora`,
  porque las noches colombianas ya son otro día en UTC). Con fechas, solo
  archivos con movimientos en esos días.
- `resumenTraza`: flujo, ubicación, estado y versiones, última subida, última
  decisión, traslado. No se "parsean" los textos del historial: el detalle de
  cada línea ya dice paso, decisión y comentario.
- `ACCIONES` (nombres de las acciones) vive en `trazabilidad.ts` y lo usa
  también el bloque Historial del panel.
- `trazabilidad(ctx, q)` en `service.ts` valida filtros (`AAAA-MM-DD`, estado,
  uuid) y devuelve `por` (quien consulta) para el PDF. Cualquier miembro.
- PDF con jsPDF en el navegador (como Compras), carta horizontal, columnas
  Fecha / Quién / Qué / Versión / Detalle, salto de página con "(continúa)" y
  cabecera repetida, "Página n de m". Nombre: `Trazabilidad - <proyecto o
  archivo> - DD-MM-AAAA.pdf`. La pantalla usa su propia función de descarga
  (la de `lib/presupuesto/excel.ts` arrastra la tabla OmniClass); desde la
  pantalla única está en `components/flujo-aprobacion/descargas.ts`.
- Pruebas: `trazabilidad.test.ts`, `pdfTrazabilidad.test.ts` (páginas y nombre)
  y la última de `trasladar.test.ts` (servicio de punta a punta).

## Una sola pantalla (06-11-2026)

El dueño pidió, con la pantalla de **paquetes** de Trimble como referencia,
"que todo se haga en una sola pantalla, no en pestañas" y que al dar clic en la
fila del flujo aparezcan sus detalles. Propuse el diseño con tres campos nuevos
(fecha de vencimiento, notas, comentarios) y respondió "Sí, adelante".

- **Sin pestañas**: `FlujoAprobacionApp` = cabecera (Buscar flujo, «Tienes N
  archivos por revisar» que activa el filtro `porRevisar`, **Nuevo** solo
  administradores, ⋮ con «Exportar trazabilidad (todos los flujos)…» y «Prueba
  de conexión con Trimble…» en `Modal`), `RevisionCarpetas`, `ListaFlujos` y un
  `aside` pegajoso de `min(560px, 46%)`; bajo 1000 px el panel es `fixed`
  encima de la lista. Estado del panel: `detalle | nuevo | editar | null`. El
  bucle que confirma traslados (cada 4 s, hasta 45 veces) quedó en la app.
- **`lib/flujo-aprobacion/lista.ts`** (puro, `lista.test.ts`): `filasFlujos`
  (activos primero, por hito), `estaVencido` = activo && `vence < hoy` && hay
  archivos esperando revisión (`ESPERANDO`: pendiente o nueva versión; los rechazados no cuentan), `responsablesFlujo`
  (nombres de las asignaciones activas de pasos), `opcionesFiltro` y
  `filtrarFilas` (propietario = `creadoPor`, quien `persona:id|grupo:id`,
  estado, vence `vencidos|7dias|sin-fecha`, porRevisar, texto). "Hoy" es el día
  de Colombia.
- **Panel** (`PanelFlujo`): ⬇ PDF del flujo, papelera = desactivar (con
  confirmación; regla 3: nada se borra), ⋮ (Editar, Revisar permisos de
  Trimble, Activar, Desactivar…); bloques plegables Detalles, Archivos (chips
  Me toca / Todos / Subidos por mí; decidir aquí), Quién hace qué + Permisos
  (administradores), Historial (últimas 15) y Comentarios.
- **Datos nuevos** (SQL reejecutable): `aprobacion_flujos.vence date` y `notas
  text default ''`; tabla `aprobacion_comentarios` (identity, flujo, texto
  1–2000, usuario) **solo inserción** (`revoke update, delete`). `guardarFlujo`
  valida la fecha (`esDia`) y hasta 2000 caracteres de notas; el historial
  dice «Vencimiento: X (antes Y).» y «Cambió las notas.». `comentar`: cualquier
  miembro. Ruta `GET|POST /api/flujo-aprobacion/comentarios`.
- `EditorFlujo` (desde el 10-11-2026 es un cuadro flotante, ya no `enPanel`); tras crear, abre el flujo nuevo buscándolo por
  `hitoClave`. Se borró `Flujos.tsx` (lo reemplazan `ListaFlujos` + `PanelFlujo`).

## Archivos elegidos y responsable por paso (09-11-2026)

El dueño pidió (con capturas del formulario): "1. solo el usuario que va a
crear nuevo flujo puede definir que archivo o archivos seleccionar, y requiero
que salga multiple seleccion"; "2. el usuario que crea el flujo NO coloca
carpeta destino. puede colocar los pasos y seleccionar un responsable"; "3. el
usuario responsable es quien decide que hacer con el flujo [...] poner la
version del archivo en una carpeta la cual previamente debe tener acceso o
autorizacion del sistema". Le presenté el plan en dos fases con 4 preguntas y
respondió "Sí, fase A" (= mis recomendaciones):

1. **Cualquier miembro crea**; cambian el flujo (archivos, pasos,
   responsables, activar/desactivar, permisos) **quien lo creó**
   (`creadoPorId`) **y los administradores** (`puedeCambiar`). Flujos viejos sin
   `creado_por_id`: solo administradores.
2. **Solo archivos**, sin carpetas: un archivo nuevo no entra solo.
3. (Fase B) "autorización del sistema" = **acceso completo en Trimble** a la
   carpeta (la extensión lo revisa y Trimble lo exige).
4. (Fase B) Decide el **responsable del último paso**.

Contradicción señalada y resuelta: la especificación inicial decía papeles
"por carpeta o por archivo"; ahora hay **un responsable por paso para todo el
flujo**. Se quitaron «Quién hace qué», Realiza/Consulta como asignaciones,
`agregarAsignaciones`/`quitarAsignacion`, sus rutas y `Asignaciones.tsx` (la
tabla `aprobacion_asignaciones` se conserva, sin uso). Otra: el aprobador no
podrá elegir la carpeta donde ya está el archivo (Trimble lo tomaría como
versión nueva del mismo archivo; para la fase B).

Fase A (hecha el 09-11-2026):

- `Flujo.archivos` (jsonb `{ id, ruta, ancestros }`, 1 a `MAX_ARCHIVOS` = 100),
  `creadoPorId`, `destino: CarpetaFlujo | null` (solo flujos viejos);
  `carpetas` queda solo en flujos viejos (sin uso para detectar). `PasoFlujo`
  ganó `responsable?: { tipo, id, nombre }` (dentro de `pasos`, sin columna
  nueva). El servidor toma el nombre del equipo de Trimble (`conResponsables`):
  una persona retirada o un grupo borrado se rechaza.
- `responsablesArchivo(a, flujo)`: el responsable del paso en el flujo **como
  está ahora** (cambiarlo alcanza a los archivos en trámite) y, si el flujo ya
  no tiene ese paso, el de la copia de pasos del archivo. `meToca` recibe
  `Responsable[]`; `puedeDecidir(a, flujo, quien)`; `avisosRevision(archivos,
  flujo, enlace)`; `avisarRevision(ctx, flujo, archivos, momento)`.
- `recorrido.ts` ahora es `leerArchivos`: agrupa por la carpeta donde se vio
  cada archivo (la del registro si ya está registrado), **una consulta por
  carpeta**; lo que no está ahí se busca con `tc.archivo` (`getFileDetails`,
  ruta y padre) y se lista su carpeta nueva; 404 → `borrados`, otro error →
  `fallidos` (lectura incompleta); tope de 50 s.
- `revisarFlujo`: `planRegistro` igual que antes; faltantes: **quitado del
  flujo → retirado al momento** (cualquiera, es configuración); 404 → retirado
  solo en la revisión de un administrador; el resto "no apareció".
- `guardarFlujo`: valida, lee de Trimble solo los archivos nuevos, revisa
  `conflictosArchivos` (un archivo en un solo flujo activo), guarda y **llama a
  `revisarFlujo` en la misma petición** (registra y avisa); devuelve `mensaje`.
  Ruta `POST /flujos` con `maxDuration = 120`. `tc.archivo` rechaza un archivo
  cuya ruta no pasa por la raíz del proyecto.
- `cambiosFlujo` anota responsables ("Responsable de «Revisa»: Luz (antes
  …)"), archivos agregados y quitados. `permisosFlujo`: ACL de las carpetas
  donde están los archivos (hasta 20) + destino viejo; avisos: paso sin
  responsable, responsable sin acceso; los de destino solo en flujos viejos.
- `trasladar` exige `flujo.destino` (`sin-destino`); `decidir` solo copia si el
  flujo tiene destino. Un flujo nuevo aprobado queda donde está hasta la fase B.
- SQL (reejecutable, probado en PGlite desde el SQL anterior con datos):
  columnas `archivos`, `creado_por_id`, `destino` sin `not null`, *trigger*
  `aprobacion_revisar_archivos` (`archivo-en-otro-flujo`, mismo candado por
  proyecto) y un `update` que da a los flujos viejos sus archivos registrados
  no retirados (solo si `archivos = []` y tenían carpetas).
- Pantallas: `EditorFlujo` (explorador en modo archivo con casillas y
  «Marcar todos» — prop nueva `onElegirVarios` del `Explorador` de Publicar —,
  chips con ✕, pasos con selector Responsable; el equipo se lee al abrir el
  formulario), `PanelFlujo` (Pasos y responsables; bloque «Permisos de
  Trimble» para quien puede cambiar), `ListaFlujos(puedeEditar)`, **Nuevo para
  todos**.
- Pruebas: `flujos`, `registro`, `decision`, `lista`, `permisos`, `recorrido`
  (leerArchivos), `service`, `revision`, `decisiones`, `trasladar` (este crea
  el flujo y le pone carpeta y destino con `store.actualizarFlujo`, como uno
  viejo).

Fase B (el dueño dijo "Sí, fase B", hecha el 09-11-2026; sin cambios de SQL):

- `decidir` acepta `destino` (id de carpeta) solo al aprobar el **último paso**
  de un flujo **sin destino**; `carpetaElegida` (en `trasladar.ts`) lo revisa
  **antes** de decidir: id válido, carpeta del proyecto (`tc.carpeta`), **no
  de solo lectura** según `permission` de `GET /folders/{id}` (el permiso del
  propio usuario que da Trimble; `null` = Trimble no dijo: se deja intentar y
  Trimble decide en la copia) y `chocaConRevision` (no la carpeta del archivo;
  no donde un archivo con el mismo nombre, sin distinguir mayúsculas, va por un
  flujo **activo** y no retirado). Si falla, no se aprueba nada.
- El detalle de la línea `aprobado` agrega «Eligió ponerla en «ruta».». Luego
  `trasladar(ctx, id, { carpetaId })`: copia directa a la carpeta (sin
  `carpetaDeRevision` ni subcarpetas), con la misma lógica de `situacionDestino`
  (nuevo / versión nueva con `If-Match` / diferencia → «Reemplazar ahí»).
  Sin `carpetaId` usa `traslado.carpetaId` (reintento o reemplazo); sin
  ninguna → `sin-carpeta`. Texto del traslado: «Puso la versión N aprobada en
  «ruta», la carpeta que eligió: versión M ahí (copia dentro de Trimble).»
  (los flujos viejos conservan «Copió … en el destino …»).
- `textoTraslado` dice la carpeta («En «ruta»: versión 2 (fecha, quién)»);
  sin `carpetaRuta`, «la carpeta destino».
- Pantalla `Archivos`: `Decision` con «¿Qué hacer con la versión aprobada?»
  (Dejarla donde está / Ponerla también en una carpeta, explorador en modo
  carpeta, propone `traslado.carpetaId` de la versión anterior) y botón
  «Aprobar y poner en «carpeta»»; `PonerEnCarpeta` («Poner en una carpeta…» u
  «otra carpeta…» si la copia de esa versión falló o quedó en diferencia);
  «Copiar otra vez» y «Reemplazar ahí». `PanelFlujo` volvió a recibir
  `projectId` (el explorador lo pide).
- `puedeTrasladar` sigue igual (quien aprobó el último paso o un
  administrador); textos: «puede ponerlo en una carpeta», «Solo se copia una
  versión aprobada…».
- `nombreDeRuta` devuelve la ruta entera cuando no hay « / » (la carpeta raíz:
  antes salía «boratorio»; lo encontró la prueba en el navegador).
- Pruebas: `traslado.test.ts` (`chocaConRevision`, textos) y `trasladar.test.ts`
  (`escenario({ nuevo: true })`: copia a la carpeta elegida sin recrear
  subcarpetas, aprobar sin carpeta y después `trasladar` con `carpetaId`,
  carpeta propia / solo lectura / nombre en otro flujo sin decidir nada, v2 en
  la misma carpeta y diferencia en otra).

## Estado del documento y flujo cerrado (09-11-2026)

Pedido del dueño (con captura de la columna Estado): "1. configura para que
despues de tomar la desicion no se pueda editar, desactivar, activar; 2. en la
columna de estado que se muestre el estado del flujo del documento ejemplo: por
revisar, por aprobar, aprobado, rechazado, solo el aprobado verde y el rojo
rechazado, los otros en gris". Propuse el plan y dijo "Sí, hazlo así". Sin
cambios de SQL.

- **Estado del documento** (`lista.ts`): `estadoDocumento` por archivo:
  esperando un paso que no es el último = `por-revisar`; el último (o el único)
  = `por-aprobar`; `aprobado`, `rechazado`; retirado = no cuenta.
  `estadoDocumentos` por flujo, en este orden: rechazado si alguno (espera
  corrección) > por-revisar > por-aprobar > aprobado (solo si todos);
  `sin-archivos` si no hay ninguno. `detalleEstado` = la cuenta en palabras
  («1 rechazado, 2 por aprobar»), en el `title` y al lado en el panel.
  `FilaFlujo` ya no tiene `EstadoFila` (activo/vencido/desactivado): tiene
  `estado`, `detalleEstado`, `vencido` (la fecha se pinta de rojo) y `cierre`.
  Desactivado = etiqueta gris pequeña aparte; filtro Estado = los 4 estados +
  «desactivado» (`!activo`).
- **Flujo cerrado** desde la **primera decisión** de cualquier paso en
  cualquier archivo (no solo la del último paso: si se pudiera cambiar un
  responsable después de una firma, cambiaría quién firma lo que sigue, porque
  `responsablesArchivo` lee el responsable actual del flujo). Nadie edita,
  activa ni desactiva, **ni los administradores**. El flujo sigue revisando
  versiones nuevas, decidiendo, copiando a carpetas, comentando y con PDF;
  «Revisar permisos» sigue. Un flujo desactivado que luego tuvo una decisión
  (decidir no exige flujo activo) ya no se reactiva.
- La fuente es el **historial** (no el registro: las firmas se vacían con cada
  versión nueva y con «version-reemplazada»): `store.decisiones(proyecto)` =
  líneas `aprobado-paso | aprobado | rechazado` con `flujo_id` (solo `id,
  flujo_id, accion, creado, usuario`, paginado con `all`, orden `id.asc`);
  `primerasDecisiones` (en `flujos.ts`, con `ACCIONES_DECISION`) toma la más
  antigua por flujo → `Cierre { fecha, quien }`. `estado()` devuelve
  `cierres` (en cada carga: una consulta más); `exigirAbierto` en
  `guardarFlujo` (al editar, después de `exigirPermiso`) y `cambiarEstado`:
  409 `flujo-cerrado` con `textoCerrado` («…ya tiene decisiones (la primera el
  DD-MM-AAAA, de X): el flujo quedó cerrado…»).
- Pantalla: `ListaFlujos` (`ESTADO_DOCUMENTO`, `EtiquetaEstado` con `ayuda` y
  `desactivado`, `ayudaEstado`; ⋮ sin Editar/Activar/Desactivar si `cierre`),
  `PanelFlujo` (`editable = puede && !cierre`: ⋮, papelera y confirmación de
  desactivar; aviso gris «Flujo cerrado desde la primera decisión…»; «esperando
  decisión» en vez de «por revisar» en el dato Archivos), `FlujoAprobacionApp`
  (pasa `datos.cierres`; un panel «editar» de un flujo cerrado muestra los
  detalles; después de decidir vuelve a leer los flujos: lo encontró la prueba
  en el navegador, el aviso de cerrado no salía hasta recargar).
- Datos reales del 09-11-2026 (consulta de lectura): «aprobar torre 2»
  (CIRCUITOS TR1.rvt aprobado por Jaiden) y «flujo de aprobacion» (desactivado,
  Proyecto2.rvt aprobado) quedan cerrados; «aprobar diseño estructural» (3
  pendientes en su único paso) = Por aprobar, editable.
- Pruebas: `lista.test.ts` (estados por archivo y por flujo, filtros, cierre y
  `describirCierre` en día de Colombia) y `decisiones.test.ts` (después de la
  primera decisión nadie edita ni desactiva y sigue revisando versiones nuevas;
  un desactivado con decisión no se reactiva).

## Versión fija del flujo (10-11-2026)

Pedido del dueño: "cuando se hace el flujo nuevo, la versión del archivo debe
ser estática ejemplo si pepe en el flujo nuevo comparte la versión 4 y ese
documento se actualiza a versión 5, entonces el flujo debe conservar que el
documento del flujo es versión 4, pero sí debería aparecer un mensaje diciendo
que existe una nueva versión. para ayudar al usuario a tomar una decisión", con
captura de «CIRCUITOS TR2.rvt» (aprobado v1 en «aprobar torre 2», volvió a
«Nueva versión pendiente» con la v2). Propuse dos fases y 4 supuestos
(la versión nueva no entra sola, se revisa en un flujo nuevo; se decide la fija
aunque exista otra; se fija la que Trimble tiene al guardar; un archivo va a un
flujo nuevo solo cuando ya se decidió en el anterior). Dijo "Sí, fase 1".

Fase 1 (hecha; SQL: columna `version_nueva` + corrección única):

- `planRegistro`: con el mismo flujo y otra versión en Trimble, si el archivo
  no está retirado → acción `version-nueva-vista` con `cambios = { ruta,
  carpetaId, ancestros, versionNueva, actualizado }` (no toca versionId,
  revision, subido*, nombre, estado, pasoActual, firmas). Una sola vez por
  versión (`versionNueva.versionId`); otra más nueva la reemplaza; si Trimble
  vuelve a dar la versión del flujo, `versionNueva: null`. Retirado (vuelto a
  marcar) o desde otro flujo: nueva revisión con la versión de ahora (igual que
  antes). Ya no se producen `version-reemplazada` ni `nueva-version` (las filas
  viejas conservan esos estados; el resto del código los sigue manejando).
- `revisarFlujo`: la línea del historial va con quien subió la nueva
  (`versionNueva.subidoPor`), `ocurrido` = cuándo la subió y `version` = la
  nueva; no se manda tarea (`aAvisar` solo para version-reemplazada,
  nueva-version y archivo-cambio-flujo). Mensaje: «N versión nueva en Trimble
  (el flujo sigue con la versión que tiene: ver el aviso en el archivo)».
  `listarArchivos` agrega `enlaceNueva`.
- `decidir`: ya no lanza «En Trimble ya hay una versión más nueva» (409
  version-cambio); sigue rechazando si el `versionId` enviado no es el del
  registro. `tc.version` (con `catch` → null) solo sirve para anotar:
  detalle + «Ojo: en Trimble ya existe la versión N.» (N de `versionNueva` si
  coincide; si no se conoce, «una versión más nueva») y el mensaje termina en
  «Ojo: …; este flujo no la revisa.». La copia (`trasladar`) ya usaba
  `fromFileVersionId = versionAprobadaId` y `versionFija`: copia la aprobada.
- Pantalla: `AvisoVersionNueva` (ámbar: versión, nombre si cambió, quién y
  cuándo, «Ver la versión N») en la fila del archivo y en `Decision` (con
  «Tu decisión es sobre la versión 4…»); la carpeta de la fila sale de la ruta
  sin su última parte (el nombre puede ser el de la versión nueva);
  `ListaFlujos` «Versión nueva en Trimble» bajo el estado
  (`FilaFlujo.conVersionNueva`, sin retirados); `PanelFlujo` nota ámbar con la
  cuenta; `EditorFlujo` explica que queda fija la versión al guardar; textos
  de flujo cerrado y desactivar ya no dicen «revisa versiones nuevas».
- SQL de una sola vez: filas `nueva-version` con `version_aprobada_id` y
  versión distinta → `aprobado`, `version_nueva` = la versión que tenían,
  `version_id/revision` = la aprobada, `subido/subido_por/subido_por_id` desde
  la línea `archivo-detectado | version-reemplazada | nueva-version` del
  historial con esa versión (`firmas` queda vacío: las firmas de esa
  aprobación están en el historial). Probado en PGlite (dos veces + caso
  CIRCUITOS + una `nueva-version` sin aprobada que no se toca).
- Pruebas: registro (no reemplaza, aprobado/rechazado siguen, una vez por
  versión, se quita, retirado vuelve con la de ahora), revisión (aviso sin
  tarea, enlaces), decisiones (rechazo con corrección como aviso; decidir con
  versión más nueva sin y con número; admin que subió vía `actualizarArchivo`),
  trasladar (`revisionAnterior` simula una revisión de v2 empezada antes del
  10-11-2026; reintento de copia por quien aprobó con versión nueva), lista
  (`conVersionNueva`).

## Reactivar el flujo y cerrar las tareas de Trimble (10-11-2026)

Pedido del dueño (captura del aviso ámbar): "quiero que coloques la condición
donde si solo si el flujo arroja el mensaje «1 archivo tiene una versión más
nueva en Trimble…» el usuario creador tenga un botón de reactivar el flujo,
entonces de nuevo se active el flujo, se debe guardar toda la trazabilidad.
también que la tarea creada en trimble cambie a estado cerrado cuando el flujo
sea aprobado o rechazado". Propuse el plan con 4 supuestos (reactivan creador
y administradores; el flujo sigue cerrado para editar; un desactivado queda
activo; también entra la nueva de un archivo que esperaba decisión) y dijo
"Sí, las dos". Esto **reemplaza la fase 2** (no hay flujo nuevo por versión).
SQL: columna `tareas`.

- `reactivarFlujo` (`reactivar.ts`, ruta `POST /flujos/reactivar`):
  `puedeCambiar` (403), versión del flujo (409), exige filas no retiradas con
  `versionNueva` (409 `sin-version-nueva`); si estaba desactivado, revisa
  `conflictosArchivos` y lo activa; corre `revisarFlujo` (con `catch`) para
  tomar la versión más reciente; `planReactivar` (registro.ts): por fila con
  `versionNueva` distinta → `estado: nueva-version`, versión/subido* de la
  nueva, nombre y tipo de la nueva, `pasos` del flujo, `pasoActual 0`,
  `firmas []`, `versionNueva null` (conserva `versionAprobadaId` y
  `traslado`); se aplica con `decidirArchivo` (optimista). Historial:
  `flujo-reactivado` + `version-reactivada` por archivo (detalle con
  «quedó aprobada / rechazada / no se decidió»). `avisarRevision` (tarea al
  primer paso) y `cerrarTareas`. NO pasa por `exigirAbierto`: es la única
  acción permitida en un flujo cerrado además de decidir.
- Tareas: `Aviso.tipo` (revision | correccion) y `pasoId`; `notificar(…,
  filas)` → `guardarTareas` añade `TareaTrimble { id, tipo, pasoId,
  versionId, titulo, creada }` a cada fila (best effort). `cerrarTareas(ctx,
  cambiadas)`: lee todas las filas, `tareasPorCerrar` = tareas abiertas de las
  filas cambiadas que ninguna fila con esa tarea `sigueEsperando` (revision:
  ESPERANDO + mismo paso + misma versión; correccion: `rechazado` + misma
  versión) → `cerrarTarea` (avisos.ts: `PATCH /todos/{id}` con `{ status:
  "CLOSED" }` y si no `"DONE"`; 401/403/404 cortan; una respuesta con otro
  `status` no cuenta) → marca `cerrada`/`cierre` en cada fila e historial
  `tarea-cerrada` | `tarea-no-cerrada`. Se llama al final de `decidir` y de
  `reactivarFlujo`. `TrimbleFlujo.actualizarTarea?` (opcional: sin él no se
  cierra nada); en `routes.ts` es un `fetch` PATCH propio (`ClienteTrimble`
  de Compras solo tiene GET/POST: no se tocó Compras).
- Los estados de cierre **no están confirmados en Trimble real**: la prueba de
  conexión (paso tarea) ahora intenta cerrar la tarea de prueba y la relee
  (`cierre`, `estadoTarea`, `estadoCerrada` en PruebaFase0).
- Pantalla: `PanelFlujo` (botón en el aviso ámbar y en ⋮ si `puede` y
  `conVersionNueva > 0`; confirmación con la lista de lo que entra;
  `pedirReactivar` desde la lista), `ListaFlujos` (⋮ «Reactivar el flujo…»),
  `FlujoAprobacionApp` (`Panel.reactivar`).
- Pruebas: `tareas.test.ts` (sigueEsperando, tareasPorCerrar con tarea de
  varios archivos, cerrarTarea CLOSED→DONE/403/otro estado/error) y
  `reactivar.test.ts` (cierre al decidir y rechazo con corrección abierta;
  403 no bloquea; reactivar aprobado por el creador y no por otro, historial
  completo, sigue cerrado y v2 avanza; rechazado cierra «Corregir»;
  desactivado queda activo y la tarea de v1 se cierra).

Fase 2 (descartada: el dueño eligió reactivar el mismo flujo): «Crear flujo con la versión N» (Nuevo con ese
archivo y los mismos pasos y responsables); un archivo en varios flujos, uno
por versión (registro único por `flujo_id, file_id` en vez de `proyecto,
file_id`; quitar `archivo-cambio-flujo`); regla: entra a un flujo nuevo solo si
en los otros ya está decidido (cambiar `conflictosArchivos`, el trigger
`aprobacion_revisar_archivos` y el `revisar` del memoryStore); trazabilidad
por flujo y versión; proponer la carpeta de la copia anterior aunque sea otra
fila. Sin la fase 2, una versión nueva no se puede revisar (el archivo queda
en su flujo cerrado).

Cerrar tareas **funciona en Trimble real**: `PATCH /todos/{id}` con
`{ status: "CLOSED" }` dejó «Cerrada» las tareas de «CARGAR ARCHIVO» y
«prueeba de cerrar tarea» (captura del dueño, 11-11-2026; historial
`tarea-cerrada`). La prueba de conexión había releído al instante y vio «NEW»
(Trimble tarda): ahora espera `ESPERA_RELEER_MS` = 4000 (`deps.esperar`).
Swagger de Trimble: `UpdateToDoRequest` = `type, title, label, description,
dueDate, percentComplete, status, priority, assignees`; estados `NEW,
IN_PROGRESS, RESOLVED, BLOCKED, CLOSED`; `type` es una lista fija `Fault,
Clash, Request, Inquiry, Remark, Comment, Issue, Solution`; `label` = «Unique
label for the ToDo within a project» (ej. PROJ-21); `dueDate` ISO 8601 (ej.
`2015-05-21T00:00:00+0000`); en `POST /todos` son obligatorios `description` y
`projectId`.

## Cuadro flotante para crear y editar (10-11-2026)

Pedido con un dibujo sobre el cuadro de tareas de Trimble: **Nuevo** oscurece la
pantalla y abre un cuadro blanco flotante. Aceptado **sin «Usuario asignado»
general** (ya hay responsable por paso). `EditorFlujo` es ahora el cuadro
(fondo `rgba(20,30,45,.45)`, zIndex 55): «Crear flujo»/«Editar «hito»» + ✕;
Título (vacío → borde rojo y «Se requiere este campo.»), Descripción (= `notas`;
textos «La descripción admite…», «Cambió la descripción.»), Fecha de vencimiento
con `DateField` de propiedades (DD-MM-AAAA → ISO), Archivos y Agregar pasos
(sin textos de ayuda: pasaron a `title` por pedido del dueño); pie fijo con Cancelar/Guardar (pálido si hay
`problema`). Clic afuera no cierra; con cambios (`huella` vs. la inicial), ✕,
Cancelar y Escape piden «¿Cerrar sin guardar?». `FlujoAprobacionApp`:
`ventanaEditor` para Nuevo y Editar; el panel ya no muestra el formulario
(en Editar queda el detalle detrás). «+ Agregar archivos» abre
`ElegirArchivos` (cuadro «Añadir archivos» al estilo «Añadir referencias» de
Trimble, zIndex 60): `api.carpeta`, migas con el nombre del proyecto en la raíz
y «‹», carpetas con «›», archivos con casilla y versión, «Marcar todos»; marcas
conservadas entre carpetas; los ya elegidos salen marcados y deshabilitados;
`maximo` = MAX_ARCHIVOS − elegidos; ruta `carpeta.ruta.join(" / ") + nombre`
(igual que el Explorador). Escape cierra solo ese cuadro (`EditorFlujo` ignora
Escape mientras `eligiendo`). El `Explorador` de Publicar ya no se usa aquí.

## Panel más limpio (11-11-2026)

Pedido con capturas («ocultar textos»): lo quitado pasa a `title`, nada se
borra. `PanelFlujo`: el recuadro «Flujo cerrado…» es ahora una etiqueta
«Cerrado» con el texto en `title`; el bloque «Permisos de Trimble» solo se
monta tras ⋮ → «Revisar permisos de Trimble» (`conPermisos`). `Archivos`:
carpeta y «Subió» en el `title` del nombre (`ayudaArchivo`); firmas y la copia
«hecho» en el `title` de la etiqueta de estado (`ayudaEstado`); `EstadoTraslado`
solo se ve si la copia no está `hecho` (tiene botones); columna Espera solo si
alguna fila visible espera o está rechazada (`conEspera`), la de acciones solo
con Decidir/Poner en carpeta (`conAcciones`), `colSpan={columnas}`. Se quitó el
historial por archivo (`verHistorial`, `api.historial(undefined, id)` ya no se
usa aquí): el bloque Historial del flujo lo tiene.

## Código del flujo y texto de las tareas (11-11-2026)

Pedido con captura de ToDo de Trimble; aceptado el plan. Columna
`aprobacion_flujos.codigo` (int): trigger `aprobacion_codigo_flujo` (before
insert, `pg_advisory_xact_lock(hashtext('aprobacion-codigo:'||proyecto))`,
max+1), índice único `(proyecto, codigo)`, relleno de los existentes por
`creado, id` después del máximo (re-ejecutable). `memoryStore.crearFlujo` hace
lo mismo. `codigoFlujo(n)` → «FLUJO-01» (2 dígitos mínimo). Se ve en
`ListaFlujos` (arriba del nombre), `PanelFlujo` (arriba del título), PDF
(`trazabilidad` arma `hitos` como «FLUJO-01 · hito») y el buscador (`filtrarFilas`
compara sin guiones ni espacios). Tarea: `Aviso.trimble = textosTarea(flujo)` =
`{ label: código, title: hito, description: notas || hito, dueDate:
`${vence}T17:00:00+0000` }`; `Aviso.titulo`/`descripcion` siguen como resumen
para el historial y como último respaldo. `variantesTarea`: por cada etiqueta
[código, código-n] × tipo [«Flujo de aprobación», «Request», sin tipo] con
fecha; luego sin tipo ni fecha; luego el formato de antes. `enviarAviso` sigue
solo con 400/409/422 y devuelve `etiqueta`; `notificar` calcula
`otraEtiqueta` = código-(tareas distintas del flujo + 1) y `guardarTareas`
guarda `TareaTrimble.etiqueta`; el historial dice «Tarea de Trimble FLUJO-01
para…» y «Cerró la tarea de Trimble FLUJO-01 «…»». Falta confirmar en Trimble
real si acepta el tipo propio y etiquetas repetidas (la prueba de conexión lo
dice). Lista: `filasFlujos` ordena por `codigo` descendente (sin código al
final, por nombre; ya no pone primero los activos) y `opcionesFiltro` ya no
devuelve `grupos`: se quitó el filtro Grupos (`filtro.quien` con «grupo:» sigue
funcionando por dentro). **Decidir** (11-11-2026, pedido del dueño): solo el
responsable del paso o su grupo; `puedeDecidir` (decision.ts) ya no deja al
administrador salvo que el paso no tenga responsable (`comoAdmin` solo ahí);
en `Archivos.tsx`, `puedeDecidir` = `meToca || (esAdmin && !responsables.length
&& no subió)`. `meToca` nunca incluyó a los administradores. La «Prueba de
conexión con Trimble» está **oculta** (11-11-2026, el dueño: ya no es necesaria):
se quitó del ⋮ de `FlujoAprobacionApp` (opción, `Modal` e import); `PruebaFase0.tsx`,
`prueba.ts` y la ruta `prueba` siguen en el código para volver a mostrarla.
También se ocultó «Revisar permisos de Trimble» del ⋮ de `PanelFlujo` (se quitó
el bloque Permisos, `conPermisos`, `permisosRef`; `Permisos.tsx` sigue).
Tablero (11-11-2026): `resumenTablero(filas, archivos)` en `lista.ts` (flujos,
activos y, por estado, `{ flujos, archivos }`, de todas las filas sin filtrar) y
`Tablero.tsx` con 4 tarjetas (Flujos, Por revisar, Por aprobar, Aprobados) que
fijan `filtro.estado` al hacer clic (otro clic lo quita). `RevisionCarpetas`
sin novedades es una línea fina con «Revisar ahora»; con cambios o errores, el
`Notice` de antes.
«Abrió el archivo» (11-11-2026, aceptado «solo a quien recibió el aviso»):
`apertura.ts` (`planApertura`, `registrarApertura`, `lapso`), ruta `POST
/api/flujo-aprobacion/abierto` (`{ archivoId }` → `{ anotado }`), `api.abierto`;
`Archivos.tsx` llama `onAbierto` en el clic del nombre y de «Ábrela en Trimble»
(sin esperar; si `anotado`, `onCambio()` recarga el historial). Se anota si
quien abre es responsable del paso que espera (persona o miembro del grupo) o
quien subió una versión rechazada; una vez por persona y `version` (busca
`archivo-abierto` en el historial del archivo); la tarea que lo avisó sale de
`a.tareas` (misma versión y paso, o `correccion`). Acción `archivo-abierto` =
«Abrió el archivo» en `ACCIONES` (sale en el PDF). Trimble no registra
aperturas en su visor: su `POST /activities/list` solo trae `FILE_DOWNLOAD` (no
hay FILE_VIEW); leer esas descargas sería una fase aparte si el dueño la pide.
Correos propios (11-11-2026, pedido «que no sea la notificación de tareas»;
plan en fases, fase 1 hecha con su «Sí, listo» tras poner las variables):
`correo.ts` + `smtp.ts` (nodemailer 10.2.1 exacto, Gmail
`smtp.gmail.com:465`, variables `FLUJO_CORREO_USUARIO`, `FLUJO_CORREO_CLAVE`,
`FLUJO_CORREO_NOMBRE`, `FLUJO_EXTENSION_ID`; sin las dos primeras `ctx.correo`
queda `undefined` y no sale nada ni se anota). `notificar` manda el correo
después de cada tarea (aunque la tarea falle), a cada persona y miembro de
grupo por separado (máx. 25 por aviso), y anota `correo-enviado` /
`correo-fallido`; con EAUTH no sigue intentando. El botón usa
`enlaceExtension`: `/projects/<id>/extension/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e/flujo_aprobacion_open`
(dirección que pegó el dueño; el id NO es MD5 del manifiesto, puede cambiar por
proyecto). El dueño confirmó que el correo de prueba llega (11-11-2026) y
aprobó la fase 2 («sigue con la fase 2»): ⋮ → «Correos de aviso…» (solo
admins; `ConfigCorreos.tsx`, `GET/POST /correos`), configuración por proyecto
en la tabla `aprobacion_config_correo` (`datos` jsonb + `version`; el dueño
debe reejecutar el SQL). `configCorreo.ts` es puro (lo usa la vista previa):
`activo`, `tareasTrimble` (apagada = no se crea la tarea ni su correo),
`eventos.revision/correccion`, `textos` (asunto + intro con `{codigo}`
`{flujo}` `{paso}` `{archivo}` `{version}` `{vence}` `{proyecto}` `{persona}`
`{quien}`), `copia` (máx. 5, una copia por aviso en CC del primer correo),
`idExtension` (de la dirección pegada; debe ser del mismo proyecto). Reglas:
no se apaga la tarea con los correos apagados ni sin cuenta de Gmail; sin
tarea ni correo se anota `aviso-fallido` «No se avisó…». `configDe` nunca
falla (sin fila o sin tabla = inicial). «Enviar correo de prueba» quedó dentro
de la ventana y usa los textos guardados con `datosEjemplo` (FLUJO-00).
Fase 3 (12-11-2026, «sigue con la fase 3, y ocultas la pestaña de correo de
aviso»): la opción «Correos de aviso…» quedó `oculto: true` en el ⋮ (config de
SELVIA guardada: correos sí, tareas no). `enlaces.ts`: cada correo lleva un
enlace por persona (`aprobacion_enlaces_correo`, token base64url de 24 bytes,
60 días); `GET /ir/[token]` es pública (sin `handle`): marca `abierto` y
redirige a `enlaceExtension` del proyecto; al cargar, la app llama
`POST /pendiente` → `tomarPendiente` (clic de esa misma persona en los últimos
`MINUTOS_CLIC`=20, `usado` una sola vez) y abre el panel del flujo; anota
`entro-desde-correo`. `ctx.origen` = `urlPublica(req.nextUrl.origin)`
(`FLUJO_URL_PUBLICA`); sin origen o sin tabla, botón de antes.
`recordatorios.ts` + cron `0 12 * * *` (7:00 Colombia; tercer cron de
vercel.json): flujos activos con `vence < hoy`, archivos en `ESPERANDO`,
destinatarios = enlaces `tipo=revision` del mismo archivo y `pasoId` (correo
guardado; pasos avisados antes de la fase 3 no se recuerdan), uno por persona y
proyecto, `recordado` evita repetir el día, `recordatorio-enviado/fallido`
con usuario «Recordatorio automático». Config `recordatorios` (inicial true). Solo si el dueño lo pide: revisión diaria con cuenta conectada,
avance del hito, avisar por tarea cuando un flujo vence, poner una misma
versión aprobada en varias carpetas (hoy, una por versión).
