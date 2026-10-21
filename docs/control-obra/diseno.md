# Control de Obra — Fase 2: diseño

Fecha: 20-10-2026. Acompaña a `docs/control-obra/diagnostico.md`.

**Versión 2**, contrastada con el documento "CONTROL DE OBRA — Documento de
definición funcional, técnica y de implementación", versión 1.0 (octubre de
2026). Lo que cambió respecto a la versión 1 por el documento se marca con
**(doc §N)**, donde N es la sección del documento. El dueño aprobó el diseño y
las decisiones D1 a D13 el 20-10-2026 ("de acuerdo y sigue con la Fase 3").

> **21-10-2026:** el dueño aprobó el **plan de actas**
> ([`plan-actas.md`](plan-actas.md)), que reemplaza las fases 4 a 8 de este
> diseño y cambia D1 (Presupuesto lee las actas aprobadas como fuente de su
> avance) y D9 (costo real = vales de salida + actas de subcontrato). Lo
> demás de este documento sigue como referencia; donde choque, manda el plan.

## Contenido

1. Decisiones del dueño
2. Principios
3. Dónde va cada cosa
4. Datos: tablas, columnas y restricciones
5. Unidades y conversiones
6. Reglas de cálculo (funciones puras con pruebas)
7. Estados de cada registro
8. Roles y matriz de permisos
9. Contratos de datos con Presupuesto, Compras y Propiedades
10. API
11. Pantallas, filtros y reportes
12. Plan de pruebas
13. Criterios de aceptación del documento y en qué fase se cumplen

## 1. Decisiones del dueño

D1 a D13 **aprobadas por el dueño el 20-10-2026** (todas las recomendaciones;
D10 a D13 salieron del documento).

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Control de Obra escribe en los cortes de avance de Presupuesto? | **Aprobada: no.** Calcula su propio valor ganado con las cantidades **aceptadas**, la misma línea base y las mismas funciones. Más adelante, si quieres, un botón en Presupuesto "Leer de Control de Obra" que pregunta antes de reemplazar. |
| D2 | ¿Seguridad con RLS por empresa (opción A) o autorización en el servidor con claves compuestas (opción B)? | **Aprobada: B** (ver diagnóstico, sección 5). El documento pide "RLS y privilegios SQL adecuados" (doc §11): se cumple con RLS activado y cerrado, privilegios mínimos por tabla y permisos revisados también dentro de las funciones SQL. |
| D3 | ¿Cómo se reconoce al administrador técnico del producto? | **Aprobada:** variable `CONTROL_OBRA_ADMINS` en Vercel con IDs de usuario de Trimble. |
| D4 | ¿Quien reporta una cantidad puede verificarla? ¿Quien registra un ensayo puede aprobarlo? | **Aprobada: no**, como en Compras ("quien elabora no aprueba"). |
| D5 | ¿Fotos y soportes en el CDE o en Supabase Storage? | **Aprobada: CDE**, carpeta "Control de Obra/" del proyecto. |
| D6 | ¿"Bitácora" es solo auditoría o también diario de obra? | **Aprobada:** Fase 3 auditoría. El documento (doc §4.8, §8) describe solo la **bitácora de auditoría**; el diario de obra no aparece, así que queda fuera salvo que lo pidas. |
| D7 | ¿Licencias a mano o venta en línea? | **Aprobada: a mano** en esta etapa. |
| D8 | ¿Un rol por persona y proyecto? | **Aprobada: uno**, más las marcas "administrador de empresa" y "administrador de proyecto" (doc §10.1). |
| D9 | ¿Costos reales a mano o importados? | **Aprobada: a mano y por Excel**, cada uno con su fuente. |
| D10 | El documento pide "distinguir el almacenamiento en CDE de una copia de seguridad independiente" (doc §9). ¿Qué copia independiente? | **Aprobada:** en la Fase 7, botón "Descargar expediente" que baja en un .zip los archivos respaldados de un periodo o un registro, con un índice en Excel (proyecto, archivo, versión, huella, registro asociado), para guardarlo donde la empresa decida. La interfaz nunca dice "copia de seguridad" de lo que solo está en el CDE. Copia automática a otro proveedor (Drive, S3…): después, si la pides. |
| D11 | El documento pide "migraciones versionadas" (doc §11). El repositorio usa un solo `.sql` re-ejecutable por extensión. | **Aprobada:** mantener **un archivo re-ejecutable** (`supabase/control-obra.sql`, como las demás) dividido en bloques numerados, y una tabla `obra_migraciones` donde cada bloque deja constancia de su número y fecha al ejecutarse. Así sabes qué versión tiene la base sin cambiar la forma de trabajar. |
| D12 | "Aceptado con observaciones, si el procedimiento lo permite" (doc §7.4). | **Aprobada:** opción por proyecto, **apagada** por defecto; la enciende el administrador del proyecto y queda en la bitácora. |
| D13 | El documento sugiere 8 roles (doc §10.1). La versión 1 del diseño agregaba responsable técnico de calidad, laboratorio y control documental. | **Aprobada:** los roles iniciales son **los del documento** (director de proyecto, residente de obra, profesional de costos, inspector de calidad, auditor) **más** "responsable técnico de calidad" (lo exige la regla de que los criterios los aprueba un responsable técnico) y "laboratorio". Control documental queda como rol que la empresa crea si lo necesita. |

## 2. Principios

- **Del modelo solo se lee.** Nada va a Property Sets ni UDA. Todo lo propio va a
  Supabase, ligado al elemento por **IFCGUID + archivo del modelo + versión**.
  El IFCGUID **relaciona** el registro con el elemento, pero cada inspección,
  medición o costo tiene **su propio identificador** (doc §5).
- **Presupuesto y Compras son solo lectura** para Control de Obra, con contratos
  de datos escritos (sección 9; doc §3).
- **Nada se borra** cuando tiene valores: se desactiva o se anula con motivo.
  Los ajustes no sobrescriben el historial (doc §6.2).
- **Nada se sobrescribe en silencio**: si lo nuevo pisa lo escrito por una persona
  o hay valores distintos, se muestra la diferencia y se pregunta.
- **La empresa la deduce el servidor** a partir del proyecto; nunca la manda el
  navegador.
- **Permisos en el servidor y en la base de datos** (doc §10.2): el servicio
  revisa el permiso, y las funciones SQL que escriben lo vuelven a revisar con
  `obra_permisos_de(...)`. Permisos y licencia **no se guardan en caché**: se
  consultan en cada petición, así una revocación o una licencia vencida corta el
  acceso de inmediato.
- Fechas visibles DD-MM-AAAA; "hoy" es el día de Bogotá.
- Cantidades a 4 decimales y montos a 2, con `fmt()` (284,571.31).
- Toda tabla nueva: RLS activado sin políticas, `revoke all` a `anon` y
  `authenticated`, y solo los `grant` necesarios al rol de servicio.
