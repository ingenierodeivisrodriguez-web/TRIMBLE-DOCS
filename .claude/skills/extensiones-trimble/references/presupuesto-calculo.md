# Presupuesto: cálculo, catálogos y edición

## Contenido
1. Estructura del documento
2. Cálculo del análisis de precios (APU)
3. Cuadrillas: por hora y por día
4. Líneas de porcentaje (%MO y %)
5. Ejemplos resueltos
6. Editor del análisis (`ApuEditor`)
7. Metrado y grilla principal
8. Catálogo ↔ presupuesto
9. "Al catálogo" (presupuesto → catálogo)
10. Importar desde Excel, pie y gastos

## 1. Estructura del documento

`PresupuestoDoc = { subpresupuestos, insumos, subpartidas, gastos }`.

- Cada subpresupuesto tiene `items` en orden: **títulos** (`nivel`) y **partidas**
  (`ItemPartida`: código, descripción, unidad, OmniClass, rendimiento, jornada,
  componentes, metrado, `origenId`, `modo` de metrado, `edt`). La numeración
  (1, 1.1, 1.1.1) sale de `numerar()`; no se guarda.
- `doc.insumos` son **copias de precio** del presupuesto, indexadas por el **id del
  insumo del catálogo** (`snapshotInsumo`). Cambiar un PU en el presupuesto no
  toca el catálogo. "Actualizar precios del catálogo" (Lista de insumos) vuelve a
  copiar la ficha entera (también la unidad) de los que siguen en el catálogo.
- `doc.subpartidas` tienen **id propio** del presupuesto y `origenId` → partida del
  catálogo de donde salieron.
- `origenId` en una partida = de qué partida del catálogo vino (o a cuál se
  guardó). Solo informa; no las sincroniza.

## 2. Cálculo del análisis de precios (APU)

`calcularApu(apu, resolver)` en `lib/presupuesto/calc.ts`, igual que la
herramienta de referencia (verificado con sus cifras):

- Cantidades a 4 decimales, montos a 2; `redondear` redondea la mitad hacia afuera
  sin errores binarios (1.005 → 1.01).
- Parcial de una línea = cantidad × PU (redondeado a 2).
- Rubros MO, MT, EQ, SC (por el tipo del insumo) y SP (subpartidas). Una
  subpartida aporta su CU × cantidad; una que se contiene a sí misma no suma y se
  marca con error. Un insumo que ya no existe se marca y no suma.
- **CU = MO + MT + EQ + SC + SP**; parcial de la partida = metrado × CU; un título
  suma sus partidas por columna; CD = suma del subpresupuesto.

## 3. Cuadrillas: por hora y por día

`cantidadComponente(c, apu, unidad)`:

- Con cuadrilla y rendimiento > 0:
  - insumo **por día** (`porDia`: DIA, DIAS, DD, JR, JOR, JORNAL, JORNADA…):
    **cantidad = cuadrilla ÷ rendimiento** (días por unidad);
  - cualquier otro (por hora: HH, HM, H, HR, HORA…):
    **cantidad = cuadrilla × jornada ÷ rendimiento** (horas por unidad).
- Sin cuadrilla: la cantidad escrita.
- `cuadrillaPara(cantidad, apu, unidad)` es la inversa (para cuando se escribe la
  cantidad de una línea con cuadrilla).
- Las unidades se comparan plegadas (sin tildes ni signos), así "Día" = "DIA".
- Rendimiento = unidades de la partida por **día** (jornada de la partida, 8 h por
  defecto). Por eso la **jornada solo cambia lo que se paga por hora**; lo que se
  paga por día depende solo del rendimiento. Esto se le explica así al dueño.

Historia: antes un insumo por DIA con cuadrilla se calculaba con la fórmula de
horas y salía 8 veces más caro; se corrigió (commit b238885). Presupuestos viejos
con esas líneas cambiaron de valor al correcto.

## 4. Líneas de porcentaje (%MO y %)

`esPorcentaje(unidad)` = unidad `%` o `%MO` (sin espacios). En esas líneas:

- **cantidad = el porcentaje** (5 = 5 %); no llevan cuadrilla (si tenían una se
  ignora, y al escribir el % se borra);
- su **PU se calcula solo**: `%MO` = la mano de obra de la partida (líneas MO que
  no son de porcentaje); `%` = **la suma de las demás líneas** (MO, MT, EQ, SC y SP
  que no son de porcentaje); nunca una de porcentaje sobre otra;
- parcial = cantidad ÷ 100 × PU; su rubro es el tipo del insumo (EQ para la
  herramienta menor).
- Lo usual en Colombia para la herramienta menor es **%MO** (5–10 %). El flag de
  la línea es `LineaApu.porcentaje` (antes se llamaba `porcentajeMO`).
- En la lista de insumos y el calendario de insumos, sus montos son dinero, no
  cantidades.

## 5. Ejemplos resueltos (útiles para explicar)

**Localización y replanteo**, rendimiento 250 M2/día, jornada 8 h:

| Insumo | Unidad | Cuadrilla | Cantidad | PU | Parcial |
|---|---|---|---|---|---|
| Cuadrilla de topografía | DIA | 1 | 1 ÷ 250 = 0,0040 | 160.000 | 640,00 |
| Equipo de topografía | HM | 1 | 1 × 8 ÷ 250 = 0,0320 | 50.000 | 1.600,00 |
| Herramienta menor | %MO | — | 5 | 640 | 32,00 |
| **CU** | | | | | **2.272,00** |

Con jornada 10 h el equipo pasa a 0,0400 HM → 2.000 y el CU a 2.672. Con la
herramienta en `%` sería 5 % de 2.240 = 112. El error típico del usuario: escribir
**cantidad 1** (= "un día entero de cuadrilla por cada m²") → 210.000/m².

