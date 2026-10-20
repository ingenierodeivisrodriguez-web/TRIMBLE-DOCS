# Arquitectura

## Contenido
1. Las siete extensiones
2. Conexión con Trimble Connect
3. Presupuesto: capas
4. Archivos de `lib/presupuesto`
5. Componentes de `components/presupuesto`
6. Base de datos (Supabase)
7. Permisos
8. Variables de entorno

## 1. Las siete extensiones

| Extensión | Dónde aparece | Página | Manifiesto (`public/`) |
|---|---|---|---|
| Resumen Archivos (estadísticas, árbol de carpetas, auditoría de permisos) | Menú del proyecto | `/extension` | `manifest.json` |
| Validación (nomenclatura de archivos, duplicados) | Menú del proyecto | `/validacion` | `manifest-validacion.json` |
| Gráficos de Modelos (datos de los modelos cargados) | Panel del visor 3D | `/graficos` | `manifest-graficos.json` |
| Propiedades (atributos propios por IFCGUID) | Menú (catálogo) y visor (asignación) | `/propiedades` | `manifest-propiedades.json` (+ `-visor`) |
| Presupuesto | Menú (presupuesto) y visor (asociar elementos, avance) | `/presupuesto` | `manifest-presupuesto.json` (+ `-visor`) |
| Manuales (manuales de la empresa, venta con Wompi/Mercado Pago) | Menú del proyecto | `/manuales` | `manifest-manuales.json` |
| Compras y Contratación (requisiciones a recepción, documentos en el CDE, panel) | Menú del proyecto | `/compras` | `manifest-compras.json` |

`/bim-apps` es la web pública del negocio, con términos y política de datos
(Ley 1581). El README tiene una sección completa por extensión.

## 2. Conexión con Trimble Connect

- El SDK `trimble-connect-workspace-api` detecta que la página corre en el iframe
  de Trimble Connect. El token del usuario sale de
  `API.extension.requestPermission("accesstoken")` (Trimble pide consentimiento y
  lo renueva). No hay flujo OAuth propio: `TRIMBLE_CLIENT_ID/SECRET` no hacen falta.
- Conexión común de Presupuesto y Propiedades: `components/trimble/ExtensionShell.tsx`.
- La región del proyecto se resuelve sola (`GET /projects/me` + `GET /regions`).
- **Desde el menú del proyecto no se ve el visor 3D.** Lo que necesita el visor
  (ver en 3D, actualizar la memoria) se hace en dos pasos: la app guarda una tarea
  para esa persona (`presupuesto_vistas`, 30 min, un solo uso) y abre el visor; el
  panel Presupuesto del visor la recoge y la ejecuta.
- Las páginas solo funcionan embebidas; para probar en local se usa una página
  temporal con una API falsa (ver `flujo-desarrollo.md`).
- `resolveCaller` (usuario, si es miembro y si es administrador del proyecto)
  usa `GET /projects/me`, `/users/me` y `/projects/{id}/users`, con caché de 2 min.
- Compras escribe en las carpetas del proyecto con la API Core 2.0 y el token del
  usuario (`lib/compras/cde.ts`; detalle en `compras.md`).

## 3. Presupuesto: capas

Compras (`lib/compras/`, `components/compras/`, `supabase/compras.sql`) repite
exactamente estas capas con su propio `handle`; ver `compras.md`.

```
app/api/presupuesto/**/route.ts   → handle(req, ctx => …) + readJson(req)      (lib/presupuesto/routes.ts)
lib/presupuesto/service.ts        → reglas y permisos (catálogo, documento, config, elementos, programación)
lib/presupuesto/servicioAvance.ts → líneas base, cortes, ejecución de elementos
lib/presupuesto/ia/servicio.ts    → asistente IA
lib/presupuesto/validate.ts       → valida todo lo que llega del navegador
lib/presupuesto/store.ts          → PostgREST de Supabase con la clave de servicio; memoryStore() en pruebas
supabase/presupuesto.sql          → tablas, vistas y funciones (re-ejecutable)
lib/presupuesto/client.ts         → PresupuestoApi del navegador (lotes con inBatches)
```