- `supabase/control-obra.sql` re-ejecutable: `create … if not exists`,
  `create or replace`, `add column if not exists`; ningún `drop` de algo con
  datos.

## 3. Dónde va cada cosa

```
app/control-obra/page.tsx                  menú del proyecto
app/control-obra/visor/page.tsx            panel del visor 3D
app/api/control-obra/**/route.ts           handle(req, ctx => …) + readJson(req)
lib/control-obra/routes.ts                 handle(): projectId, token, resolveCaller, empresa, licencia, rol → Alcance
lib/control-obra/service*.ts               reglas y permisos por módulo
lib/control-obra/validate.ts               todo lo que llega del navegador
lib/control-obra/store.ts                  PostgREST con clave de servicio; memoryStore() en pruebas
lib/control-obra/<regla>.ts + .test.ts     cálculos puros (unidades, avance, costos, indicadores, criterios, aceptación…)
lib/control-obra/client.ts                 API del navegador
components/control-obra/                   pantallas (tokens y controles de components/presupuesto/ui.tsx)
supabase/control-obra.sql                  tablas, funciones, triggers (bloques numerados, D11)
public/manifest-control-obra.json          menú del proyecto
public/manifest-control-obra-visor.json    panel del visor
public/icon-control-obra.svg
```

Se reutilizan sin copiar: `resolveCaller`, `MapaGuids`, `readSelection`,
`resolveIfcGuid`, `Medidor`/`indicadores`, `medidaDeUnidad`, `lib/compras/cde.ts`,
`lib/compras/subida.ts`, `estadoLicencia`, `ui.tsx`. Si alguna necesita un cambio
para servir a las dos extensiones, se dice antes de tocarla.

## 4. Datos

Prefijo de todas las tablas: **`obra_`**. Columnas comunes que no se repiten en
cada tabla de abajo: `creado timestamptz default now()`, `creado_por text`,
`actualizado timestamptz`, `actualizado_por text`, y en lo editable
`version integer default 1` (versión optimista, 409 `version-conflict`).

**Regla de aislamiento:** toda tabla de proyecto lleva `empresa_id uuid not null`
y `project_id text not null`, y sus claves foráneas son **compuestas**:
`(empresa_id, project_id, <padre>_id) references <padre> (empresa_id, project_id, id)`.
Cada tabla padre tiene `unique (empresa_id, project_id, id)` para permitirlo. Así
PostgreSQL impide mezclar registros de dos empresas o de dos proyectos.

### 4.1 Empresas, licencias y accesos (Fase 3)

**`obra_empresas`** — `id uuid pk`, `nombre text` (1-150), `nit text` (con dígito
de verificación, validado con `leerNit` de `lib/compras/proveedores.ts`),
`activa boolean`, `version`. Índice único por NIT cuando no está vacío.

**`obra_licencias`** — historial; cada cambio (activación, renovación,
suspensión, cambio de plan) es una **fila nueva**, nunca se edita una anterior
(doc §8, §15). `id uuid pk`, `empresa_id → obra_empresas`,
`evento ('activacion','renovacion','cambio','suspension','reactivacion')`,
`plan text`, `desde date`, `hasta date null` (sin fin), `max_proyectos integer > 0`,
`max_usuarios integer > 0`, `modulos text[]` (módulos habilitados, validados
contra la lista), `suspendida boolean`, `motivo text` (obligatorio en suspensión),
`soporte text` (nivel o contacto de soporte contratado, doc §15),
`otorgada_por text`. Vigente = la última fila de la empresa.
`check (hasta is null or hasta >= desde)`. Solo inserción (trigger). Estado con
`estadoLicencia` de Manuales: activa, por vencer (15 días), vencida, suspendida,
sin vencimiento. **Un módulo no habilitado en la licencia no aparece ni responde
en la API** (`modulo-no-contratado`).

**`obra_empresa_proyectos`** — `empresa_id`, `project_id`, `project_name`,
`activo boolean`, `vinculado_por`, `desvinculado_por`, `motivo`.
`primary key (empresa_id, project_id)`; **índice único `(project_id) where activo`**:
un proyecto activo pertenece a una sola empresa. Desvincular = `activo = false`
con motivo; los datos quedan.

**`obra_roles`** — por empresa: `id uuid`, `empresa_id`, `clave` (`^[a-z0-9_]{2,60}$`),
`nombre`, `descripcion`, `sistema boolean`, `activo boolean`, `permisos text[]`
con `check (permisos <@ obra_permisos_validos())`, `version`.
`unique (empresa_id, clave)`, `unique (empresa_id, id)`.

**`obra_usuarios`** — personas de la empresa: `empresa_id`, `user_id` (ID de
Trimble), `nombre`, `email`, `admin_empresa boolean`, `activo boolean`,
`desde date`, `hasta date null`, `otorgado_por`, `version`.
`primary key (empresa_id, user_id)`. El número de usuarios activos no supera
`max_usuarios` (función con bloqueo + trigger diferido).

**`obra_asignaciones`** — rol de una persona en un proyecto: `empresa_id`,
`project_id`, `user_id`, `rol_id`, `admin_proyecto boolean` (doc §10.1:
configura usuarios, estructura y permisos **de ese proyecto**), `desde`, `hasta`,
`activo`, `version`. `primary key (empresa_id, project_id, user_id)`;
FK `(empresa_id, project_id) → obra_empresa_proyectos`,
FK `(empresa_id, user_id) → obra_usuarios`, FK `(empresa_id, rol_id) → obra_roles`.

Reglas en función SQL con `pg_advisory_xact_lock('obra-accesos:'||empresa)` y en
el servicio (como Compras): nadie cambia su propia fila; **solo se dan permisos
que uno tiene** (nadie se eleva); siempre queda un administrador de empresa
vigente; el administrador de proyecto solo asigna dentro de su proyecto; nadie
cambia la licencia salvo el administrador técnico (que no está en la base: lo
dice la variable de entorno, y queda en la bitácora).

**`obra_bitacora`** — solo inserción, hash encadenado: `id bigint identity`,
`creado timestamptz`, `empresa_id uuid null` (null = acción del administrador
técnico sin empresa), `project_id text null`, `actor_id`, `actor_nombre`,
`accion` (1-60), `modulo`, `objeto_tipo`, `objeto_id`, `ifc_guid`, `file_id`,
`version_modelo`, `version_antes integer`, `version_despues integer`,
`cambios jsonb` (`{campo: [antes, después]}`), `motivo text`,
`evidencia_id uuid null` (documento de soporte, doc §8),
`resultado ('ok','denegado','error')`, `origen ('menu','visor','sistema')`,
`hash_anterior text`, `hash text not null`.
Trigger `before insert` que toma el último hash de la empresa (con bloqueo) y
calcula `hash = encode(digest(hash_anterior || fila_canónica, 'sha256'), 'hex')`.
Triggers `before update or delete` y `before truncate` que rechazan. Permisos:
`select, insert` al rol de servicio. Función `obra_bitacora_verificar(empresa)`.
Índices `(empresa_id, project_id, id desc)`, `(empresa_id, objeto_tipo, objeto_id)`.

