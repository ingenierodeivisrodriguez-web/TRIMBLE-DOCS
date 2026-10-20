# Programación, línea base y valor ganado

## Contenido
1. Gantt (modo presupuesto)
2. EDT de la programación (PMI: WBS ≠ estructura de costos)
3. División por ubicación y línea de balance
4. Secuencia con IA
5. Línea base y cortes de avance
6. Valor ganado
7. Avance en el visor 3D
8. Límites y decisiones

## 1. Gantt (modo presupuesto)

`lib/presupuesto/programacion.ts`, `components/presupuesto/Programacion.tsx`,
`Gantt.tsx`, `ProgramacionDialogs.tsx`, `useProgramacion.ts`. Se guarda aparte del
presupuesto (`presupuesto_programacion`, con su versión).

- Al principio cada subpresupuesto, título y partida es una fila
  (`modo: "presupuesto"`); usa el presupuesto en pantalla aunque no esté guardado.
- **Duración** estimada = metrado ÷ (rendimiento × cuadrillas), con el rendimiento
  de la jornada de la partida pasado a la del calendario; escrita a mano va en
  negrita; 0 días = hito. Redondeo: enteros, medios días o sin redondear.
- **Predecesoras** por número de fila: `4` (FC), `6CC+2`, `9FF`, `3CF`, `5-1`
  (adelanto), separadas por `;`. Solo partidas; sin ciclos. También se enlaza
  arrastrando barras y se edita con doble clic en la flecha.
- **Calendario laboral** en horas por día de la semana, días especiales y
  **Festivos de Colombia** (Ley Emiliani y Semana Santa). Todo se calcula en horas
  de trabajo desde el inicio (`calendario.ts`).
- **Ruta crítica** (CPM en horas), holgura por partida. Fecha fija "no comenzar
  antes de" (📌). Fecha fin opcional con aviso.
- Curva S semanal o mensual, calendario valorizado, calendario de insumos (costo o
  cantidad, siguiendo cada partida de cada actividad) y Excel.

## 2. EDT de la programación (PMI: WBS ≠ estructura de costos)

Decisión de diseño acordada con el dueño: el **presupuesto es la estructura de
costos** (cuánto cuesta, por capítulos) y la **EDT de la programación es la WBS**
(qué se entrega, por entregables y ubicación). Quedan **enlazadas, no copiadas**.

- **🗂 Estructura (EDT)** → "Crear la EDT de la programación" convierte (una sola
  vez, sin vuelta atrás) el modo presupuesto en `modo: "edt"`: cada subpresupuesto
  y título → un **nodo** (`NodoEdt { id, padre, nombre, responsable, ubicacion }`),
  cada partida → una **actividad** del 100 % **con el mismo id que la partida**, sus
  enlaces y su duración. Así la línea base, los cortes y las marcas del visor
  siguen sirviendo.
- **Actividad** = `{ id, nodo, nombre, asignaciones: [{ partida, pct }] }` más los
  datos de tarea. Sin asignaciones es un hito/curado/trámite sin costo. Su
  cantidad = % del metrado; su costo = parcial de la partida repartido **al
  centavo** entre sus actividades; su duración estimada = suma de cantidad ÷
  (rendimiento × cuadrillas) de cada partida, como si la misma cuadrilla las
  hiciera seguidas (si van en paralelo, se escribe la duración).
- **Paquetes de trabajo** = nodos de abajo, con **responsable** (cuenta de control)
  y **ubicación en el modelo** (filtros sobre columnas de la memoria, p. ej.
  Nivel = PISO 3; `SIN_DATO_UBICACION` = "(sin dato)").
- **Regla del 100 %**: cada partida asignada completa y una sola vez; la ventana y
  la barra avisan las que faltan o sobran y crean actividades con lo que falta
  (en el paquete de su título o en SIN CLASIFICAR).
- Funciones en `edtProgramacion.ts`: `edtDesdePresupuesto`, `completarAsignaciones`,
  `moverNodo`, `cambiarPadre`, `eliminarNodo` (lo que contiene sube),
  `eliminarActividades`, `reglaDel100` (en `programacion.ts`), `aplicarPrograma`.

## 3. División por ubicación y línea de balance

- **Dividir por ubicación**: parte una o varias partidas en una actividad por
  ubicación. Ubicaciones **del modelo 3D** (elementos de la partida agrupados por
  una columna de la memoria, % por cantidad medida o conteo) o **escritas a mano**
  (partes iguales, p. ej. PISO 1…PISO 5). Crea un paquete por ubicación con su
  filtro y arma el **tren**: dentro de cada piso una partida tras otra (FC) y cada
  partida de un piso al siguiente, con días de espera; se puede invertir (de
  arriba hacia abajo). Las actividades reemplazadas entregan sus enlaces (lo de
  antes va antes del tren; lo de después, después de su última actividad).
