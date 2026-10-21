# Control de Obra — plan de actas (mediciones, actas, calidad, almacén y costo real)

Aprobado por el dueño el 21-10-2026 ("ok" al plan con todas las propuestas).
Reemplaza las fases 4 a 8 de `diseno.md`; la base construida (empresas,
licencias, roles, estructura de obra, bitácora) se conserva tal cual.

## Decisiones

| # | Decisión |
|---|---|
| A | Todo va **dentro de la extensión Control de Obra que ya existe** (`/control-obra`, `obra_*`, multiempresa con licencias), no en una extensión nueva. |
| D1 | **Cambia:** Presupuesto **lee** las mediciones de las actas aprobadas como fuente de su avance (cortes, elementos ejecutados, valor ganado), siempre preguntando antes de reemplazar lo escrito. Control de Obra sigue sin escribir en `presupuesto_*`. |
| D9 | **Cambia:** el costo real = vales de salida al precio de su orden de compra + actas de subcontrato aprobadas. Sin nómina, equipos ni contabilidad. Los costos a mano quedan fuera. |
| 2 | El pie del presupuesto se aplica **tal cual** al costo directo del acta al cliente (mismas fórmulas del subpresupuesto). Hoy los pies son los de referencia (PGG, UTI 10 %, IGV 18 %): el dueño los cambia a AIU en Presupuesto (A, I, U, IVA = U × 0.19). |
| 3 | Una medición queda **aprobada** cuando se aprueba el acta al cliente que la incluye. De ahí salen los borradores de acta de cada subcontratista (con su propio flujo) y el avance. |
| 4 | Amortización del anticipo = % de anticipo del contrato × valor bruto del acta, con tope en el saldo del anticipo; base sin IVA. Compras no registra el giro: se da por girado. |
| 5 | IVA del acta de subcontrato: el `iva_pct` de cada línea del contrato. En el acta al cliente, IVA solo sobre la U. |
| 6 | Cliente, NIT, % de anticipo y % de retención del contrato con el cliente: en la configuración del proyecto, por defecto 0. |
| 7 | Desde el visor solo se miden elementos asociados a esa partida en Presupuesto (cantidad = `presupuesto_elementos.cantidad`). Si no: "asócialo en Presupuesto o mídelo a mano". |
| 8 | Medición sin subcontrato: "obra propia", no genera acta de subcontrato. |
| 9 | Además de "quien elabora no aprueba", una persona firma un solo paso del mismo documento. |
| 10 | Medición a mano en partida con inspección: exige inspección aprobada de esa partida en esa ubicación; una NC abierta en esa ubicación bloquea esas líneas. |
| 11 | Vale de salida: flujo almacenista → residente; cada línea dice de qué orden de compra sale (por defecto la más antigua con existencias). |
| 12 | Partida desactivada en Presupuesto: sigue sumando en el presupuesto y no admite mediciones nuevas. |
| 13 | Las actas entran en el grupo de licencia "Mediciones, actas y avance físico"; el almacén es un grupo nuevo. Permisos solo se agregan (nunca se quitan de la lista). Roles nuevos Interventoría y Almacenista; a los roles existentes se les **ofrecen** los permisos nuevos. |
| 14 | Del diseño anterior quedan para después: versiones de modelo e incidencias de GUID; criterios, lotes, muestras, ensayos y aceptación de elementos; costos a mano; valor ganado propio. |
| 15 | Presupuesto muestra las cantidades aprobadas a quien ve Presupuesto (sin precios ni contratos). |
| 16 | Mayor cantidad en subcontratos: se permite, marcada y con motivo, para tramitar el otrosí en Compras. |
| 17 | Quien tenga permiso de ver actas de subcontrato en Control de Obra ve sus precios aunque no tenga acceso a Compras. |

## Lo que se lee de Presupuesto y de Compras (solo GET)

Lectores neutros en `lib/lecturas/` (llevar ahí `lib/compras/presupuestoLectura.ts`
sin cambiar su comportamiento, Compras queda reexportando); cada uno con una
prueba que falla si envía algo que no sea GET.

- `presupuesto_documentos.data`: partidas, APU, precios, subpartidas, pie y
  gastos → `calcularApu`, `consumoDeApu` (coeficiente por unidad), `calcularPie`.
- `presupuesto_mediciones` + `presupuesto_resumen_elementos` → `metradosDelModelo` (contratado 3D).
- `presupuesto_elementos` (`item_id`, `ifc_guid`, `model_id`, `cantidad`) → medición desde el visor.
- `presupuesto_config` (columnas de la memoria) y `presupuesto_programacion`
  (nodos de la EDT con filtro de ubicación) → sugerir ubicaciones.
- `compras_ordenes` (contratos aprobados: número, proveedor, `anticipo_pct`,
  `retencion_garantia_pct`, `revision`), `compras_orden_lineas`,
  `compras_requisicion_lineas.partida_item_id`, `compras_proveedores`,
  `compras_recepciones` + `compras_recepcion_lineas` (aprobadas).
- Las líneas de las órdenes se borran y recrean al guardar: todo se liga por
  `requisicion_linea_id`, y cada acta copia precio y revisión del contrato.

