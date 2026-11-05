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
9. **Quien sube no aprueba** su propio archivo.
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
4. Traslado: copia automática de la última versión con la sesión de quien
   aprobó; reintento por el aprobador o un administrador si falla.
5. Trazabilidad por archivo y general, filtros, PDF, README, guía y protocolo.

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
