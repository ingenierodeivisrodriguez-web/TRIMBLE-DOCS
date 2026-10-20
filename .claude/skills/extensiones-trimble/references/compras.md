# Compras y Contratación

## Contenido
1. Qué es y estado
2. Restricciones del dueño (seguridad y datos)
3. Decisiones aprobadas
4. Archivos y capas
5. Accesos: permisos y roles
6. Flujo y estados de cada registro
7. Reglas críticas y dónde se hacen cumplir
8. Documentos en el CDE (Trimble Connect)
9. PDF reproducibles y Excel
10. Panel y trazabilidad
11. SQL: patrones y cómo probarlo
12. Pendientes

## 1. Qué es y estado

Extensión del **menú del proyecto** (sin panel del visor): `/compras`,
`public/manifest-compras.json`, `public/icon-compras.svg`, `app/compras/`.
Abastecimiento a partir de los insumos de Presupuesto: requisiciones →
cotizaciones y comparativo → órdenes de compra y contratos → recepción en obra,
con documentos en el CDE del proyecto, accesos por rol, auditoría y un panel.

Se construyó en 8 fases (octubre 2026), una por commit "Compras: … (fase N)":
0–1 accesos y auditoría, 2 insumos, 3 requisiciones, 4 proveedores y
cotizaciones, 5 órdenes y contratos, (prueba de escritura en el CDE), 6
documentos en el CDE, 7 recepción en obra, 8 panel y trazabilidad. El README
tiene la sección "Compras y Contratación (proyecto)" con todo el detalle (una
subsección por fase, esquema, API y códigos de error).

Pestañas de `components/compras/ComprasApp.tsx`: Inicio, Panel, Insumos del
presupuesto, Requisiciones, Cotizaciones, Órdenes y contratos, Recepción en
obra, Proveedores, Documentos (CDE), Accesos y roles, Auditoría. Cada pestaña
aparece solo con su permiso `*.ver`.

## 2. Restricciones del dueño (seguridad y datos)

Siguen vigentes; vienen del encargo original y no se discuten:

- Supabase guarda **solo datos estructurados** y referencias a los archivos del
  CDE (id del archivo y de su versión en Trimble, carpeta, estado de
  sincronización). **Ningún binario** en PostgreSQL ni en Supabase Storage.
- **Presupuesto es la única fuente** de insumos, cantidades y precios
  planificados. Compras **lee y nunca escribe** en `presupuesto_*`
  (`lib/compras/presupuestoLectura.ts` solo hace GET; una prueba lo verifica).
  No toques permisos, tablas ni archivos de Presupuesto sin preguntar.
- **Sin autorización vigente, nadie entra**: ser miembro del proyecto en
  Trimble no basta.
- Identidad = usuario de Trimble validado en el servidor. **No hay Supabase
  Auth**, ni se usa el token de Trimble como token de Supabase.
- **El navegador nunca habla con Supabase**: todo pasa por `app/api/compras/**`
  con la clave de servicio en el servidor.
- **RLS activado sin políticas** en todas las tablas; permisos por usuario, rol,
  proyecto y acción en el servicio en cada operación, y las reglas críticas
  también en PostgreSQL (funciones, restricciones, triggers). Si conviene otro
  esquema, **proponerlo y justificarlo; no implementarlo sin OK**.
- **Ningún enlace público** a documentos: el acceso a archivos va siempre por la
  API de Trimble con los permisos del usuario.
- Un registro **no aparece "respaldado" hasta que Trimble confirme la carga**.
- **Esperar el OK antes de escribir código o ejecutar migraciones**. El dueño
  ejecuta `supabase/compras.sql` en el SQL Editor; Claude solo lo prueba con
  PGlite y solo hace consultas de lectura al proyecto Supabase
  (`fdjilgddqlqrvyqzvcck`).

## 3. Decisiones aprobadas

El dueño aceptó estas respuestas a las dudas del plan (también en la memoria
`compras-decisiones.md`):