**`obra_config`** — por proyecto: `empresa_id`, `project_id`, `responsable_tecnico_id`
(quien aprueba criterios), `carpeta_cde_id`, `tolerancia_verificacion numeric`
(diferencia entre reportado y verificado que exige motivo, 0 por defecto),
`permite_aceptado_con_observaciones boolean default false` (D12),
`ponderacion_avance ('valor_presupuestal')` (sección 6), `version`.

**`obra_consecutivos`** — `(empresa_id, project_id, tipo)` → último número (NC-0001,
INS-0001, MUE-0001, ENS-0001, LOT-0001).

**`obra_vistas`** — tarea de un solo uso para el visor (30 min), igual a
`presupuesto_vistas`: `(empresa_id, project_id, user_id)` pk, `tarea`, `datos jsonb`.

**`obra_migraciones`** (D11) — `bloque integer pk`, `descripcion`, `aplicado timestamptz`.

### 4.2 Estructura de obra (Fase 3 la configuración, Fase 4 el mapeo al modelo) — (doc §4.1, §5)

El documento pide filtrar y consultar por **empresa, proyecto, torre, etapa,
capítulo, actividad, paquete de trabajo, zona, nombre de zona, nivel, frente y
disciplina**, con jerarquías configurables por empresa y proyecto, y con
responsables, fechas, estados y reglas.

Para no crear fuentes paralelas (doc §3), cada nivel dice **de dónde sale**:

| Nivel | Fuente | Por qué |
|---|---|---|
| Capítulo | **Presupuesto**: subpresupuestos y títulos | Ya existe; es la estructura de costos |
| Actividad, paquete de trabajo | **Programación de Presupuesto**: actividades y nodos de la EDT (`NodoEdt` con responsable y ubicación, `lib/presupuesto/types.ts`) | Ya existe; es la WBS (decisión previa: costos ≠ WBS) |
| Torre, etapa, zona, nombre de zona, nivel, frente, disciplina y los que agregue la empresa | **Configurable**: propiedad del modelo, atributo de Propiedades (por IFCGUID, leído en vivo) o asignación a mano | Lo propio de Control de Obra |

**`obra_niveles`** — definición: `id`, `empresa_id`, `project_id null` (null =
plantilla de la empresa que heredan sus proyectos; con valor = cambio de ese
proyecto), `clave` (torre, etapa, zona, nombre_zona, nivel, frente, disciplina u
otra), `nombre`, `orden`, `padre_clave null` (p. ej. nivel dentro de torre),
`fuente ('modelo','propiedad','manual')` (con la misma forma que las columnas de
la memoria de Presupuesto: `fuente` + `clave_fuente`), `clave_fuente` (nombre de
la propiedad del modelo o id del atributo de Propiedades), `activo`.
`unique (empresa_id, coalesce(project_id,''), clave) where activo`.
Cambiar el mapeo queda en la bitácora (doc §8).

**`obra_nodos`** — los valores con su control: `id`, `nivel_id`, `valor`
("Torre 1", "Piso 5", "Zona norte"), `padre_id null`, `responsable_id`,
`inicio date`, `fin date`, `estado ('activo','cerrado','inactivo')`, `nota`.
`unique (empresa_id, project_id, nivel_id, lower(valor))`. Los valores que vienen
del modelo se crean solos al leer una versión (sin responsable hasta que alguien
lo asigne).

**`obra_elemento_niveles`** — solo para niveles de fuente `manual`:
`(elemento_id, nivel_id)` pk, `nodo_id`, `asignado_por`. Reasignar un elemento
que ya tenía otro valor **pregunta** (regla 2) y queda en la bitácora.

### 4.3 Modelos, versiones y elementos (Fase 4) — (doc §4.2, §15)

**`obra_modelos`** — `empresa_id`, `project_id`, `file_id`, `nombre`, `activo`.
pk `(empresa_id, project_id, file_id)`.

**`obra_modelo_versiones`** — una lectura de una versión: `id uuid`, `file_id`,
`version_id`, `revision integer null`, `leida timestamptz`, `leida_por`,
`elementos integer`, `sin_guid integer`, `duplicados integer`,
`estado ('completa','parcial')`, `alerta_estabilidad text null`.
`unique (empresa_id, project_id, file_id, version_id)`.

**`obra_elementos`** — la identidad del elemento para Control de Obra:
`id uuid`, `file_id`, `ifc_guid` (`^[0-3][0-9A-Za-z_$]{21}$`), `clase_ifc`,
`nombre`, `niveles jsonb` (valores leídos del modelo o de Propiedades:
`{clave_nivel: valor}`, con la versión de donde salieron), `primera_version`,
`ultima_version`, `estado ('vigente','no_esta_en_ultima')`.
`unique (empresa_id, project_id, file_id, ifc_guid)`.
Un elemento que desaparece de una versión **no se borra**: queda
`no_esta_en_ultima` y sus registros se ven con aviso; **nunca se reasignan solos
a otro elemento** (doc §4.2: sin asociaciones falsas).

**`obra_elemento_huellas`** — `(elemento_id, version_lectura_id)` pk, `huella text`
(SHA-256 de clase, nombre y cantidades leídas, en orden fijo), `cantidades jsonb`
(magnitud → valor en unidad base). Comparar las huellas de dos lecturas da
nuevos, eliminados y cambiados. Solo inserción.

**`obra_incidencias_guid`** — `id`, `file_id`, `version_id`, `runtime_id`,
`nombre`, `tipo ('sin_guid','guid_invalido','guid_duplicado','guid_de_propiedad')`,
`detalle`, `estado ('abierta','revisada','descartada')`, `revisada_por`, `nota`.
Un elemento con incidencia **no se asocia** a nada hasta revisarse.

**Calidad del IFCGUID** (doc §15): cada lectura mide disponibilidad (cuántos
elementos sin GUID), unicidad (duplicados dentro de la versión) y estabilidad
(contra la lectura anterior). Si en una versión desaparece una parte grande de
los GUID y aparece una cantidad parecida de nuevos, se marca
`alerta_estabilidad = 'posible reexportación con GUID nuevos'` y se avisa antes
de usar esa versión: **no se hace ningún emparejamiento automático**.

### 4.4 Cantidades, avance y costos (Fase 5) — (doc §4.3 a §4.5, §6)