- `handle()` valida `?projectId=`, toma el `Authorization: Bearer`, resuelve quién
  llama y si es miembro (`resolveCaller`), arma el `Ctx` (store, deps, clienteIA) y
  convierte `ServiceError` en JSON `{ error, code }` con su estado. Un 401 de
  Trimble pasa a `code: "trimble-session"` con un mensaje de recargar.
- Cada ruta exporta `dynamic = "force-dynamic"` y una línea por método.
- Guardados con **versión optimista**: documento, programación y avance mandan
  `version`; si otra persona guardó antes, 409 `version-conflict` y los cambios
  siguen en pantalla.
- Errores frecuentes: 409 `in-use` (eliminar algo usado), `duplicate-code`
  (código repetido en el catálogo), 402 (cupo IA), 429 `ia-frecuencia`.
- Lecturas lentas de Supabase se reintentan; el catálogo tiene botón Reintentar.

## 4. Archivos de `lib/presupuesto`

| Archivo | Qué tiene |
|---|---|
| `types.ts` | Todos los tipos: `Insumo`, `PartidaCatalogo`, `Componente`, `ItemPartida`, `PresupuestoDoc`, `Programacion`, `NodoEdt`, `Actividad`, `LineaBase`, `CorteAvance`… y límites (`MAX_*`) |
| `calc.ts` | Aritmética del presupuesto: `redondear`, `porHora`/`porDia`, `cantidadComponente`, `cuadrillaPara`, `esPorcentaje(MO)`, `calcularApu`, `calcularSubpresupuesto`, pie, gastos, lista de insumos, consumo |
| `doc.ts` | Documento vacío, resolvers (catálogo o presupuesto), `snapshotInsumo`, `importarApu`, `partidaDesdeCatalogo`, `limpiarDocumento`, ciclos de subpartidas |
| `alCatalogo.ts` | Camino de vuelta presupuesto → catálogo (`planAlCatalogo`, `guardadoAlCatalogo`, `vincularAlCatalogo`) |
| `edit.ts`, `tree.ts` | Cambios inmutables del documento; esquema de títulos y partidas (numerar, sangrar, mover, `bloqueDe`) |
| `format.ts` | `fmt`, `editable`, `plegar` (minúsculas sin tildes), `coincide` |
| `formula.ts` | Intérprete propio de las fórmulas del pie (nunca `eval`) |
| `medicion.ts`, `memoria.ts`, `viewerMap.ts` | Metrado desde el modelo, columnas de la memoria de cantidades, ubicar elementos en el visor |
| `importar.ts`, `excel.ts`, `pdf.ts`, `reportes.ts` | Plantilla e importación de Excel; exportaciones |
| `calendario.ts` | Calendario laboral en horas, festivos de Colombia |
| `programacion.ts` | Gantt: filas (modo presupuesto o EDT), CPM, curva S, calendarios valorizado y de insumos |
| `edtProgramacion.ts` | EDT propia de la programación: nodos, actividades, regla del 100 %, división por ubicación, línea de balance, aplicar la propuesta IA |
| `avance.ts` | Línea base, `Medidor` (PV, horas, cronograma ganado), indicadores, estados, % desde el modelo, control por EDT/presupuesto/cuenta |
| `ia/*` | Asistente IA (ver `asistente-ia.md`) |

## 5. Componentes de `components/presupuesto`