1. El límite de cantidad es **por insumo en todo el proyecto** (la partida es
   referencia opcional). Un insumo se identifica por su clave en
   `presupuesto_documentos.data.insumos`.
2. Tolerancia sobre lo planificado **0 % configurable**; pasarse exige
   justificación por línea y el permiso `requisiciones.exceder`.
3. Se compran MT y EQ por **orden**; SC y MO por **contrato**; los insumos en %
   no se compran.
4. Proveedores **por proyecto**.
5. **Un rol** por persona y proyecto.
6. **Quien elabora no aprueba**: requisiciones, comparativos, órdenes y
   recepciones los decide otra persona (`auto-aprobacion`).
7. Sin topes de aprobación por monto.
8. Solo **IVA** (sin retenciones).
9. Subir a `main` al terminar cada fase.

## 4. Archivos y capas

Mismas capas que Presupuesto: `app/api/compras/**/route.ts` → `lib/compras/routes.ts`
(`handle`) → `service.ts` (reglas y permisos) → `store.ts` (PostgREST con la clave
de servicio, o `memoryStore()` en pruebas con las **mismas reglas** que el SQL) →
`supabase/compras.sql`. `client.ts` es la `ComprasApi` del navegador.

| `lib/compras/` | Qué tiene |
|---|---|
| `types.ts` | Todos los tipos, `MODULOS`, `ACCIONES_POR_MODULO`, `PERMISOS_VALIDOS` (43), respuestas de la API |
| `accesos.ts` | `MotivoRechazo`, `MENSAJES`, `ESTADO_HTTP`, vigencia de accesos, `tiene()`, reglas de asignar roles |
| `roles.ts` | Los 9 roles iniciales |
| `validate.ts` | `leer*`: valida todo lo que llega del navegador |
| `planificado.ts`, `presupuestoLectura.ts` | Insumos planificados desde Presupuesto (`listaInsumos`, metrado del modelo), solo lectura |
| `requisiciones.ts`, `proveedores.ts` (NIT y dígito DIAN), `cotizaciones.ts` (totales, puntajes), `ordenes.ts`, `recepciones.ts`, `panel.ts` | Reglas puras de cada fase (`revisar*` devuelve el motivo de rechazo o null) |
| `cde.ts` | Cliente de la API Core 2.0 de Trimble (carpetas, subidas, descarga) |
| `documentos.ts` | Carpetas, nombres de archivo, tipos legales, vencimientos, expediente |
| `subida.ts` | Lado del navegador: huella SHA-256, copia local en IndexedDB, envío y confirmación |
| `pdfOrden.ts`, `pdfRecepcion.ts`, `excelPanel.ts` | PDF de la orden y del acta; libro de Excel del panel |
| `formato.ts` | Fechas, textos de la auditoría (`nombreAccion`, `detalleEntrada`) |
| `pruebas/trimbleFalso.ts` | Trimble Connect falso que se comporta como su API (pruebas y página temporal) |

Componentes en `components/compras/`: una pantalla por pestaña (`Requisiciones`,
`Cotizaciones` + `ComparativoDialog`, `Ordenes`, `Recepciones`, `Proveedores`,
`DocumentosCde`, `Panel`, `Accesos`, `Auditoria`, `Insumos`), `RequisicionDialog`,
`DocumentosRegistro` (sección de documentos reutilizable dentro de cada
registro), `PruebaCde` y `estilos.ts`. Reutilizan `ui.tsx` de Presupuesto
(`Modal`, `Notice`, `NumInput`, `C`…) y `DateField` de Propiedades.

Patrón de cada pestaña: `cargar()` con `useCallback`, `onSinAcceso(err)` para
volver a la pantalla de acceso si revocan el permiso, diálogo con `key` =
`id:version` para recargar tras guardar, botones según `puedeAccion*()` y
`MotivoDialog` para devolver o anular.

