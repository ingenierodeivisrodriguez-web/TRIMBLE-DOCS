# Guía de uso (para responder al dueño y a sus usuarios)

## Contenido
1. Instalar en Trimble Connect
2. Antes de usar Presupuesto
3. Orden de trabajo recomendado
4. Explicar cuadrillas y cantidades
5. Textos de ejemplo para el asistente IA (edificio de 5 pisos)
6. Preguntas frecuentes

## 1. Instalar en Trimble Connect

Administrador del proyecto → **Configuración del proyecto → Apps & Capabilities →
+ Add Custom** → pegar la **Capability Manifest URL** → **Add** (recargar si no
aparece).

| Extensión | URL |
|---|---|
| Presupuesto (menú + visor) | `https://trimble-docs.vercel.app/manifest-presupuesto.json` |
| Presupuesto, respaldo solo visor | `https://trimble-docs.vercel.app/manifest-presupuesto-visor.json` |
| Propiedades (+ respaldo `-visor`) | `https://trimble-docs.vercel.app/manifest-propiedades.json` |
| Resumen Archivos | `https://trimble-docs.vercel.app/manifest.json` |
| Validación | `https://trimble-docs.vercel.app/manifest-validacion.json` |
| Gráficos de Modelos (visor) | `https://trimble-docs.vercel.app/manifest-graficos.json` |
| Manuales | `https://trimble-docs.vercel.app/manifest-manuales.json` |
| Compras y Contratación | `https://trimble-docs.vercel.app/manifest-compras.json` |
| Realidad aumentada (menú + visor; respaldo `manifest-ra-visor.json`) | `https://trimble-docs.vercel.app/manifest-ra.json` |
| Publicar entre proyectos (fase 0: prueba de copia) | `https://trimble-docs.vercel.app/manifest-publicar.json` |

Realidad aumentada tiene su propia guía pública para los usuarios (oficina y
obra, problemas frecuentes y prueba en obra): `https://trimble-docs.vercel.app/ra/guia`.
Necesita `supabase/ra.sql` ejecutado y un celular Android con Chrome y ARCore.

Antes de dar una URL, comprueba que responde: `curl -s -o /dev/null -w "%{http_code}" <url>`.

## 2. Antes de usar Presupuesto

- Ejecutar `supabase/presupuesto.sql` en el SQL Editor de Supabase (y otra vez
  cada vez que cambie: líneas base, avance, elementos ejecutados…).
- Elegir editores y, si aplica, el proyecto base de catálogos (⚙ Configuración).
- Asistente IA: clave del proveedor en Vercel y cupo habilitado desde el proyecto
  gestor.

### Antes de usar Compras y Contratación

- Ejecutar `supabase/compras.sql` en el SQL Editor de Supabase (y otra vez cada
  vez que cambie).
- Un administrador del proyecto en Trimble entra a Compras y pulsa **Activar
  Compras**; luego da acceso a cada persona en **Accesos y roles** (rol y fechas).
  Sin acceso vigente nadie entra, aunque sea miembro del proyecto.
- En **Documentos (CDE)**: **Revisar en Trimble** y **Preparar carpetas** antes
  de cargar documentos.
- Recorrido: requisición (Residente) → cotizaciones y comparativo (Compras) →
  aprobación (Director) → orden o contrato (Compras/Jurídica) → aprobación
  (Director/Finanzas) → recepción (Residente/Almacén) → aprobación (Almacén) →
  Panel. Quien elabora nunca aprueba lo suyo.

## 3. Orden de trabajo recomendado

1. Catálogo de insumos con precios (o importar Excel).
2. Presupuesto: **Crear EDT** con el asistente (o a mano) → **Insumos** (crea los
   que faltan, sin precio) → poner precios en el catálogo → **Lista de insumos →
   Actualizar precios del catálogo** → **Análisis (APU)** → **Diccionario EDT**.
3. Metrados: con un clic en la grilla (Enter pasa a la siguiente) o desde el
   modelo en el visor (marca 3D).
4. **Guardar**. Si las partidas sirven para otras obras: **📚 Al catálogo**.
5. Programación: calendario (festivos de Colombia, sábados de 4 h) → 🗂 Estructura
   (EDT) → Dividir por ubicación → 🤖 Proponer paquetes y secuencia → revisar ruta
   crítica y línea de balance → Guardar → **Línea base**.
6. Obra: cortes de **Avance** (o marcar ejecutados en el visor) → **📊 Valor
   ganado**.

## 4. Explicar cuadrillas y cantidades

- **Rendimiento**: lo que hace la cuadrilla en un día. **Cantidad**: lo que se
  gasta del insumo en una unidad de la partida. **Cuadrilla**: cuántos trabajan a
  la vez (1 oficial y 2 ayudantes = dos líneas con 1 y 2).
- Por hora (HH, HM): cantidad = cuadrilla × jornada ÷ rendimiento. Por día (DIA,
  JR): cantidad = cuadrilla ÷ rendimiento. %MO o %: la cantidad es el porcentaje y
  el PU se calcula solo. Materiales: cantidad directa con desperdicio.
- Error típico: escribir cantidad 1 en una cuadrilla por día (= un día entero por
  cada m²). Solución: "Calcular con cuadrilla" y poner 1.
- Usa el ejemplo de replanteo y el de muro de `presupuesto-calculo.md` §5 con
  tablas.

## 5. Textos de ejemplo para el asistente IA (edificio de 5 pisos)

Supuestos: estrato 3 en Colombia, 4 apartamentos por piso (20), ~55 m² cada uno,
pórticos de concreto + mampostería de bloque, sin sótano ni ascensor. Hay que
adaptarlos al proyecto real. El cuadro de descripción es **uno solo** para el
asistente y la programación (guarda lo último escrito).