**`obra_conversiones`** — `id`, `empresa_id`, `project_id null` (null = toda la
empresa), `de_unidad`, `a_unidad`, `factor numeric > 0`, `nota`, `aprobada_por`,
`activa`. `unique (empresa_id, coalesce(project_id,''), de_unidad, a_unidad) where activa`.
Ver sección 5.

**`obra_cantidades`** — un registro por elemento (o por ubicación si la partida
no tiene modelo) × partida × fecha:
`id uuid`, `clave_idempotencia uuid unique` (la genera el navegador por envío:
si la red repite el envío, no se duplica — doc §4.3), `partida_id text` (id del
ítem en el presupuesto; sin FK, ver diagnóstico 1), `actividad_id text null`
(de la programación, si hay EDT), `elemento_id uuid null → obra_elementos`,
`niveles jsonb` (ubicación por la estructura de obra cuando no hay elemento),
`fecha date` (fecha de corte del reporte), `periodo text` (p. ej. "2026-10"),
`unidad text` (la de la partida),
`fuente ('reporte','medicion','recepcion')` (doc §6.2; "modelo" y "presupuesto"
no son registros, se leen), `recepcion_ref uuid null` (recepción de Compras,
cuando la fuente es recepción), `cantidad_modelo numeric(18,4) null` +
`version_modelo text` (referencia, nunca ejecutado), `reportada numeric(18,4)`,
`reportada_por`, `verificada numeric(18,4) null`, `verificada_por`,
`verificada_en`, `motivo_diferencia text`, `aceptada numeric(18,4) null`,
`aceptada_por`, `aceptada_en`, `rechazada numeric(18,4) null`, `motivo_rechazo`,
`estado ('reportada','verificada','aceptada','rechazada','anulada')`,
`reemplaza_id uuid null` (un ajuste es un registro nuevo que dice a cuál
reemplaza; el anterior queda), `motivo_anulacion`, `version`.
Restricciones: `check (elemento_id is not null or niveles <> '{}')`;
`check (estado <> 'anulada' or btrim(motivo_anulacion) <> '')`;
`check (verificada_por is distinct from reportada_por)` (D4);
`check (aceptada is null or aceptada <= verificada)`;
`check (estado <> 'rechazada' or btrim(motivo_rechazo) <> '')`; si
`|verificada − reportada| > tolerancia`, motivo obligatorio (función).
**Doble reporte del mismo elemento, partida y fecha**: lo rechaza un índice único
`(empresa_id, project_id, partida_id, elemento_id, fecha) where estado <> 'anulada' and elemento_id is not null`;
para corregir se anula o se reemplaza. Concurrencia: versión optimista + bloqueo
por proyecto en la función.
Índices `(empresa_id, project_id, partida_id, fecha)`, `(empresa_id, project_id, elemento_id)`.

**Pendiente** (doc §6.1) no se guarda: se calcula según el indicador (por
ejecutar = presupuestada − aceptada; por aceptar = verificada − aceptada; por
verificar = reportada − verificada) y cada pantalla dice cuál usa.

**`obra_cortes`** — fotos congeladas del avance para informes: `id`, `fecha`
(fecha de corte), `linea_base_id uuid` (de `presupuesto_lineas_base`, sin FK
porque es de otra extensión; se valida al crear), `responsable_id`,
`estado ('borrador','cerrado','anulado')`, `resultado jsonb` (indicadores con su
regla y fuente), `metodologia text` (la regla de ponderación usada),
`evidencia_id null`, `cerrado_por`. Cerrado no cambia (trigger).
`unique (empresa_id, project_id, fecha) where estado <> 'anulado'`.

**`obra_costos`** — `id`, `tipo ('real','estimado','comprometido_externo')`,
`fuente ('manual','excel','nomina','factura','acta_pago','otro')`,
`referencia text` (número de factura, acta…), `fecha`, `periodo`,
`partida_id text null`, `actividad_id text null`, `insumo_clave text null`,
`capitulo text null`, `descripcion`, `valor numeric(18,2)`,
`iva numeric(18,2) default 0`, `moneda ('COP')`,
`documento_id uuid null → obra_documentos`, `estado ('vigente','anulado')`,
`reemplaza_id`, `motivo_anulacion`, `version`.
**Índice único `(empresa_id, project_id, fuente, lower(referencia)) where estado = 'vigente' and btrim(referencia) <> ''`**:
la misma factura no se registra dos veces. Lo comprometido en **órdenes y
contratos de Compras no se guarda aquí**: se lee en vivo de Compras; el tipo
`comprometido_externo` es solo para compromisos que no pasaron por Compras.

### 4.5 Calidad (Fase 6) — (doc §4.6, §4.7, §7)

**`obra_materiales`** — materiales configurables (doc §7.3): `id`, `codigo`,
`nombre` ("Concreto", "Acero de refuerzo", "Mampostería"…),
`atributos_lote jsonb` (campos que pide un lote de ese material: para concreto
especificación y resistencia requerida, ubicación de vaciado; para acero
fabricante y diámetros…), `documentos_obligatorios jsonb` (p. ej. certificado de
calidad, certificado de molino, remisión), `responsable_id`, `activo`.
Concreto y acero de refuerzo vienen como **plantilla editable sin valores
normativos**: los campos sí, los números de aceptación no.

**`obra_criterios`** — criterio de aceptación por proyecto, **nunca escrito en el
código**: `id`, `codigo`, `nombre` (p. ej. "Concreto 21 MPa — resistencia a 28
días"), `material_id → obra_materiales`, `tipo_ensayo` (lista configurable por
material), `unidad`, `parametros jsonb` (valor especificado, edad de ensayo,
número de especímenes por ensayo, límites individual y de promedio — los define
el responsable técnico citando su norma o contrato), `referencia_normativa text`,
`version_criterio integer`, `estado ('borrador','aprobado','reemplazado','inactivo')`,
`aprobado_por`, `aprobado_en`. Un criterio aprobado **no se edita**: se crea una
versión nueva y la anterior queda `reemplazado` (los ensayos viejos siguen
evaluándose con la versión con que se registraron). Solo aprueba el responsable
técnico del proyecto o quien tenga `criterios.aprobar`.

**`obra_lotes`** — `id`, `codigo` (LOT-0001), `material_id`, `descripcion`,
`proveedor text`, `fabricante text`, `remision text`, `fecha`,
`atributos jsonb` (según `obra_materiales.atributos_lote`: resistencia
especificada, diámetros…), `criterio_id → obra_criterios`,
`recepcion_ref uuid null` (recepción de Compras, si llegó por ahí),
`estado ('abierto','cerrado','anulado')`, `motivo_anulacion`. Los certificados
son documentos del lote (tipo `certificado`).