| Componente | Qué es |
|---|---|
| `PresupuestoApp.tsx` | Pantalla del menú: encabezado, barra, grilla, análisis de la partida elegida y el `switch` de diálogos (`type Dialogo`) |
| `usePresupuesto.ts` | Estado: permisos, catálogo (`armarCatalogo`, `catalogoGuardado`), documento, guardar, resumen de elementos |
| `BudgetGrid.tsx` | Grilla virtualizada (`useVirtual`); metrado con un clic, Enter baja, memoria de cantidades desplegable |
| `ApuEditor.tsx` | Editor del análisis (en el presupuesto y en el catálogo): rendimiento, jornada, cuadrillas, avisos |
| `ApuDialog.tsx` | Diálogo de una partida (datos, origen del metrado, EDT, análisis) |
| `CatalogoInsumos.tsx`, `CatalogoPartidas.tsx`, `ImportarDialog.tsx`, `ListaInsumos.tsx`, `GastosGenerales.tsx`, `PieDialog.tsx`, `ConfigDialog.tsx`, `ColumnasMemoria.tsx` | Ventanas del encabezado |
| `AlCatalogo.tsx` | "📚 Al catálogo" / "Guardar en el catálogo" |
| `AsistenteIA*.tsx` | Asistente IA por pestañas |
| `Programacion.tsx`, `ProgramacionDialogs.tsx`, `Gantt.tsx`, `Edt.tsx`, `LineaBalance.tsx`, `useProgramacion.ts` | Programación |
| `Avance.tsx`, `useAvance.ts`, `PanelAvance.tsx` | Línea base, cortes, valor ganado; avance en el visor |
| `PanelVisor.tsx` | Panel del visor 3D: asociar elementos, medir, memoria, ver en 3D |
| `ui.tsx` | Tokens `C`, `Modal`, `Notice`, `NumInput`, `TextCommit`, `celdaActiva`, `useVirtual`, `message` |

## 6. Base de datos (Supabase)

Ver la tabla completa en el README ("Esquema de la base de datos"). Lo esencial:

- `presupuesto_config` (base de catálogos, editores, columnas de la memoria).
- Catálogos por `base_id` (proyecto dueño): `presupuesto_insumos`,
  `presupuesto_partidas` (APU en `componentes` jsonb), `presupuesto_omniclass`;
  código único por catálogo.
- `presupuesto_documentos` (el presupuesto como jsonb con `version`).
- `presupuesto_elementos` (IFCGUID + modelo + cantidad + memoria + `ejecutado`
  por partida), `presupuesto_mediciones`, vistas de resumen.
- `presupuesto_programacion`, `presupuesto_lineas_base` (una vigente, índice
  único parcial), `presupuesto_avance`.
- IA: `presupuesto_ia_cupos`, `presupuesto_ia_uso`, `presupuesto_ia_borradores`,
  funciones de gasto y resumen.
- RLS activado **sin políticas**: solo el servidor (clave de servicio) lee y
  escribe. Cada función nueva lleva su `grant` al rol de servicio.
- Compras tiene su propio archivo, `supabase/compras.sql` (tablas `compras_*`,
  roles y permisos, auditoría de solo inserción, funciones con bloqueo y triggers
  diferidos). No toca `presupuesto_*`: solo las lee.
- El JSON del presupuesto pasa por jsonb: **no conserva el orden de las claves**
  (por eso los borradores se comparan con un JSON canónico).

## 7. Permisos

| Acción | Quién |
|---|---|
| Ver presupuesto, catálogos y elementos | Cualquier miembro del proyecto |
| Editar presupuesto y programación, asociar elementos, líneas base, avance | Administradores del proyecto y **editores** elegidos en ⚙ Configuración |
| Editar catálogos | Administradores y editores del proyecto **dueño** de los catálogos (la base) |
| Usar el asistente IA | Administradores y editores del presupuesto |
| Fijar cupos IA y TRM | Administradores del **proyecto gestor** (`PRESUPUESTO_IA_PROYECTO_GESTOR`) |

Compras **no** usa estos permisos: tiene su propia matriz módulo × acción con 9
roles, accesos con vigencia y auditoría de denegaciones (ver `compras.md`).

En la interfaz: `estado.canEdit` (presupuesto) y `estado.canEditBase` (catálogo);
`estado.esBasePropia` dice si el catálogo es del mismo proyecto.

## 8. Variables de entorno (solo en Vercel)

`SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PRESUPUESTO_IA_PROVEEDOR`,
`PRESUPUESTO_IA_PROYECTO_GESTOR`, `PRESUPUESTO_IA_MODELO`,
`PRESUPUESTO_IA_MODELO_RESPALDO`, `PRESUPUESTO_IA_TRM`. Validación puede usar
Upstash (`KV_REST_API_URL`/`TOKEN`). Nunca escribas sus valores en el repositorio.
