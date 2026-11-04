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

0. **Prueba en Trimble real** (código en `main`; falta que el dueño la corra y
   pegue el resumen). Sin Supabase.
1. Configuración: SQL `supabase/flujo-aprobacion.sql`, flujos con su hito,
   carpetas de revisión (selección múltiple) y destino, pasos + / −, personas y
   grupos por carpeta o archivo, revisión de permisos.
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

Lo que falta saber de la fase 0: ruta y forma de las versiones, si el enlace
abre el archivo, si la copia dentro del mismo proyecto evita la reconversión,
el formato de ToDo que acepta Trimble, si adjunta el archivo, si asigna a
grupos y si manda correo.