- **📐 Línea de balance** (`LineaBalance.tsx`, `lineaDeBalance`): ubicaciones hacia
  arriba, tiempo a la derecha; cada tipo de trabajo es una banda con el avance del
  último corte. Bandas que se acercan o cruzan = cuadrillas que se estorban. Hasta
  8 trabajos a la vez, **cada uno conserva su color** (mapa de 8 colores estable,
  no se repinta al filtrar); también como tabla.

## 4. Secuencia con IA

"🤖 Proponer paquetes y secuencia" (`ia/programa.ts`, ruta `/ia/programa`): para
hasta 150 actividades de un alcance propone el paquete (ruta dentro del alcance) y
predecesoras FC/CC/FF con desfase (±60 días, máximo 3 por actividad) con lógica
constructiva colombiana. Se descartan ciclos, autoenlaces y tipos inválidos. Se
aplica lo marcado; "Reemplazar las predecesoras actuales" es opcional (por defecto
se agregan). Se envían nombre, unidad, cantidad, duración y paquete, **sin precios**.

## 5. Línea base y cortes de avance

`lib/presupuesto/avance.ts`, `servicioAvance.ts`, `components/presupuesto/Avance.tsx`.

- **Línea base**: congela fechas, horas, duración y costo de cada fila (y, con EDT,
  las asignaciones con su costo, la ubicación y el responsable), con el calendario.
  Solo con presupuesto y programación guardados. **Una vigente**; al reprogramar se
  guarda otra; las anteriores **no se borran** y se puede medir contra cualquiera.
- **Cortes** (uno por fecha, `MAX_CORTES`): % real o cantidad ejecutada por tarea,
  y costo real acumulado opcional; parten del corte anterior; avisa si un % baja.
- **Leer el avance del modelo 3D**: % que dan los elementos marcados ejecutados
  hasta la fecha del corte (por cantidad medida, o conteo); con EDT, solo los
  elementos **en la ubicación de la actividad** (`pctTareaDelModelo`). Siempre se
  confirma: nunca reemplaza lo escrito sin preguntar.
- Tareas que no están en la línea base se registran pero no cuentan hasta otra
  línea base.

## 6. Valor ganado (📊)

- **BAC** costo de la línea base; **PV** planeado, **EV** ganado, **AC** real.
- **SPI = EV ÷ PV**; **CPI = EV ÷ AC** solo con las tareas que tienen costo real;
  SV, CV; **EAC = BAC ÷ CPI**.
- **Cronograma ganado** (`Medidor.horaGanada`): la fecha en que la línea base
  preveía lo ejecutado; recorta las zonas planas del PV para que lo que todavía no
  debía empezar **no cuente como atraso**. Da el desfase en días hábiles y la fecha
  fin estimada.
- Lectura en palabras, curva S planeada contra real (PV, EV, AC), tabla de cortes y
  tabla agrupada. **Ver por**: EDT de la programación, capítulos del presupuesto
  (cada actividad reparte entre sus partidas: `controlPorPresupuesto`) o
  responsable (cuenta de control: el paquete con responsable más cercano:
  `controlPorCuenta`). Se exporta a Excel.
- Estados (`estadoAvance`): sin iniciar, atrasada, al día, adelantada, terminada.

## 7. Avance en el visor 3D (`PanelAvance.tsx`)

- Seleccionar elementos y marcarlos **ejecutados** un día (en la partida elegida o
  en todas las suyas); si alguno ya tenía otra fecha, pregunta: cambiar todos o
  solo los pendientes. No se aceptan fechas futuras. **Desmarcar** los vuelve
  pendientes.
- **Colorear** a una fecha: verde ejecutado; rojo pendiente y atrasado (su partida
  debía terminar según la línea base); amarillo pendiente con su partida en
  ejecución; gris pendiente al que no le toca. Un elemento de varias partidas toma
  el peor.
- El día se guarda en `presupuesto_elementos.ejecutado`, **nunca** en propiedades
  del modelo.

## 8. Límites y decisiones

- La conversión a EDT es de una vía. La duración de actividades con varias partidas
  se estima en serie. La IA en modo "agregar" no cambia tipos de enlaces
  existentes. 150 actividades por pedido a la IA. 8 trabajos visibles en la línea
  de balance. La vista por cuenta necesita responsables en los paquetes.
- Colores de gráficos: 8 categóricos en orden fijo; el color sigue a la entidad.
