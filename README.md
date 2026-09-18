# Resumen Archivos - extension para Trimble Connect

Extension de proyecto para Trimble Connect que agrega un panel "Resumen Archivos"
al menu lateral. Al abrirlo, recorre recursivamente todas las carpetas del
proyecto activo, agrupa los documentos por tipo (extension) y muestra:

- Tarjetas resumen: total de archivos, tipos distintos, tamano total ocupado.
- Grafico de dona: cantidad de archivos por tipo (top tipos + "Otros").
- Grafico de barras: tamano ocupado por tipo (top tipos + "Otros").
- Linea de tiempo del crecimiento acumulado de documentos, con vista semanal y
  mensual, desde la fecha de creacion del proyecto hasta hoy.
- Al hacer clic en cualquier tipo (o en "Otros"), una tabla paginada con el
  detalle de esos archivos: nombre, carpeta, tamano, quien lo subio y fecha.

## Como funciona (resumen tecnico)

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
  app OAuth registrada ("apibasedatos") **no son necesarias para que el
  dashboard funcione** dentro de Trimble Connect. Se dejan documentadas en
  `.env.example` unicamente por si en el futuro se quiere agregar un flujo
  OAuth independiente (uso fuera de Trimble Connect, Postman, acceso no
  interactivo, etc.).
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
  por proyecto durante 8 minutos (`lib/cache.ts`). En Vercel esto significa
  que una misma instancia "tibia" reutiliza el resultado; un cold start lo
  recalcula. Es intencionalmente simple (sin Redis/KV externo) para una
  primera version; si el proyecto crece mucho se puede reemplazar por Vercel
  KV sin tocar el resto del codigo.

## Estructura del proyecto

```
app/
  page.tsx                 Pagina informativa (no es la extension en si)
  extension/page.tsx        Pagina que se embebe en Trimble Connect
  extension/ExtensionApp.tsx  Logica de conexion al Workspace API y al token
  api/summary/route.ts      Resumen agregado (totales, por tipo, timeline)
  api/files/route.ts        Listado paginado de archivos de un tipo
components/                Dashboard y componentes de UI/graficos
lib/                        Cliente REST de Trimble, recorrido recursivo,
                            cache, agregaciones
public/manifest.json        Manifiesto de la extension
public/icon.svg              Icono de la extension
```

## Configurar y desplegar en Vercel

1. **Sube este repositorio a GitHub** y conectalo a un nuevo proyecto en
   Vercel (Import Project → selecciona el repo). Vercel detecta Next.js
   automaticamente, no requiere configuracion adicional.

2. **Variables de entorno en Vercel** (Project Settings → Environment
   Variables). No son estrictamente necesarias para que el dashboard
   funcione (ver seccion de autenticacion arriba), pero si quieres dejarlas
   configuradas para uso futuro:

   | Variable | Valor |
   |---|---|
   | `TRIMBLE_CLIENT_ID` | `31d42c3e-aacc-492e-a3a1-fd9903ae2c50` |
   | `TRIMBLE_CLIENT_SECRET` | (el Client Secret de la app "apibasedatos"; ponlo solo en Vercel, nunca en el repo) |
   | `TRIMBLE_REDIRECT_URI` | `https://trimble-docs.vercel.app/api/auth/callback` (o la que definas) |

3. **Despliega.** ✅ Ya desplegado: el dominio de produccion es
   `https://trimble-docs.vercel.app`.

4. **Actualiza las URLs que dependen del dominio final** (antes de registrar
   la extension en Trimble Connect). ✅ Ya hecho: [`public/manifest.json`](public/manifest.json)
   apunta a `https://trimble-docs.vercel.app` en los campos `url`, `icon` e
   `infoUrl`.

5. **⚠️ Recordatorio importante — Callback URL en el Trimble Developer
   Console:** la app OAuth "apibasedatos" (Client ID
   `31d42c3e-aacc-492e-a3a1-fd9903ae2c50`) esta registrada hoy con las
   callback URLs `https://oauth.pstmn.io/v1/callback` y `http://localhost`
   (usadas para pruebas con Postman/local). **Pendiente**: entra al Trimble
   Developer Console y agrega la URL de callback de produccion
   `https://trimble-docs.vercel.app/api/auth/callback`, o escribe a
   connect-support@trimble.com si necesitas que agreguen una nueva callback
   URL a la app ya registrada. Esto solo es relevante si en el futuro
   implementas el flujo OAuth Authorization Code completo; el dashboard tal
   como esta entregado no lo necesita para funcionar.

## Registrar la extension en Trimble Connect

1. Abre el proyecto en Trimble Connect for Browser (necesitas ser
   administrador del proyecto).
2. Ve a **Configuracion del proyecto → Apps & Capabilities**.
3. Selecciona **+ Add Custom** (arriba de la lista).
4. En **Capability Manifest URL**, escribe la URL de tu manifiesto desplegado:
   ```
   https://trimble-docs.vercel.app/manifest.json
   ```
5. Selecciona **Add**. "Resumen Archivos" deberia aparecer en el menu lateral
   del proyecto, junto a las demas extensiones (con el icono de carpeta azul).
6. Al abrirlo por primera vez, Trimble Connect pedira tu consentimiento para
   que la extension pueda leer el access token del usuario actual (esto es lo
   que permite leer los documentos del proyecto). Acepta el mensaje para que
   el panel cargue los datos.

Si en algun momento quieres revocar el permiso, puedes hacerlo desde la
configuracion de la extension dentro del proyecto.

## Desarrollo local

```bash
npm install
npm run dev
```

Ten en cuenta que `app/extension` solo funciona correctamente **embebido
dentro de un iframe de Trimble Connect** (usa `window.parent` para
comunicarse via `postMessage`). Abrir `http://localhost:3000/extension`
directamente en el navegador mostrara un mensaje indicando que debe abrirse
desde dentro de Trimble Connect; para probar cambios de verdad, hay que
desplegar (o exponer el `localhost` con una herramienta como ngrok) y
registrar esa URL como manifiesto temporal de prueba.

## Limitaciones conocidas / decisiones de diseño

- El cache de 8 minutos vive en memoria del proceso serverless; no es
  compartido entre instancias frias de Vercel. Es una limitacion aceptada
  para esta primera version (ver seccion "Cache" arriba).
- El cache se guarda por `projectId` (no por usuario), asumiendo el modelo
  de permisos por defecto de Trimble Connect donde todos los miembros del
  proyecto ven todos los archivos salvo restriccion explicita de carpeta.
- La extension siempre opera sobre el proyecto abierto en ese momento; no
  hay selector de proyectos.
