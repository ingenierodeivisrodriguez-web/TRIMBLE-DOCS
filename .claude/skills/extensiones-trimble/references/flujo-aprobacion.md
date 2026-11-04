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
2. Detección y registro (al abrir y «Revisar ahora»), estados, mensaje de
   versión nueva, bandeja «Por revisar» y «Mis archivos».
3. Revisión: aprobar por pasos, rechazar con motivo, avisos (bandeja + ToDo),
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