## 5. Accesos: permisos y roles

- Matriz módulo × acción: `accesos`, `auditoria`, `insumos`, `requisiciones`
  (incluye `exceder`), `proveedores`, `cotizaciones`, `ordenes`, `contratos`,
  `documentos` (ver, administrar), `recepciones`, `panel`. Acciones: ver, crear,
  editar, aprobar, anular, documentos, administrar. La lista válida está también
  en SQL (`compras_permisos_validos()`); una prueba verifica que coinciden. Si se
  agrega un permiso, el rol administrador lo recibe al re-ejecutar el SQL.
- 9 roles iniciales al activar: Administrador de plataforma (todo, no editable),
  Director, Residente, Compras, Presupuesto y costos, Jurídica, Almacén,
  Finanzas, Auditor.
- Activación: un **administrador del proyecto en Trimble** pulsa "Activar
  Compras" si no hay administrador de Compras; queda como Administrador de
  plataforma. Nadie modifica su propia fila; solo se dan permisos que uno tiene;
  siempre queda un administrador vigente sin fecha final.
- Auditoría de solo inserción (trigger `compras_auditoria_inmutable`): toda
  operación, **también las denegadas** (`denegar()` en el servicio), deja fila.
  Cada acción nueva necesita su texto en `formato.ts` (`ACCIONES_AUDITORIA` y
  `detalleEntrada`) con su prueba en `formato.test.ts`.

## 6. Flujo y estados de cada registro

| Registro | Número | Estados |
|---|---|---|
| Requisición | REQ-0001 | borrador → enviada → aprobada / rechazada; devuelta = borrador; anulada (no con órdenes vigentes) |
| Cotización | COT-0001 | registrada / anulada (una registrada por proveedor y requisición) |
| Comparativo | (por requisición) | borrador → propuesto → aprobado; devuelto = borrador |
| Orden / contrato | OC-0001 / CT-0001 | borrador → enviada → aprobada (emitida); modificar = borrador con revisión + 1 (copia en `compras_orden_revisiones`); anulada |
| Recepción | REC-0001 | borrador → enviada → aprobada; devuelta = borrador; anulada |
| Documento | — | pendiente → respaldado (o error); anulado |

Todos con **versión optimista** (409 `version-conflict`); devolver y anular piden
motivo; nada se borra.

## 7. Reglas críticas y dónde se hacen cumplir

Cada una en tres sitios: regla pura en `lib/compras/*.ts` (y `memoryStore`),
función SQL bajo `pg_advisory_xact_lock` por proyecto, y trigger diferido que
la revisa aunque alguien escriba directo en la tabla.

- **No pedir más que el presupuesto**: lo solicitado por insumo ≤ planificado +
  tolerancia (el servidor calcula el límite y lo pasa a la función SQL).
- **No comprometer dos veces**: lo ordenado de una línea de requisición (órdenes
  y contratos no anulados, borradores incluidos) ≤ aprobado y ≤ cotizado
  (`compras_comprometido` + trigger `compras_orden_lineas_sin_doble`). En la
  revisión 0 los precios son los de la cotización elegida.
- **No recibir de más**: aceptado + rechazado = recibido; devuelto ≤ rechazado;
  rechazo con motivo; lo aceptado de una línea de la orden (recepciones no
  anuladas, borradores incluidos) ≤ ordenado (`compras_recibido` + triggers
  `compras_recepcion_lineas_sin_exceso`, `compras_recepciones_sin_exceso`). Solo
  contra órdenes emitidas.
- **La orden respeta lo recibido**: no se anula con recepciones vigentes
  (`con-recepciones`, también trigger `compras_ordenes_con_recepciones`) y una
  modificación no baja ni quita una línea por debajo de lo aceptado
  (`bajo-lo-recibido`, trigger `compras_orden_lineas_sobre_lo_recibido`).