**`obra_lote_elementos`** — `(lote_id, elemento_id)` pk: dónde se vació o se
instaló ese lote (ubicación de vaciado, doc §7.1).

**`obra_muestras`** (doc §4.6, §7.1) — `id`, `codigo` (MUE-0001), `lote_id`,
`fecha_toma`, `tomada_por`, `cantidad_especimenes integer`,
`edades_programadas integer[]` (p. ej. 7, 14, 28), `ubicacion text`,
`elemento_id null`, `estado ('tomada','en_laboratorio','ensayada','anulada')`.

**`obra_ensayos`** — `id`, `codigo` (ENS-0001), `muestra_id` (o `lote_id` para
ensayos de recepción sin muestra, como acero), `criterio_id` +
`version_criterio` (congelados), `especimen text`, `edad_dias integer`,
`fecha_ensayo`, `resultado numeric(18,4)`, `unidad`, `laboratorio`,
`documento_id null`, `cumple boolean` (calculado por el servidor con la regla
pura, nunca enviado por el navegador), `estado ('registrado','aprobado','anulado')`,
`registrado_por`, `aprobado_por` (distinto, D4), `reemplaza_id`, `motivo_anulacion`.
**No se borran ni se editan** después de aprobados: se anulan con motivo.

**`obra_plantillas_inspeccion`** — lista de chequeo configurable: `id`, `nombre`,
`material_id null`, `items jsonb` (`[{id, texto, obligatorio, tipo: 'si_no'|'valor'|'foto'|'documento'}]`),
`version_plantilla`, `activa`. Como los criterios: no se editan, se versionan.

**`obra_inspecciones`** — `id`, `codigo` (INS-0001), `plantilla_id` + versión,
`tipo ('elemento','recepcion_material')`, `fecha`, `inspector_id`,
`actividad_id null`, `resultados jsonb` (por item: cumple / no cumple / no
aplica, valor, nota, evidencia),
`resultado ('aceptado','aceptado_con_observaciones','rechazado','requiere_correccion') null`,
`observaciones text`, `reinspeccion_de uuid null` (la inspección que esta repite),
`estado ('en_inspeccion','cerrada','anulada')`, `motivo_anulacion`.
`check (resultado <> 'aceptado_con_observaciones' or btrim(observaciones) <> '')`;
la opción con observaciones solo si el proyecto la permite (D12).
**`obra_inspeccion_elementos`** — `(inspeccion_id, elemento_id)`.

**Estado de inspección de un elemento** (doc §4.7, §7.4) — no se guarda, se
deduce de sus inspecciones (sección 7): pendiente de inspección, en inspección,
aceptado, aceptado con observaciones, rechazado, requiere corrección,
reinspección pendiente.

**`obra_no_conformidades`** — `id`, `codigo` (NC-0001),
`origen ('ensayo','inspeccion','manual')`, `origen_id`, `descripcion`,
`severidad ('menor','mayor','critica')`, `accion_correctiva`, `responsable_id`,
`fecha_limite`, `estado ('abierta','en_tratamiento','cerrada','anulada')`,
`cerrada_por`, `evidencia_cierre_id → obra_documentos`, `motivo`.
**`obra_nc_elementos`** — `(nc_id, elemento_id)`.

**`obra_aceptaciones`** — aceptación de un elemento: `id`, `elemento_id`,
`inspeccion_id`, `fecha`, `aceptado_por`, `con_observaciones boolean`,
`requisitos jsonb` (la foto de lo que se comprobó al aceptar),
`estado ('vigente','revocada')`, `motivo_revocacion`.
`unique (empresa_id, project_id, elemento_id) where estado = 'vigente'`.
Una función SQL con bloqueo **rechaza** la aceptación si el elemento tiene un
requisito obligatorio pendiente (item obligatorio sin cumplir, documento
obligatorio sin respaldar), un ensayo que no cumple sin NC cerrada, o una NC
abierta; el trigger lo vuelve a revisar si alguien escribe directo en la tabla.
Revocar pide motivo; nunca se borra.

### 4.6 Documentos en el CDE y sincronización (Fase 7) — (doc §4.9, §9)

**`obra_cde_carpetas`** y **`obra_documentos`** — copia del diseño de Compras
(`compras_cde_carpetas`, `compras_documentos`):
`entidad_tipo ('cantidad','corte','costo','lote','muestra','ensayo','inspeccion','nc','aceptacion','elemento')`,
`entidad_id`, `tipo_doc` (acta, ensayo, certificado, foto, informe, soporte…,
lista configurable), nombre de archivo fijo (un reintento nunca crea otro),
`tamano` (≤ 100 MB), `sha256`,
`estado ('pendiente','respaldado','error','anulado')` (en pantalla:
pendiente, **sincronizado en el CDE**, fallido, anulado — doc §9),
`file_id`, `version_id`, `confirmado`, `intentos`, `ultimo_error`,
`reemplaza_id null` (reemplazo de un documento: el anterior queda, doc §8).
`check (estado <> 'respaldado' or (file_id is not null and version_id is not null and confirmado is not null))`
y trigger "sin retroceso".

Antes de crear nada, "Revisar en Trimble" lee la estructura de carpetas que ya
existe y no crea nada (doc §9: no duplicar carpetas); "Preparar carpetas" pide
confirmación y crea solo lo que falta: `Control de Obra/` con Calidad/Ensayos,
Calidad/Inspecciones, Calidad/No conformidades, Calidad/Certificados,
Cantidades y avance, Costos, Informes.

**`obra_sync_historial`** (doc §11: sincronización) — solo inserción: cada
intento de subida, confirmación o reintento con su resultado, sin URLs firmadas.

## 5. Unidades y conversiones

- **Magnitudes**: longitud, área, volumen, masa, conteo (de `medidaDeUnidad`).
  Una unidad que no se reconoce queda "sin magnitud" y **no se suma con nada**.
- **Del modelo**: el visor da longitud en **mm**, área en m², volumen en m³, masa
  en kg. Se guardan en la unidad base (m, m², m³, kg) y se dice la propiedad de
  donde salieron.
- **Conversiones fijas** (exactas): mm ↔ cm ↔ m, kg ↔ t. Entre magnitudes
  distintas (m² y m³, m³ y kg) no hay conversión fija. Viven en el código con
  prueba.
- **Conversiones del proyecto** (p. ej. "1 bulto = 50 kg"): solo si están en
  `obra_conversiones`, con quién las aprobó (doc §4.3: conversiones permitidas).
  Sin conversión definida, una suma de unidades distintas da **"no se puede
  sumar: m³ y kg"**, nunca un número.
- Redondeo: se calcula sin redondear y se muestra a 4 decimales (cantidades) y 2
  (montos), con `redondear` de `calc.ts`.

