# Publicar entre proyectos

Extensión de proyecto (`/publicar`, `manifest-publicar.json`, código en
`lib/publicar/`, `components/publicar/`, `app/api/publicar/`). Pedida el
28-10-2026: publicar un documento o una carpeta del proyecto origen en otro
proyecto y que cada versión nueva del origen llegue sola al destino, para no
subir dos veces al CDE. Piezas pedidas: botón **Publicar**, **Configuración del
proyecto destino** (administrador) y **Actividad** (fecha, usuario, versión,
notas).

## Hechos de Trimble que deciden el diseño

- Trimble Connect **no comparte carpetas entre proyectos** (su "Compartir" manda
  archivos a personas, no los pone en otro proyecto). Hay que **copiar**:
  descargar la versión del origen (`GET /files/fs/{id}/downloadurl`) y subirla
  con el **mismo nombre** a la carpeta del destino (`POST /files/fs/upload`),
  donde Trimble crea una versión nueva. Los números de versión no coinciden
  entre proyectos: guardar los dos.
- **No hay avisos (webhooks) públicos** de versiones nuevas: se compara el
  `versionId` del origen con el último copiado.
- El token de la extensión es **el del usuario y dura una hora**: la copia solo
  ocurre con alguien conectado que pueda leer el origen y escribir en el
  destino. Para copiar sin nadie conectado haría falta la cuenta técnica (ya
  existe para Manuales: `lib/manuales/oauth.ts`, flujo de autorización con
  PKCE y refresh token cifrado) y un revisor programado; Vercel en el plan
  actual solo corre crons **una vez al día** (`vercel.json`).
- `If-Match` con un `versionId` que ya no es el último debería hacer que
  Trimble rechace la subida: es la protección contra pisar cambios hechos en
  el destino (regla 2). La fase 0 lo comprueba en real.
- Subida de una sola parte hasta 5 GB; una subida abierta sin contenido vence a
  los 90 minutos.

## Decisiones del dueño (28-10-2026)

1. Solo **origen → destino**. Un cambio hecho en el destino se muestra y se
   pregunta, nunca se pisa.
2. "Automático" = **al abrir la extensión** (en cualquiera de los dos
   proyectos) + botón "Revisar ahora". Sin cuenta técnica ni cron por ahora.
3. En el uso real **alguien pertenece a los dos proyectos**: la copia se hace
   con su sesión.
4. **Carpeta de recepción fija**: el administrador del destino define una vez
   una carpeta por proyecto origen; lo publicado llega ahí sin aceptarlo.

Preguntas abiertas (antes de la fase 2), con lo propuesto: carpeta publicada
"viva" (archivos y subcarpetas nuevos también se copian: sí); archivo borrado o
movido en el origen (no borrar en el destino, marcar "Retirado en el origen");
nota de las actualizaciones automáticas ("Actualización automática – versión N
del origen"); quién publica (cualquier miembro del origen que pueda escribir en
la carpeta de recepción); archivo más pesado esperado.

Supuestos declarados: solo menú del proyecto (sin visor); se copia desde la
última versión al publicar (no el historial); mismo nombre en el destino;
cambiar la carpeta de recepción solo afecta lo nuevo; "Dejar de actualizar"
propuesto (no pedido).

## Resultado de la prueba real (28-10-2026)

SELVIA → Laboratorio (misma región), `.rvt` de 90.1 MB: lee y escribe; el
servidor copió en flujo a ~60 MB/s (1.5 s); mismo nombre = versión nueva;
**`If-Match` viejo → Trimble rechaza** (412/409); copia desde el navegador
también funciona (CORS permitido); tamaño y MD5 iguales. El visor del destino
quedó en "Conversión en curso": Trimble reconvierte el modelo subido.
`GET /projects/me` **no trae nombres** (el select mostraba ids): los nombres
salen de `GET /projects?fullyLoaded=false` de cada región (`listRegionProjects`).

Mejoras pedidas por el dueño tras la prueba (hechas): nombre del proyecto
destino; varios archivos a la vez; **no crear carpeta en el destino** (el
archivo directo en la carpeta elegida); **solo la última versión** (una copia,
no versiones de prueba); evaluar cómo acelerar la conversión.

## Copia a mano (`lib/publicar/copiar.ts`, `components/publicar/CopiaProyectos.tsx`)

Pasos (`POST /api/publicar/copia`): `revisar` (nuevo / al-dia por MD5 /
distinto, con versión, quién y cuándo), `copiar` (un archivo ya en el destino
solo con `siVersion` = la versión vista; si cambió, se rechaza con
`cambio: true`), `estado-subida`, `estado-visor` (`GET /files/{id}/status`,
leído con `leerEstadoVisor` porque el formato real no se conoce aún).

Orden para no reconvertir: (a) `POST /files { parentId, parentType: "FOLDER",
fromFileVersionId, mergeExisting }` en el servidor del destino (copia dentro de
Trimble; FME dice que no copia "entre ubicaciones": sin confirmar entre
proyectos); (b) subida con `contents: [{}, { format: "TRB" }]` y el TRB del
origen (`downloadurl?format=TRB`); si Trimble no acepta el TRB, se repite sin
él; si el TRB no llega, la subida nunca termina, así que se responde
`reintentarSinModelo` y el navegador repite con `sinModelo: "1"`; (c) solo el
archivo. **Pendiente**: que el dueño diga, con un modelo real, cuál camino
salió y si el visor del destino quedó listo sin "Conversión en curso".

