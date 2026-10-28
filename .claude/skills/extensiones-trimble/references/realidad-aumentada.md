# Realidad aumentada con QR (`/ra`)

Construida en 6 fases (0 a 5) el 27-10-2026. El celular escanea un QR pegado en
un muro de la obra y muestra el modelo BIM a escala 1:1, fijo en ese punto, con
corte horizontal, corte vertical, transparencia y colorear a mano. La sección
del README «Realidad aumentada con QR» explica todo para el dueño; la guía
pública para usuarios está en `/ra/guia` (`app/ra/guia/page.tsx`).

## Decisiones del dueño (no cambiarlas sin preguntar)

1. **Solo Android con Google Chrome** (WebXR `immersive-ar` + ARCore). El iPhone
   no sirve desde el navegador.
2. El modelo convertido se guarda en **Supabase** (bucket privado `ra-modelos`)
   y **se elimina solo** a los N días sin uso (30 al inicio; los cambia un
   administrador, de 1 a 365). La fila queda como «eliminado» (regla 3).
3. El QR abre **sin iniciar sesión** y **vence** (máximo 365 días); se puede
   **anular**. Los QR nunca se borran.
4. El punto del QR se elige **en el visor 3D**.
5. **Colorear es a mano**, elemento por elemento, y **solo en ese celular durante
   la sesión** (no se guarda: nadie puede cambiar lo que ven los demás).
6. La hoja del QR va **pegada en el muro** (no en el piso): un clic en la cara
   de un muro; su normal da la orientación. Los dos primeros QR de prueba
   quedaron con `montaje = 'piso'` y no abren en RA.
7. El corte vertical va **por los ejes X / Y del modelo** (no paralelo al muro).

## Por qué está armada así

- La app de Trimble Connect para celular **no carga extensiones** y la API del
  visor **no entrega geometría**. Por eso: el IFC se descarga (por el servidor,
  `/api/ra/ifc`, como Manuales) y se convierte **en el navegador** con
  `web-ifc` (`public/web-ifc/web-ifc.wasm`, un hilo; una prueba exige que sea
  igual al de `node_modules`), y el celular usa páginas **públicas** con un
  código de 128 bits en el QR.
- Vercel no deja pasar más de 4.5 MB por sus funciones: el navegador **sube**
  el modelo directo a Supabase con un **enlace firmado de un solo objeto** y el
  celular lo **descarga** con un enlace firmado de 15 minutos. La clave nunca
  sale del servidor.
- Coordenadas del visor de Trimble: no se suponen. El elemento tocado (mismo
  IFCGUID) da escala (m o mm) y corrimiento comparando su caja en el visor con
  la del modelo preparado; si no tienen la misma forma, se rechaza
  (`lib/ra/anclaje.ts`). Confirmado en Trimble real (27-10-2026).

## Mapa de archivos

| Qué | Dónde |
|---|---|
| Conversión IFC → modelo (lotes por color, `tramos` = qué triángulos son de qué elemento, origen en metros enteros) | `lib/ra/modelo.ts` |
| Archivo del celular «RAQ1» (gzip) | `lib/ra/formato.ts` |
| Límites (1 M triángulos avisa, 3 M o 50 MB bloquea) | `lib/ra/limites.ts` |
| Clic del visor → modelo, muro, rumbo, coordenadas IFC | `lib/ra/anclaje.ts` |
| Código del QR, estado (activo/vencido/anulado/sin-modelo), fin del día en hora de Colombia | `lib/ra/codigo.ts` |
| Hoja PDF carta para el muro | `lib/ra/hoja.ts` |
| Calibración en el celular (giro + corrimiento), lector de QR que solo acepta `/ra/q/<código>` | `lib/ra/calibracion.ts` |
| Cortes, transparencia, rangos de vértices para colorear | `lib/ra/herramientas.ts` |
| Servicio (permisos, eliminación automática, QR, apertura pública) | `lib/ra/service.ts`, `store.ts`, `validate.ts`, `routes.ts`, `client.ts` |
| SQL (`ra_config`, `ra_modelos`, `ra_puntos`, bucket) | `supabase/ra.sql` |
| Panel del visor (pestañas Preparar / Punto QR) | `components/ra/PanelVisorRA.tsx`, `PanelPreparar.tsx`, `PanelPunto.tsx` |
| Menú del proyecto (modelos, QR, días sin uso) | `components/ra/RaApp.tsx` |
| Celular: página del QR, visor RA, herramientas, escáner | `components/ra/QrCelular.tsx`, `VisorCelular.tsx`, `HerramientasRA.tsx`, `controlModelo.ts`, `EscanearQR.tsx` |
| Prueba del celular (volumen 2 × 2 × 3 m) | `app/ra-prueba`, `components/ra/PruebaRA.tsx` |
| Pruebas con un IFC real en mm y georreferenciado (muro, losa, espacio, viga en ensamble) | `lib/ra/pruebas/ifcPrueba.ts` |

Rutas: `/ra` (menú), `/ra/visor` (respaldo visor), `/ra/q/<código>` (celular),
`/ra/escanear`, `/ra/guia`, `/ra-prueba`. API: `/api/ra/estado`, `config`,
`ifc`, `modelos` (+ `/{id}/confirmar`, `/{id}/archivo`, `DELETE /{id}`),
`puntos` (+ `DELETE /{id}`), y **sin sesión** `publico/{código}` y
`publico/{código}/modelo` (este renueva el plazo del modelo).

## Marcos de coordenadas

- **IFC**: metros, z arriba. **Modelo preparado** (web-ifc): y arriba, relativo
  a `origen`: IFC x → x, IFC z → y, IFC y → −z.
- **Visor de Trimble**: z arriba, unidades y origen propios (se alinean por el
  elemento tocado).
- **Rumbo**: radianes desde +z hacia +x del modelo (= `rotation.y` de three.js).
  En un QR de muro es hacia dónde mira la cara del muro.
- **Sesión WebXR** (`local`): y arriba por gravedad. La pose del toque tiene la
  normal en su eje y.

## Cómo probarla

- `npx tsx --test lib/ra/*.test.ts` (usa web-ifc real con el IFC de prueba).
- Navegador: página temporal que monta `PanelVisorRA`/`RaApp` con el servicio real
  sobre `memoryStore()` y un visor falso que emite `viewer.onPicked`
  (`{ position, normal, modelId, objectRuntimeId }`) y entrega cajas corridas
  de origen. **En desarrollo React crea la simulación dos veces**: guárdala en
  una variable del módulo y créala después de montar. Para las herramientas del
  celular, montar `controlModelo` + `HerramientasRA` en un lienzo normal (el clic
  del mouse hace de toque). La sesión WebXR no se puede probar en el computador.
- PDF: revisar posiciones con `pdfjs-dist/legacy/build/pdf.mjs` (`getTextContent`);
  no abrir el PDF en el navegador del panel (lo descarga y le muestra al dueño
  una ventana de guardar).

## Pendientes

- La **prueba en obra** (protocolo en `/ra/guia#prueba`): precisión con 3 puntos
  de control y corrimiento tras caminar 10 m. Todo lo de RA se verificó en
  pruebas y en el computador, no con la cámara de un Android real.
- El dueño no reportó todavía la prueba de la fase 0 (`/ra-prueba`).
- La conversión corre en el hilo de la página: con IFC grandes la pantalla se
  queda quieta (pasarla a un Web Worker si molesta).