- Recepciones y órdenes usan **el mismo bloqueo** (`compras-ordenes:<proyecto>`)
  para no cruzarse. Las líneas de recepción se ligan por
  `requisicion_linea_id` (estable), porque las líneas de la orden se borran y
  recrean al guardar.
- Auditoría e historiales (`compras_orden_revisiones`, `compras_sync_historial`)
  de solo inserción.

## 8. Documentos en el CDE (Trimble Connect)

API Core 2.0 (OpenAPI en SwaggerHub `Trimble-Connect/tcps/2.0`), con el token
del usuario:

- Carpetas: `GET /folders/{id}`, `GET /folders/{id}/item?name=&type=FOLDER|FILE`,
  `POST /folders {name, parentId}` (parentId = **versionId** del padre; si no lo
  acepta, el id).
- Subida: `POST /files/fs/upload?parentId=&parentType=FOLDER {name}` → 202
  `{uploadId, contents[].url}`; `PUT` del contenido a la URL firmada **sin
  autenticación y sin Content-Type** (un `Blob` sin tipo); `GET
  /files/fs/upload?uploadId` → `DONE` con `fileId`, `versionId`, `revision` (en
  `UPLOADABLE` repite la URL). Mismo nombre = nueva versión; `If-None-Match: *`
  rechaza duplicados; `If-Match` lleva un versionId.
- Descarga: `GET /files/fs/{fileId}/downloadurl` → enlace de corta duración.

Cómo lo usa Compras:

- **Carpetas**: "Revisar en Trimble" no crea nada; "Preparar carpetas" (con
  confirmación) crea `Compras y Contrataciones/` con Requisiciones, Cotizaciones,
  Órdenes de compra, Contratos, Documentación legal de proveedores (una
  subcarpeta por proveedor "NIT Razón social") y Actas y recepciones. Ids en
  `compras_cde_carpetas`.
- **Nombre fijo** por documento: `REQ-0001 - Soporte - nombre original [8 primeros del id].pdf`,
  así un reintento nunca crea otro archivo.
- **Envío**: el navegador manda el archivo directo a la URL firmada (no pasa por
  Vercel, que limita a 4.5 MB). Si falla (CORS), el servidor lo envía hasta
  **4 MB** (`MAX_RELEVO`) y calcula la huella él mismo con Web Crypto (nunca
  confía en la del navegador). Máximo 100 MB.
- **Respaldado** solo con `fileId` y `versionId` de Trimble: restricción
  `compras_documentos_respaldo` y trigger `compras_documentos_sin_retroceso`.
- **Reintento** (en el registro o en la cola "Pendientes de respaldo"): primero
  pregunta a Trimble (ya llegó → solo confirma; subida abierta → reenvía;
  vencida → abre otra con `If-None-Match`). Copia local en IndexedDB hasta la
  confirmación; si no la hay, pide el archivo y revisa la huella.
- **Abrir**: enlace de corta duración pedido con el token del usuario; queda en
  la auditoría. **Anular** pide motivo y no borra nada en Trimble.
- **Expediente legal del proveedor**: tipos configurables (RUT, Cámara 30 días,
  cédula, bancaria 90 días, seguridad social 30 días, pólizas, otro) con
  obligatorio, vigencia y activo (se desactivan, no se quitan); estados
  completo, por vencer (15 días), vencido, incompleto; solo cuenta lo respaldado.
- La prueba de escritura (`PruebaCde`, al final de la pestaña Documentos (CDE))
  comprueba con un proyecto real que el token puede crear carpetas, subir,
  versionar y que Trimble rechaza duplicados.

## 9. PDF reproducibles y Excel

- `pdfOrden` y `pdfRecepcion` (jsPDF en el navegador, carta) fijan
  `setCreationDate` (fecha de aprobación) y `setFileId` (del id del registro):
  **el mismo registro produce el mismo archivo**, así un reintento lleva la misma
  huella. Una prueba lo verifica. Se guardan en el CDE con el botón "Guardar el
  PDF / el acta en el CDE" (prop `generar` de `DocumentosRegistro`).