## Cuenta técnica (fases A y B, 28-10-2026)

La decisión 3 ("alguien pertenece a los dos proyectos") **cambió**: al probar
SELVIA ↔ otro proyecto de otra empresa, nadie estaba en ambos (la lista de
destinos sale de `/projects/me` del usuario y la copia necesita leer y escribir
con el mismo token). Ahora:

- `lib/publicar/cuenta.ts`: conectar (PKCE con `lib/manuales/oauth.ts`, misma app
  "apibasedatos" y `TRIMBLE_CLIENT_SECRET`; `redirect_uri` http://localhost y
  se pega la dirección), `tokenTecnico` (refresh de un solo uso, turno en
  `publicar_cuenta.turno_hasta`), `mantenerSesion` (cron diario
  `/api/publicar/mantener` en `vercel.json`), desconectar (revoca y borra).
  Solo conectan los ids de `PUBLICAR_ADMINS` (patrón de `CONTROL_OBRA_ADMINS`).
- `ladosPara` en `service.ts`: cuenta técnica si abre los dos proyectos; si no,
  el token del usuario si abre ambos; si no, aviso con a quién invitar.
- Publicar sin ser miembro del destino exige su recepción activa para este
  origen (consentimiento); `unirDestinos` (explorar.ts) suma esos destinos.
  `recepciones.destino_nombre` (columna agregada con `add column if not
  exists`) para mostrar el destino a quien no lo ve.
- `revisarAcceso`: miembro, escritura en cada recepción, lectura de lo publicado.
- Pendiente (solo si el dueño lo pide): fase C, copia automática diaria con el
  mismo cron (ya hay token sin usuario).

## Publicación (fases 1 a 4, hechas el 28-10-2026)

- `lib/publicar/service.ts` (recepciones, publicar, estado, `sincronizar`,
  actividad), `store.ts` (Supabase + `memoryStore`), `supabase/publicar.sql`
  (4 tablas, sin `delete`; actividad sin `update`), pruebas en
  `service.test.ts` con `memoryStore` y la nube falsa.
- Recepción: una por (destino, origen); solo administradores de Trimble del
  destino; se desactiva, no se borra. El admin puede pegar el enlace del
  origen (no tiene que ser miembro de él).
- `sincronizar` lo corre el navegador al abrir la extensión (`plan` →
  `copiar` → `confirmar`), en origen o destino, con la sesión de quien abre
  (debe estar en los dos proyectos; si no, aviso). Bloqueo por archivo
  (`en_curso_hasta`, 10 min; 15 min esperando una subida).
- Regla 2: si en el destino hay otro contenido que no es la última copia
  hecha (`destino_version_id`), queda `diferencia` con `diferencia_version_id`
  (la versión vista) y solo `reemplazar` con esa versión lo pisa. Nunca se
  guarda la versión ajena en `destino_version_id` (si no, la próxima copia la
  creería nuestra).
- Carpeta publicada: carpeta con su nombre dentro de la recepción y
  subcarpetas por `subcarpeta` ("A/B"), creadas al copiar; hasta 2000
  archivos. Retirado en el origen: no se borra nada en el destino.
- La página temporal de navegador monta `PublicarApp` con una `PublicarApi`
  que llama al servicio real sobre `memoryStore` y la nube falsa (su huella es
  una función pura para que corra en el navegador); `window.mundo` crea
  versiones nuevas y cambios en el destino.

## Fases

0. **Prueba de copia en Trimble real** (hecha el 28-10-2026). Sin Supabase.
   Reemplazada por la copia a mano.
1. Configuración del proyecto destino (SQL `supabase/publicar.sql`, admin de
   Trimble del destino, carpeta de recepción por proyecto origen).
2. Publicar (explorador del origen, proyecto destino, nota, primera copia,
   actividad).
3. Actualización al abrir (versiones nuevas, archivos nuevos en carpetas
   publicadas, cambios hechos en el destino, retirados en el origen).
4. Actividad completa y cierre (filtros, README, guía, protocolo de prueba).

## Piezas técnicas

- Relee el archivo del origen en cada paso: el nombre nunca viene del
  navegador. Usa las funciones genéricas de `lib/compras/cde.ts` (cliente de la
  API Core, carpetas, `estadoSubida`, `urlDescarga`); la subida con TRB está en
  `abrirSubida` de `copiar.ts`.
- `lib/publicar/copia.ts` (`copiarContenido`): el servidor pasa el contenido de
  la URL de descarga a la URL firmada de subida **en flujo con
  `Content-Length`** (`duplex: "half"`; comprobado con Node 24 que no usa
  `chunked` ni pone `Content-Type`). Si el flujo falla y pesa hasta 512 MB, lo
  baja otra vez entero. La ruta tiene `maxDuration = 300` (Vercel lo aceptó);
  cada envío usa hasta 270 s (`TIEMPO_COPIA_MS`).
- Los enlaces firmados de Trimble aceptan CORS desde nuestro dominio (lo probó
  la fase 0): sirve también para Compras y para archivos muy pesados.
- Pruebas: `copia.test.ts`, `copiar.test.ts` (con
  `lib/publicar/pruebas/trimbleFalso.ts`: varios proyectos, versiones con su
  TRB, `If-Match`, `POST /files`, `format=TRB` y `/status`) y
  `explorar.test.ts`. La página temporal de navegador usa una API falsa con
  respuestas fijas (la nube falsa usa `node:crypto` y no corre en el navegador).