**Texto A — Presupuesto → Crear EDT** (agrupar: solo por capítulos, para que el
presupuesto sea estructura de costos y los pisos vayan en la programación; o "por
capítulos y pisos" si se quieren pisos también en el presupuesto; detalle:
detallado):

```text
Edificio multifamiliar de vivienda estrato 3 en Colombia, en zona de amenaza sísmica intermedia, de 5 pisos sin sótano y sin ascensor, con 4 apartamentos por piso: 20 apartamentos en total.
Cada apartamento tiene unos 55 m², con sala-comedor, cocina abierta, zona de ropas, 3 alcobas y 2 baños. Área construida aproximada de 1.300 m² (260 m² por piso), con un punto fijo de escalera y un hall común en cada piso.
Sistema estructural: pórticos de concreto reforzado (columnas, vigas y placas aligeradas de entrepiso) diseñados con la NSR-10. Cimentación con zapatas aisladas y vigas de amarre según el estudio de suelos. Muros divisorios y de fachada en mampostería de bloque de arcilla.
Acabados de estrato 3: pañete, estuco y pintura en muros interiores; piso cerámico en toda el área; enchape en baños y cocina; cielo raso en pañete o drywall; puertas de madera entamborada; ventanería en aluminio con vidrio de 4 mm; mesón de cocina en acero inoxidable; aparatos sanitarios de línea económica.
Fachada en ladrillo a la vista con paños en pañete pintado. Cubierta en placa de concreto impermeabilizada con manto asfáltico, con tanque de reserva de agua y equipo de presión.
Instalaciones hidrosanitarias en PVC (agua fría, desagües, ventilación y aguas lluvias). Instalaciones eléctricas según el RETIE, con un medidor por apartamento. Gas natural, telecomunicaciones, citofonía y protección contra incendio básica (extintores y señalización).
Obras exteriores: andenes, cerramiento, portería, zona verde, 10 parqueaderos descubiertos en adoquín y acometidas de servicios públicos.
```

**Preguntas de ejemplo (pestaña Preguntar):** costo directo por m² y por
apartamento; los 10 capítulos o partidas que más pesan; partidas sin análisis,
sin metrado o con insumos sin precio; costos unitarios fuera de lo normal para
estrato 3; peso de MO, MT y EQ; insumos que concentran el 80 % del costo.

**Programación, antes de la IA:** dividir por ubicación en tres grupos (estructura:
acero, formaleta y concreto de columnas y placa; mampostería: muros, regatas,
instalaciones, pañetes; obra blanca: pisos, enchapes, estuco, pintura, carpintería,
aparatos), con ubicaciones del modelo (columna Nivel) o escritas a mano
(`PISO 1` … `PISO 5`, una por línea), encadenando; 1 día de espera en estructura.

**Texto C — Programación → Proponer paquetes y secuencia** (reemplaza lo que haya;
alcance toda la programación si son ≤ 150 actividades; no marcar "Reemplazar las
predecesoras actuales"):

```text
Programación de un edificio multifamiliar estrato 3 de 5 pisos, con 4 apartamentos por piso, estructura en pórticos de concreto y mampostería de bloque, sin sótano.
Organiza la EDT por entregables y ubicación: PRELIMINARES Y CIMENTACIÓN; ESTRUCTURA por piso (PISO 1 a PISO 5); CUBIERTA; MAMPOSTERÍA E INSTALACIONES por piso; OBRA BLANCA Y ACABADOS por piso; FACHADA; EQUIPOS; URBANISMO Y ENTREGA.
Secuencia constructiva:
- Preliminares, descapote, excavación y cimentación (zapatas y vigas de amarre) antes de la estructura del piso 1.
- En cada piso: acero y formaleta de columnas, fundida de columnas, formaleta y acero de placa con las instalaciones embebidas, y fundida de placa. Las columnas del piso siguiente empiezan cuando la placa del anterior está fundida. Desencofrado de placas a los 14 días, con reapuntalamiento.
- La mampostería de un piso empieza cuando la estructura va dos pisos más arriba. Después vienen las regatas, las instalaciones hidrosanitarias y eléctricas, y los pañetes.
- La cubierta y su impermeabilización van después de la placa del piso 5. La fachada se hace de arriba hacia abajo, con andamio, cuando esté lista la mampostería del piso 5.
- La obra blanca (pisos, enchapes, estuco y pintura, carpintería y aparatos) va de abajo hacia arriba, cuando los pañetes del piso estén terminados.
- Urbanismo, aseo y entrega al final.
```

Para otro proyecto, conserva la forma: tipo de edificación y estrato, ciudad o zona
sísmica, pisos en números, unidades por piso, áreas, sistema estructural y
cimentación, acabados por estrato, instalaciones (RETIE, gas, telecomunicaciones),
obras exteriores; y para la programación, la EDT por entregables y ubicación y la
secuencia constructiva paso a paso.

## 6. Preguntas frecuentes

- **"Las partidas de la IA no salen en el catálogo"**: van al presupuesto; para
  reutilizarlas, 📚 Al catálogo. Recordar **Guardar** ("Cambios sin guardar").
- **"El PU sale en 0"**: insumos creados por la IA sin precio → precio en el
  catálogo → Actualizar precios del catálogo en Lista de insumos.
- **"El CU no cambia con la jornada"**: líneas con la cantidad escrita a mano, o
  insumos por día (no dependen de la jornada). Usar cuadrillas.
- **"No puedo escribir el metrado"**: si dice 3D, sale del modelo; cambiarlo a
  manual en el diálogo de la partida (✎).
- **"No veo el cambio"**: recargar la pestaña de Trimble Connect después del
  despliegue.