**Muro en bloque**, 12 M2/día: oficial HH 12.500 cuadrilla 1 → 0,6667 h → 8.333,75;
ayudante HH 9.000 cuadrilla 2 → 1,3333 h → 11.999,70; herramienta 5 %MO de
20.333,45 → 1.016,67.

## 6. Editor del análisis (`components/presupuesto/ApuEditor.tsx`)

- Arriba: rendimiento (unidad/día), jornada (h), chips MO/MT/EQ/SC/SP/CU.
- `componenteNuevo`: MO o EQ por hora o por día empiezan con cuadrilla 1.
- `esPorTiempo(l)`: MO/EQ por hora o día, no de porcentaje. Escribir la cantidad
  de una de esas líneas guarda la **cuadrilla que la da**, así sigue al
  rendimiento y la jornada.
- Aviso amarillo si hay líneas por tiempo con la cantidad escrita a mano, con
  **"Calcular con cuadrilla"**: las pasa a la cuadrilla que da su cantidad de hoy
  (sin cambiar el valor; con cantidad 0, cuadrilla 1).
- Cuadrilla > 20 (`CUADRILLA_GRANDE`) se marca en amarillo con la pregunta
  "¿N personas o equipos a la vez?".
- La cantidad calculada se ve en gris con la cuenta en el `title`.
- El PU se edita en la línea (`onPrecio` cambia el precio del presupuesto en
  todas sus partidas); en líneas de porcentaje no se edita.
- "Crear Insumo" flotante cuando lo buscado no existe en el catálogo.

## 7. Metrado y grilla principal (`BudgetGrid.tsx`)

- **Metrado con un clic** (partidas manuales): la celda se abre en amarillo con el
  número seleccionado; **Enter** guarda y pasa al metrado de la partida siguiente
  que se pueda escribir; **Escape** cancela; salir con clic guarda.
- Descripción y unidad: doble clic (un clic solo selecciona la fila). F2 edita la
  descripción. Flechas ↑↓ cambian de fila, ←→ pliegan títulos.
- `modo` del metrado: **Manual** o **3D** (suma de los elementos asociados). Un
  metrado 3D no se escribe en la grilla; se cambia a manual en el diálogo (✎).
- Memoria de cantidades: botón ▼ con el número de elementos, se despliega entre
  las filas; columnas configurables (hasta 6), orden por columna.
- `celdaActiva` (amarillo `#fff7a8`, borde `#d4b106`) en `NumInput` y `TextCommit`
  de toda la app mientras se escribe.

## 8. Catálogo ↔ presupuesto

- Catálogos del proyecto o de un **proyecto base** compartido (solo lectura en las
  obras). No se elimina un insumo usado por una partida del catálogo ni una
  partida que es subpartida de otra (409 `in-use`).
- `partidaDesdeCatalogo` copia una partida del catálogo al presupuesto con sus
  insumos (manteniendo el precio que el presupuesto ya tenía) y subpartidas
  (reutilizando una copiada antes desde la misma partida).
- El asistente IA crea partidas **en el presupuesto, no en el catálogo**; los
  insumos nuevos que crea van al catálogo **sin precio**.

## 9. "Al catálogo" (presupuesto → catálogo)

`lib/presupuesto/alCatalogo.ts` + `components/presupuesto/AlCatalogo.tsx`; botón
**📚 Al catálogo** en la barra y "Guardar en el catálogo" junto al análisis.

- Alcance: la partida elegida, las de un título, el subpresupuesto o todo.
- Agrupa la misma partida (mismo `origenId` en el catálogo, o misma descripción +
  unidad plegadas): la de cada piso se guarda **una vez**; avisa si las filas del
  grupo tienen otro análisis (se guarda el de la primera).
- Estado por fila: **nueva** (se crea, marcada por defecto), **ya igual** (solo se
  enlaza) o **distinta** (por defecto se deja como está; se puede **actualizar**
  la del catálogo, conservando su código, OmniClass y diccionario si el
  presupuesto no los tiene, o **guardar como otra**). Igualdad: `mismaPartida`
  (textos + `mismoAnalisis`).
- Líneas apuntadas al catálogo: insumos del catálogo tal cual; insumos solo del
  presupuesto con igual nombre a uno del catálogo → el del catálogo; los demás se
  **crean con el precio del presupuesto y el mismo id**. Subpartidas con origen en
  el catálogo → esa; las demás se crean (recursivo, sin duplicar).
- Códigos ya usados por otra partida o insumo del catálogo se guardan vacíos, con
  aviso. El responsable de la EDT no pasa al catálogo.
- Muestra el **CU en el catálogo** (con precios del catálogo), que puede diferir del
  del presupuesto. Después enlaza las filas (`vincularAlCatalogo`) y pide Guardar.
- Guarda primero los insumos (y actualiza el catálogo en memoria enseguida, para
  que un reintento no los duplique) y luego las partidas.

## 10. Importar desde Excel, pie y gastos

- Plantilla con hojas Insumos, Partidas (con diccionario EDT), Insumos de partida
  (cuadrilla o cantidad por línea) y OmniClass; se reconoce por código o por
  descripción + unidad; vista previa de nuevos/actualizados/errores; lotes de 1.000.
- Pie del subpresupuesto: filas `variable = fórmula` (CD, FGG, % y paréntesis),
  intérprete propio. Inicial: PGG = CD × FGG, UTI = CD × 0.10, ST, IGV = ST × 0.18,
  TOTAL (editable).
- Gastos generales: fijos y variables, formatos General y Personal; PGG = GG ÷ CD.
