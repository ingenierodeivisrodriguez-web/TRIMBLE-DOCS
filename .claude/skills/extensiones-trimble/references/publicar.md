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

## Fases

0. **Prueba de copia en Trimble real** (hecha el 28-10-2026; falta el resumen
   del dueño). Sin Supabase.
1. Configuración del proyecto destino (SQL `supabase/publicar.sql`, admin de
   Trimble del destino, carpeta de recepción por proyecto origen).
2. Publicar (explorador del origen, proyecto destino, nota, primera copia,
   actividad).
3. Actualización al abrir (versiones nuevas, archivos nuevos en carpetas
   publicadas, cambios hechos en el destino, retirados en el origen).
4. Actividad completa y cierre (filtros, README, guía, protocolo de prueba).

## La prueba de copia (fase 0)

- `lib/publicar/prueba.ts` (`pasoPrueba`): un paso por solicitud
  (`leer-origen`, `preparar-destino`, `copiar`, `estado-subida`, `proteccion`,
  `abrir-copia-navegador`, `comprobar`). Relee el archivo del origen en cada
  paso: el nombre nunca viene del navegador. Usa las funciones genéricas de
  `lib/compras/cde.ts` (cliente de la API Core, carpetas, subidas).
- `lib/publicar/copia.ts` (`copiarContenido`): el servidor pasa el contenido de
  la URL de descarga a la URL firmada de subida **en flujo con
  `Content-Length`** (`duplex: "half"`; comprobado con Node 24 que no usa
  `chunked` ni pone `Content-Type`). Si el flujo falla y pesa hasta 512 MB, lo
  baja otra vez entero. La ruta tiene `maxDuration = 300`; la copia usa hasta
  270 s (`TIEMPO_COPIA_MS`), de ahí el "archivo más pesado estimado".
- La copia desde el navegador prueba si los enlaces firmados de Trimble
  permiten CORS desde nuestro dominio (dato que tampoco tiene Compras).
- Pruebas: `copia.test.ts`, `prueba.test.ts` (con `lib/publicar/pruebas/trimbleFalso.ts`,
  una nube falsa con varios proyectos, versiones, `If-Match` y descargas) y
  `explorar.test.ts`. La página temporal de navegador usó una API falsa con
  respuestas fijas (la nube falsa usa `node:crypto` y no corre en el navegador).