- `excelPanel.ts`: `llenarLibro(wb, panel, proyecto)` es separable de la
  descarga para probarlo en Node; `descargarPanel` carga ExcelJS con
  `import("exceljs")` (patrón de `lib/manuales/excelContable.ts`).

## 10. Panel y trazabilidad

- `GET panel` (permiso `panel.ver`) calcula en el servidor, con las mismas
  funciones de las otras pestañas: indicadores, una fila por insumo (planificado,
  solicitado, aprobado, comprometido, recibido, rechazado, por solicitar, por
  recibir, valor comprometido sin IVA frente a precio del presupuesto) y la ruta
  de cada insumo (requisición → cotizaciones → orden o contrato → recepciones,
  con documentos).
- Un indicador sin datos es `null` y se muestra **"Sin datos suficientes"**,
  nunca un cero inventado.
- La ruta muestra solo los módulos que el rol ve (`VisibilidadRuta`); sin
  `requisiciones.ver` no hay ruta.
- El plan decía vista SQL `compras_insumo_estado`; se calculó en el servidor
  porque lo planificado sale del cálculo del presupuesto (código, no base). Se le
  explicó al dueño; si pide la vista, hacerla.

## 11. SQL: patrones y cómo probarlo

`supabase/compras.sql` (≈2000 líneas, re-ejecutable):

- Funciones `plpgsql` con `set search_path = public` y `revoke all … from
  public, anon, authenticated` + `grant execute … to service_role` (cada función
  nueva, también las de trigger, va en el bloque final).
- Los errores salen como `raise exception 'compras:<motivo>'`; el store los
  traduce a `MotivoRechazo` (agrega el motivo nuevo en `accesos.ts` con mensaje y
  estado HTTP). `23505` de índices únicos se traduce por nombre del índice.
- Triggers de respaldo `deferrable initially deferred` (revisan al final de la
  transacción, así borrar y recrear líneas dentro de la función no falla).
- Una función `language sql` que lee una tabla debe ir **después** de crear la
  tabla (se valida al crearla); las `plpgsql` pueden ir antes.
- Tablas nuevas: `enable row level security`, `revoke all … from anon,
  authenticated` y solo los `grant` necesarios al rol de servicio (las de solo
  inserción: `select, insert`).

Prueba con PGlite (además de `scripts/probar-sql.mjs`): un script por fase en
`<scratchpad>/pg/probar-<fase>.mjs` que ejecuta el SQL dos veces, siembra con las
funciones (activar, usuarios, requisición, cotización, comparativo, orden…) y
comprueba cada regla con `espera(nombre, fn, errorEsperado)`, incluidas
**escrituras directas** dentro de `db.transaction` para ver disparar los
triggers diferidos. `compras_activar` necesita el JSON de los roles iniciales:

```bash
# roles.ts en el scratchpad: import { ROLES_INICIALES } from "<repo>/lib/compras/roles"; console.log(JSON.stringify(ROLES_INICIALES))
npx tsx <scratchpad>/roles.ts > <scratchpad>/roles.json
node probar-recepciones.mjs "<repo>/supabase/compras.sql" "$(cat ../roles.json)"
```

## 12. Pendientes

- **Prueba de escritura en el CDE en un proyecto real** (pestaña Documentos
  (CDE) → "Prueba de escritura en el CDE"): falta saber si el token de la
  extensión puede escribir y si el PUT a la URL firmada funciona desde el iframe
  (CORS). Pedir al dueño que pegue el resumen.
- **Prueba de aceptación** con personas reales: A administrador, B Compras, C
  miembro de Trimble sin rol (debe recibir 403 en pantalla y API); cortar la red
  durante una subida y comprobar que queda pendiente y el reintento no duplica.
- Un borrador de orden o de recepción reserva cantidad (los de requisición no
  cuentan en lo solicitado): si se olvida, hay que anularlo.