## 6. Reglas de cálculo

Cada una en una función pura de `lib/control-obra/` con su `*.test.ts`
(`node:test` + `assert/strict`, nombres en español, datos inline).

**Todo indicador** devuelve `{ valor | null, numerador, denominador, unidad,
fechaCorte, periodo, alcance, fuente, regla }` (doc §4.5, §7.5, §12). Sin datos →
`null` y "Sin datos suficientes", nunca un cero inventado.

| Función (nombre previsto) | Regla |
|---|---|
| `sumarCantidades(items, conversiones)` | Agrupa por magnitud; convierte solo con conversión fija o definida; si queda más de una magnitud, devuelve el error y las partes, no un total. |
| `estadoCantidad(registro)` | La cantidad del modelo es referencia; solo la verificada cuenta como ejecutada verificada y solo la aceptada entra al valor ganado. Cada cifra dice su fuente: modelo, presupuesto, reporte de obra, medición o recepción (doc §6.2). |
| `pendientes(partida)` | Por ejecutar, por verificar y por aceptar (sección 4.4), con su fórmula. |
| `avanceDePartida(partida, registros)` | Dentro de una partida (cantidades **homogéneas**, misma unidad): % = cantidad (reportada, verificada o aceptada) ÷ cantidad presupuestada. |
| `avanceGlobal(lineaBase, avances, fecha)` | Entre partidas: ponderación por **valor presupuestal** de la línea base: % = Σ (costo de la partida × % de la partida) ÷ Σ costo = EV ÷ BAC, con `Medidor`. Se calcula cuatro veces: planificado, reportado, verificado y aceptado (doc §4.5). **Nunca** promedio simple de porcentajes. Solo se suman cantidades sin ponderar cuando todas tienen la misma magnitud (doc §6.2: "cantidades homogéneas"). |
| `costos(presupuesto, lineaBase, compras, costos, avance)` | **Presupuesto base** = BAC de la línea base vigente. **Presupuesto vigente** = total del presupuesto guardado hoy. **Planificado** = PV a la fecha de corte. **Comprometido** = Compras + `comprometido_externo`. **Real** = AC (facturas, actas, nómina). **Estimado** = registros de tipo estimado. Las columnas no se mezclan ni se suman entre sí. |
| `desviaciones(...)` | CV = EV − AC; CPI = EV ÷ AC (solo partidas con costo real); variación contra el presupuesto vigente = vigente − base; **costo unitario real** = costo real ÷ cantidad aceptada (misma unidad; si no, "no se puede calcular"). |
| `proyeccion(...)` | EAC = BAC ÷ CPI (la de `avance.ts`), mostrando la fórmula; si no hay CPI, "Sin datos suficientes". Otras fórmulas (EAC = AC + (BAC − EV)) solo si el dueño las elige (doc §15: metodología por acordar; propuesta por defecto la existente). |
| `sinDobleConteo(fuentes)` | No suma lo que ya está en otra fuente: una línea de costo con la misma fuente y referencia se cuenta una vez; lo de Compras nunca se copia. |
| `evaluarEnsayos(ensayos, criterio)` | Evalúa cada ensayo y cada grupo según los parámetros del criterio aprobado. Devuelve el promedio **junto al criterio** y la lista de ensayos y lotes que **no cumplen**; un promedio que cumple nunca oculta un ensayo que no (doc §7.5). |
| `estadoInspeccion(inspecciones)` | Sección 7. |
| `puedeAceptar(elemento, requisitos, ensayos, inspecciones, ncs, documentos)` | Lista de pendientes; vacía = se puede aceptar. Obligatorios pendientes, documentos obligatorios sin respaldar, ensayos que no cumplen o NC abiertas bloquean. |
| `estadoDocumento(doc)` | "Sincronizado en el CDE" solo con `fileId` + `versionId` confirmados por Trimble; si no, pendiente o fallido con reintento. |
| `clasificarGuid(resolucion)` | Usa `resolveIfcGuid`: sin GUID, GUID inválido o duplicado en la misma versión → incidencia, no se asocia. |
| `compararVersiones(huellasA, huellasB)` | Nuevos, eliminados, cambiados (huella distinta), sin cambio, y alerta de estabilidad. |
| `diferenciaQuePregunta(actual, nuevo)` | Si lo nuevo pisa un valor escrito por una persona, devuelve la diferencia para mostrarla y preguntar. |

## 7. Estados de cada registro

| Registro | Número | Estados |
|---|---|---|
| Cantidad | — | reportada → verificada → aceptada; rechazada (con motivo); anulada (con motivo); ajuste = registro nuevo que reemplaza |
| Corte de Control de Obra | — | borrador → cerrado; anulado |
| Costo | — | vigente; anulado |
| Criterio | — | borrador → aprobado → reemplazado / inactivo |
| Lote | LOT-0001 | abierto → cerrado; anulado |
| Muestra | MUE-0001 | tomada → en laboratorio → ensayada; anulada |
| Ensayo | ENS-0001 | registrado → aprobado; anulado |
| Inspección | INS-0001 | en inspección → cerrada con resultado (aceptado, aceptado con observaciones, rechazado, requiere corrección); anulada |
| Elemento (inspección) | — | **pendiente de inspección** (sin inspecciones) → **en inspección** (una abierta) → **aceptado** / **aceptado con observaciones** / **rechazado** / **requiere corrección**; tras corregir → **reinspección pendiente** → en inspección… (doc §7.4) |
| No conformidad | NC-0001 | abierta → en tratamiento → cerrada; anulada |
| Aceptación de elemento | — | vigente; revocada |
| Documento | — | pendiente → sincronizado (o fallido → reintento); anulado; reemplazado |
| Licencia | — | activa, por vencer, vencida, suspendida, sin vencimiento |

Todo con versión optimista; anular, rechazar y revocar piden motivo; todo deja
fila en la bitácora.

## 8. Roles y matriz de permisos

Niveles de administración (doc §10.1), separados de los permisos operativos
(doc §10.2):

- **Administrador técnico del producto** (`CONTROL_OBRA_ADMINS`): crea empresas,
  activa, renueva y suspende licencias, habilita módulos, nombra el primer
  administrador de cada empresa, ve la bitácora de cualquier empresa. No edita
  datos de obra.
- **Administrador de empresa** (`obra_usuarios.admin_empresa`): gestiona usuarios,
  roles y permisos de su empresa, vincula proyectos (siendo además ADMIN del
  proyecto en Trimble). No cambia su propia fila ni la licencia.
- **Administrador de proyecto** (`obra_asignaciones.admin_proyecto`): configura
  usuarios, estructura de obra y permisos **de su proyecto**, con los roles que
  ya existen en la empresa.

Roles iniciales por empresa (D13; editables salvo administración; se
desactivan, no se borran):