## Cambios en Presupuesto (fase 5, autorizados solo para esto)

1. `lib/presupuesto/lecturaControl.ts` (solo GET) de las vistas
   `obra_avance_aprobado`, `obra_elementos_aprobados`, `obra_partidas_protegidas`.
2. `servicioAvance.ts`: `avanceControlObra(ctx, hasta)`; `service.ts`
   `guardarDocumento`: 409 `partida-con-actas` si desaparece una partida protegida.
3. Rutas GET `app/api/presupuesto/avance/control-obra` y
   `app/api/presupuesto/partidas-protegidas`, con sus métodos en `client.ts`.
4. `avance.ts`: `pctDesdeControl(...)` pura con pruebas (ubicación de la EDT
   comparada sin tildes ni mayúsculas).
5. `Avance.tsx`: botón "Leer de Control de Obra al DD-MM-AAAA" con el diálogo
   de diferencias y confirmación del modelo.
6. `PanelAvance.tsx`: fuente de colores "Marcas de Presupuesto" o "Control de
   Obra" (solo lectura).
7. `PresupuestoApp.tsx`: eliminar algo con partidas protegidas → aviso y
   "Desactivar".
8. `ItemPartida.inactiva?: { fecha, por, motivo }` (tipos, validación, grilla en gris).
9. `presupuesto_guardar`: rechaza quitar una partida protegida si existe
   `obra_partidas_protegidas`.
10. README de Presupuesto.

## CDE y visor sin duplicar ni acoplar

- `lib/cde/trimble.ts` (← `lib/compras/cde.ts`), `lib/cde/subida.ts` con la
  interfaz `PuertoDocumentos` (que `ComprasApi` ya cumple),
  `lib/cde/nombres.ts`, `components/cde/DocumentosRegistro.tsx` genérico.
  Compras queda con reexportaciones y sus pruebas intactas. Tablas propias
  `obra_documentos`, `obra_cde_carpetas`, `obra_sync_historial`; carpeta
  `Control de Obra/` en el CDE.
- Visor: `public/manifest-control-obra-visor.json`,
  `app/control-obra/visor/page.tsx` con `ControlObraShell` en modo visor;
  se importan `readSelection`, `MapaGuids`, `selector` sin cambiarlos;
  colores con `viewer.setObjectState`; tarea de un solo uso `obra_vistas`.

## Fases

Cada fase: lógica pura con pruebas, servicio con `memoryStore`, SQL
re-ejecutable probado dos veces con PGlite (con escrituras directas a las
tablas), página temporal en el navegador, README, commit y push a `main`,
despliegue. El dueño ejecuta el SQL.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Roles nuevos (Interventoría, Almacenista), módulos de actas y almacén, flujos de aprobación configurables (`obra_flujos`, `obra_aprobaciones`, `obra_guardar_flujo`, `obra_flujo_accion`), pestaña Flujos de aprobación | Hecha (21-10-2026) |
| 2 | Ubicaciones (de la estructura de obra; "Traer de la EDT") y mediciones (`obra_mediciones`, `obra_medicion_elementos`, `obra_medicion_lineas`), regla del 100 % por elemento y partida (función con bloqueo + trigger diferido), primera versión del panel del visor | Hecha (21-10-2026). Ajuste: un valor de la estructura es único dentro de su valor superior (Piso 2 en cada torre) |
| 3 | CDE compartido, plantillas de chequeo, inspecciones, no conformidades (abierta → en corrección → por verificar → cerrada / reabierta), "requiere inspección para pagar" | |
| 4 | Actas al cliente y de subcontratistas, copias congeladas, avisos de cambios, mayor cantidad, PDF reproducible al CDE y Excel | |
| 5 | Enlace con Presupuesto (vistas SQL + cambios de arriba) | |
| 6 | Almacén: entradas de Compras, vales de salida, existencias, consumo teórico, real y desperdicio | |
| 7 | Costo real frente al presupuesto, por partida y capítulo | |
| 8 | Panel con indicadores y estados en el visor (verde aprobado, amarillo medido, rojo NC abierta); prueba de aceptación completa | |

## Prueba de aceptación

Partida 1.1 "Muro en bloque No. 5", 500 m2 a $ 95.000/m2; APU con SC-03
"Mano de obra muro" (1 m2/m2), contratada a Pedro Pérez en CT-0001 a
$ 28.000/m2 con anticipo 20 % y retención 5 %, y bloque (12,5 und/m2). En la
quincena se miden 80 m2 en el Piso 2 desde el modelo (12 muros, uno al 50 %)
y 15 m2 a mano de un antepecho. La partida exige inspección: 2 muros con NC
abierta (plomo) no entran al acta. Flujo residente → director →
interventoría, que la devuelve una vez y vuelve al director. Del acta
aprobada: acta al cliente con AIU, acta de Pedro Pérez con amortización y
retención, avance en Presupuesto, consumo teórico de bloque frente a los
vales del Piso 2 y costo real. Una persona del proyecto sin rol recibe 403
en pantalla y en la API.