| Clave | Rol | Del documento |
|---|---|---|
| DIR | Director de proyecto | Sí |
| RES | Residente de obra | Sí |
| COS | Profesional de costos | Sí |
| INS | Inspector de calidad | Sí |
| AUD | Auditor | Sí |
| RTC | Responsable técnico de calidad | Agregado (aprueba criterios) |
| LAB | Laboratorio | Agregado (registra muestras y ensayos) |

Acciones: **V** ver · **C** crear o reportar · **E** editar borradores ·
**F** verificar · **A** aprobar o aceptar · **N** anular o revocar ·
**D** adjuntar documentos · **X** exportar · **M** administrar (configurar).

| Módulo | DIR | RES | COS | INS | AUD | RTC | LAB |
|---|---|---|---|---|---|---|---|
| Panel de control | V | V | V | V | V | V | V |
| Estructura de obra y configuración del proyecto | V | V | V | V | V | V | — |
| Modelos, versiones e incidencias de GUID | V F | V C | V | V F | V | V | — |
| Cantidades | V F A N X | V C E D X | V X | V F D X | V X | V | — |
| Avance físico (cortes) | V A N X | V C E D X | V C E X | V X | V X | V | — |
| Costos (real, estimado, comprometido externo) | V A N X | V | V C E N D X | — | V X | — | — |
| Materiales y criterios de aceptación | V | V | — | V | V | V C E A N M | V |
| Lotes y muestras | V | V C E N D | — | V C E D | V | V A | V C E D |
| Ensayos | V X | V | — | V F | V X | V A N X | V C E D X |
| Inspecciones | V X | V C E D | — | V C E F A N D X | V X | V M | — |
| No conformidades | V A N X | V C E D | — | V C E D X | V X | V C E A N D X | V C |
| Aceptación de elementos | V A N | V | — | V A N | V | V A N | — |
| Documentos y CDE | V D | V D | V D | V D | V | V D | V D |
| Reportes | V X | V X | V X | V X | V X | V X | — |
| Bitácora | V | — | — | — | V X | — | — |
| Accesos y roles del proyecto | V | — | — | — | V | — | — |

Notas:
- "M" de configuración del proyecto, accesos y estructura la tienen el
  administrador de empresa y el de proyecto, no un rol operativo.
- La aceptación de elementos siempre exige que `puedeAceptar` dé la lista vacía,
  tenga quien tenga el permiso; y quien reportó o registró no verifica ni
  aprueba lo suyo (D4), aunque su rol lo permita.
- La exportación respeta los permisos: un reporte solo trae lo que el usuario
  puede ver (doc §12).
- La lista de permisos válidos vive en código (`PERMISOS_VALIDOS`) y en SQL
  (`obra_permisos_validos()`), con una prueba que verifica que coinciden.

## 9. Contratos de datos con Presupuesto, Compras y Propiedades

Control de Obra solo **lee** estas tablas, con estos campos; si cambian en otra
extensión, una prueba de contrato falla (doc §3).

| Fuente | Qué se lee | Para qué |
|---|---|---|
| `presupuesto_documentos.data` + `presupuesto_mediciones` | Subpresupuestos, títulos, partidas (id, descripción, unidad, metrado, precio), calculados con `calcularSubpresupuesto` | Capítulos, cantidad presupuestada, presupuesto vigente |
| `presupuesto_programacion.data` | Nodos de la EDT y actividades con sus asignaciones | Actividad y paquete de trabajo |
| `presupuesto_lineas_base` (vigente o la elegida) | `TareaBase`: costo, fechas, horas, metrado | Presupuesto base, cantidad y costo planificados (PV) |
| `presupuesto_elementos` | IFCGUID, modelo, partida, cantidad del modelo, `ejecutado` | Referencia (nunca "verificado"); identidad propia en `obra_elementos` |
| `compras_ordenes`, `compras_orden_lineas` (no anuladas, aprobadas) | Insumo, cantidad, valor sin IVA | Costo comprometido |
| `compras_recepciones`, `compras_recepcion_lineas` (aprobadas) | Insumo, cantidad aceptada | Fuente "recepción" y lotes recibidos |
| `propiedades_valores` | Valor de un atributo por IFCGUID | Niveles de la estructura con fuente "propiedad" |

Lo que Control de Obra **expone** a otras extensiones (por ahora nada; si D1
cambia, Presupuesto leería las cantidades aceptadas por partida y fecha).

## 10. API

Todas bajo `app/api/control-obra/`, con `?projectId=` y `Authorization: Bearer`,
excepto las del administrador técnico (`/admin/...`, solo para IDs en
`CONTROL_OBRA_ADMINS`).

| Ruta | Métodos |
|---|---|
| `estado` | GET: empresa, licencia, módulos habilitados, mis permisos, mi ID de Trimble |
| `admin/empresas`, `admin/licencias`, `admin/administradores` | GET, POST (administrador técnico) |
| `empresa/proyectos`, `accesos`, `roles` | GET, POST |
| `config`, `estructura/niveles`, `estructura/nodos` | GET, PUT/POST (con versión) |
| `modelos`, `modelos/lecturas`, `elementos`, `incidencias` | GET, POST |
| `cantidades`, `cantidades/{id}/verificar`, `/aceptar`, `/rechazar`, `/anular` | GET, POST |
| `cortes`, `costos`, `conversiones` | GET, POST |
| `materiales`, `criterios`, `lotes`, `muestras`, `ensayos`, `inspecciones`, `nc`, `aceptaciones` | GET, POST, y acciones `/{id}/aprobar`, `/anular`… |
| `documentos`, `documentos/{id}/confirmar`, `/reintentar`, `/abrir`, `expediente` | GET, POST |
| `panel`, `reportes` | GET |
| `bitacora`, `bitacora/verificar` | GET |
| `vistas` | GET, POST (tarea para el visor) |

Errores como hoy: `{ error, code }`; `version-conflict` (409), `sin-acceso`,
`sin-permiso`, `licencia-vencida`, `licencia-suspendida`, `modulo-no-contratado`,
`cupo-proyectos`, `cupo-usuarios`, `otra-empresa`, `auto-aprobacion`,
`pendientes-aceptacion`, `unidades-incompatibles`, `duplicado`,
`trimble-session` (401). Ninguna operación con Trimble se da por exitosa sin su
confirmación (doc §14.12).

## 11. Pantallas, filtros y reportes — (doc §12)

Menú del proyecto (`/control-obra`), pestañas visibles según permisos y módulos
contratados, en el orden del documento:

1. **Panel de control** — indicadores con fecha de corte, alcance, fuente y regla.
2. **Proyectos y estructura de obra** — niveles, nodos, responsables, fechas, estados.
3. **Modelos 3D y elementos BIM** — modelos, lecturas de versión, comparación, incidencias de GUID.
4. **Cantidades y costos** — presupuestada, planificada, reportada, verificada, aceptada, rechazada, pendiente; costos base, vigente, planificado, comprometido, real, estimado.
5. **Avance físico** — cortes, planificado contra reportado, verificado y aceptado, con la metodología.
6. **Calidad, inspecciones y aceptación** — materiales, criterios, lotes, muestras, ensayos, inspecciones, aceptación.
7. **No conformidades**.
8. **Documentos y CDE** — pendientes de sincronizar, reintentos, expediente.
9. **Bitácora**.
10. **Administración y licenciamiento** — accesos y roles; para el administrador técnico, empresas y licencias.

**Filtros comunes** (doc §12): proyecto, torre, etapa, capítulo, actividad,
paquete de trabajo, zona, nivel, frente, disciplina, elemento, periodo y estado.

**Reportes** (Fase 5 cantidades, costos y avance; Fase 6 calidad; Excel y PDF):
cada uno con fecha de corte, alcance, fuentes y fórmulas en el encabezado.

**Panel del visor** (`/control-obra/visor`): seleccionar elementos y ver su ficha
(niveles, partidas, cantidades, lote, ensayos, inspecciones, NC, aceptación,
documentos); reportar cantidad; "Leer esta versión"; colorear por estado
(avance, inspección, aceptación) con leyenda y 8 colores fijos; ir desde un
registro hasta su elemento ("Ver en 3D", doc §5).

Mismo aspecto que Presupuesto y Compras: tokens y controles de
`components/presupuesto/ui.tsx`, `DateField` de Propiedades, fechas DD-MM-AAAA,
ayudas (`title`) que dicen la cuenta o la regla.

## 12. Plan de pruebas — (doc §13 Fase 2)

En cada fase, antes de subir:

1. **Reglas puras**: un `*.test.ts` por regla de la sección 6, con los casos
   límite (unidades distintas, sin datos, promedio que cumple con un ensayo que
   no, aceptación con un pendiente).
2. **Servicio sobre `memoryStore`** (`*.service.test.ts`, como Compras): permisos
   por rol, quien elabora no aprueba, versión optimista, anulación con motivo,
   duplicados por `clave_idempotencia`.
3. **Acceso cruzado**: con dos empresas sembradas, un usuario de A no lee, no
   crea ni cambia nada de B por ninguna ruta; nadie cambia su propio rol, ni se da
   un permiso que no tiene, ni toca su licencia; una licencia vencida o un usuario
   desactivado pierde el acceso en la siguiente petición.
4. **Store**: prueba que recorre cada función y falla si alguna URL sale sin
   `empresa_id` y `project_id`.
5. **SQL con PGlite** (script por fase en el scratchpad): el archivo corre dos
   veces seguidas; restricciones; claves compuestas que impiden mezclar empresas;
   bitácora que rechaza `update`, `delete` y `truncate`; `obra_bitacora_verificar`
   detecta una fila alterada a mano; escrituras directas que disparan los
   triggers.
6. **Contratos de datos**: con datos reales de forma de Presupuesto y Compras.
7. **Trimble falso** (`lib/compras/pruebas/trimbleFalso.ts`): lecturas de modelos,
   subidas que fallan a medias, reintentos sin duplicado.
8. **Interfaz**: página temporal `app/dev-preview-control-obra/` con el servicio
   real sobre `memoryStore`, revisada en el navegador y borrada antes de subir.
9. `npm test`, `npx tsc --noEmit -p .`, `npx next build`.
10. **Prueba en Trimble Connect real** (la hace el dueño, con guía): instalar,
    lectura de versiones, escritura en el CDE, personas con roles distintos.

## 13. Criterios de aceptación del documento y en qué fase se cumplen — (doc §14)

| # | Criterio del documento | Fase |
|---|---|---|
| 1 | Se instala y abre en Trimble Connect | 3 (menú), 4 (visor), 8 (final) |
| 2 | Identifica el proyecto activo y consulta los modelos autorizados | 3 y 4 |
| 3 | Relaciona elementos con IFCGUID, modelo, versión y parámetros | 4 |
| 4 | Consulta cantidades y costos por la estructura de control | 5 |
| 5 | Registra avances y conserva el historial | 5 |
| 6 | Gestiona ensayos, inspecciones, aceptaciones y NC | 6 |
| 7 | Indicadores con reglas transparentes | 5, 6 y 7 |
| 8 | Bitácora protegida | 3 (y se amplía en cada fase) |
| 9 | Administra empresas, licencias, roles y permisos | 3 |
| 10 | Datos de empresas separados | 3 (y pruebas en cada fase) |
| 11 | Documentos ligados a registros y al CDE correcto | 7 |
| 12 | Informa errores de integración y no marca como exitosa una operación no confirmada | 4 y 7 |

La Fase 8 agrega lo que pide el documento para el cierre: **manual básico** de
uso e instalación y guía de capacitación (doc §13).

## 14. Ajustes al construir la Fase 3

Diferencias menores con lo de arriba, hechas al programar y explicadas aquí:

1. **El administrador técnico no entra a los proyectos**: solo crea empresas,
   registra licencias y nombra o quita administradores de empresa. No da roles
   ni edita roles. Así la base de datos puede comprobar por sí misma cada
   regla de accesos (no depende de que el servidor le diga "soy el técnico").
2. **Administradores de empresa invitados por correo**: el técnico los nombra
   con su correo de Trimble Connect; la primera vez que abren Control de Obra
   quedan ligados a su usuario. Así el técnico no necesita ser miembro de los
   proyectos de la empresa.
3. **Nadie se da a sí mismo un rol de obra**: el administrador de la empresa
   nombra a un administrador de proyecto, y este le da su rol operativo. El
   administrador de proyecto no nombra administradores ni cambia a otro
   administrador de proyecto.
4. **Más estricto que Compras en la base de datos**: el rol de servicio solo
   puede leer las tablas (y agregar filas a la bitácora). Todo cambio pasa por
   funciones `security definer` que revisan las reglas.
5. **Los valores de la estructura se ligan al nivel por su clave**
   (`obra_nodos.nivel_clave`), no por el id del nivel: el nivel que rige puede
   ser el de la plantilla o el propio del proyecto con la misma clave.
6. **La licencia vende grupos de módulos** (estructura y modelos, cantidades y
   avance, costos, calidad, documentos, reportes); panel, bitácora y accesos
   vienen siempre. El historial de la licencia guarda el tipo de evento.
7. Lo que tiene la estructura de obra en esta fase es su configuración
   (niveles, valores, responsables, fechas y estados). Leer los valores del
   modelo o de Propiedades para cada elemento llega con la Fase 4.
