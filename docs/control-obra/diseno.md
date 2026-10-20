# Control de Obra — Fase 2: diseño

Fecha: 20-10-2026. Acompaña a `docs/control-obra/diagnostico.md`. **Es una
propuesta para aprobar**: nada de esto se programa ni se ejecuta en Supabase
hasta que el dueño diga "sigue con la Fase 3". Si al leer el documento "PROYECTO
CONTROL DE OBRA" (que no llegó a esta sesión) aparece algo distinto, se ajusta
aquí primero.

## Contenido

1. Decisiones que debe tomar el dueño
2. Principios
3. Dónde va cada cosa
4. Datos: tablas, columnas y restricciones
5. Unidades y conversiones
6. Reglas de cálculo (funciones puras con pruebas)
7. Estados de cada registro
8. Roles y matriz de permisos
9. API
10. Pantallas

## 1. Decisiones que debe tomar el dueño

**Aprobadas por el dueño el 20-10-2026: todas las recomendaciones** (columna
de la derecha). Son las reglas de la Fase 3 en adelante.

| # | Pregunta | Decisión (la recomendación, aprobada) |
|---|---|---|
| D1 | ¿Control de Obra escribe en los cortes de avance de Presupuesto? | **No.** Calcula su propio valor ganado con las cantidades **aceptadas**, la misma línea base y las mismas funciones. Más adelante, si quieres, un botón en Presupuesto "Leer de Control de Obra" que pregunta antes de reemplazar. |
| D2 | ¿Seguridad con RLS por empresa (opción A) o autorización en el servidor con claves compuestas (opción B)? | **B** (ver diagnóstico, sección 5). |
| D3 | ¿Cómo se reconoce al administrador técnico del producto? | Variable `CONTROL_OBRA_ADMINS` en Vercel con IDs de usuario de Trimble. |
| D4 | ¿Quien reporta una cantidad puede verificarla? ¿Quien registra un ensayo puede aprobarlo? | **No**, como en Compras ("quien elabora no aprueba"). |
| D5 | ¿Fotos y soportes en el CDE de Trimble o en Supabase Storage? | **CDE**, en una carpeta "Control de Obra/" del proyecto (ningún archivo en Supabase, igual que Compras). |
| D6 | ¿"Bitácora" es solo el registro de auditoría, o también el **diario de obra** (clima, personal, actividades del día)? | Fase 3: auditoría. Si el documento pide diario de obra, se agrega en la Fase 7 como registro con firma del residente, también inmodificable. |
| D7 | ¿Las licencias se asignan a mano o se venden en línea (Wompi / Mercado Pago, como Manuales)? | **A mano** por el administrador técnico en esta etapa. La venta en línea, después. |
| D8 | ¿Un rol por persona y proyecto (como Compras) o varios? | **Uno** por persona y proyecto, más la marca "administrador de la empresa". |
| D9 | Costos reales: ¿se registran a mano en Control de Obra (con soporte) o se importan de un sistema contable? | **A mano y por Excel**, cada uno rotulado con su fuente. Integración contable, después. |

## 2. Principios

- **Del modelo solo se lee.** Nada va a Property Sets ni UDA. Todo lo propio va a
  Supabase, ligado al elemento por **IFCGUID + archivo del modelo + versión**.
- **Presupuesto y Compras son solo lectura** para Control de Obra.
- **Nada se borra** cuando tiene valores: se desactiva o se anula con motivo.
- **Nada se sobrescribe en silencio**: si lo nuevo pisa lo escrito por una persona
  o hay valores distintos, se muestra la diferencia y se pregunta.
- **La empresa la deduce el servidor** a partir del proyecto; nunca la manda el
  navegador.
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
lib/control-obra/<regla>.ts + .test.ts     cálculos puros (unidades, avance, indicadores, criterios, aceptación…)
lib/control-obra/client.ts                 API del navegador
components/control-obra/                   pantallas (tokens y controles de components/presupuesto/ui.tsx)
supabase/control-obra.sql                  tablas, funciones, triggers
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
de verificación, se valida con la función de `lib/compras/proveedores.ts`),
`activa boolean`, `version`. Índice único por NIT cuando no está vacío.

**`obra_licencias`** — historial; cada cambio es una fila nueva, nunca se edita
una anterior. `id uuid pk`, `empresa_id → obra_empresas`, `plan text`,
`desde date`, `hasta date null` (sin fin), `max_proyectos integer > 0`,
`max_usuarios integer > 0`, `modulos text[]` (validado contra la lista de
módulos), `suspendida boolean`, `motivo text` (obligatorio si suspendida),
`otorgada_por text`. Vigente = la última fila de la empresa. `check (hasta is null or hasta >= desde)`.
Solo inserción (trigger). Estado con `estadoLicencia` de Manuales: activa, por
vencer (15 días), vencida, suspendida, sin vencimiento.

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
`project_id`, `user_id`, `rol_id`, `desde`, `hasta`, `activo`, `version`.
`primary key (empresa_id, project_id, user_id)`;
FK `(empresa_id, project_id) → obra_empresa_proyectos`,
FK `(empresa_id, user_id) → obra_usuarios`, FK `(empresa_id, rol_id) → obra_roles`.

Reglas en función SQL con `pg_advisory_xact_lock('obra-accesos:'||empresa)` y en
el servicio (como Compras): nadie cambia su propia fila; solo se dan permisos que
uno tiene; siempre queda un administrador de empresa vigente; nadie cambia la
licencia salvo el administrador técnico (que no está en la base: lo dice la
variable de entorno, y queda en la bitácora).

**`obra_bitacora`** — solo inserción, hash encadenado: `id bigint identity`,
`creado timestamptz`, `empresa_id uuid null` (null = acción del administrador
técnico sin empresa), `project_id text null`, `actor_id`, `actor_nombre`,
`accion` (1-60), `modulo`, `objeto_tipo`, `objeto_id`, `ifc_guid`, `file_id`,
`version_modelo`, `version_antes integer`, `version_despues integer`,
`cambios jsonb` (`{campo: [antes, después]}`), `motivo text`,
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
`jerarquia jsonb` (lista de niveles con la forma `ColumnaMemoria` de Presupuesto:
`{id, label, fuente: 'modelo'|'propiedad'|'ifcguid', clave}`), `version`.

**`obra_consecutivos`** — `(empresa_id, project_id, tipo)` → último número (NC-0001,
INS-0001, ENS-0001, LOT-0001).

**`obra_vistas`** — tarea de un solo uso para el visor (30 min), igual a
`presupuesto_vistas`: `(empresa_id, project_id, user_id)` pk, `tarea`, `datos jsonb`.

### 4.2 Modelos y elementos (Fase 4)

**`obra_modelos`** — `empresa_id`, `project_id`, `file_id`, `nombre`, `activo`.
pk `(empresa_id, project_id, file_id)`.

**`obra_modelo_versiones`** — una lectura de una versión: `id uuid`, `file_id`,
`version_id`, `revision integer null`, `leida timestamptz`, `leida_por`,
`elementos integer`, `sin_guid integer`, `estado ('completa','parcial')`.
`unique (empresa_id, project_id, file_id, version_id)`.

**`obra_elementos`** — la identidad del elemento para Control de Obra:
`id uuid`, `file_id`, `ifc_guid` (`^[0-3][0-9A-Za-z_$]{21}$`), `clase_ifc`,
`nombre`, `jerarquia jsonb` (valores de los niveles: torre, zona, nivel…),
`primera_version`, `ultima_version` (la última lectura donde aparece),
`estado ('vigente','no_esta_en_ultima')`. `unique (empresa_id, project_id, file_id, ifc_guid)`.
Un elemento que desaparece de una versión **no se borra**: queda
`no_esta_en_ultima` y sus registros se ven con aviso.

**`obra_elemento_huellas`** — `(elemento_id, version_lectura_id)` pk, `huella text`
(SHA-256 de clase, nombre y cantidades leídas, en orden fijo), `cantidades jsonb`
(magnitud → valor en unidad base). Comparar las huellas de dos lecturas da
nuevos, eliminados y cambiados. Solo inserción.

**`obra_incidencias_guid`** — `id`, `file_id`, `version_id`, `runtime_id`,
`nombre`, `tipo ('sin_guid','guid_invalido','guid_duplicado','guid_de_propiedad')`,
`detalle`, `estado ('abierta','revisada','descartada')`, `revisada_por`, `nota`.
Un elemento con incidencia **no se asocia** a nada hasta revisarse.

### 4.3 Cantidades, avance y costos (Fase 5)

**`obra_conversiones`** — `id`, `empresa_id`, `project_id null` (null = toda la
empresa), `de_unidad`, `a_unidad`, `factor numeric > 0`, `nota`, `aprobada_por`,
`activa`. `unique (empresa_id, coalesce(project_id,''), de_unidad, a_unidad) where activa`.
Ver sección 5.

**`obra_cantidades`** — un registro por elemento (o por ubicación si la partida
no tiene modelo) × partida × fecha:
`id uuid`, `partida_id text` (id del ítem en el presupuesto; sin FK, ver
diagnóstico 1), `elemento_id uuid null → obra_elementos`, `ubicacion text`
(cuando no hay elemento), `fecha date`, `unidad text` (la de la partida),
`cantidad_modelo numeric(18,4) null` + `version_modelo text` (de dónde salió),
`reportada numeric(18,4)`, `reportada_por`, `verificada numeric(18,4) null`,
`verificada_por`, `verificada_en`, `motivo_diferencia text`,
`aceptada numeric(18,4) null`, `aceptada_por`, `aceptada_en`,
`estado ('reportada','verificada','aceptada','rechazada','anulada')`,
`reemplaza_id uuid null`, `motivo_anulacion`, `version`.
Restricciones: `check (elemento_id is not null or btrim(ubicacion) <> '')`;
`check (estado <> 'anulada' or btrim(motivo_anulacion) <> '')`;
`check (verificada_por is distinct from reportada_por)` (si D4 = no);
`check (aceptada is null or aceptada <= verificada)`; si
`|verificada − reportada| > tolerancia`, motivo obligatorio (función).
Índices `(empresa_id, project_id, partida_id, fecha)`, `(empresa_id, project_id, elemento_id)`.

**`obra_cortes`** — fotos congeladas del avance para informes: `id`, `fecha`,
`linea_base_id uuid` (de `presupuesto_lineas_base`, sin FK porque es de otra
extensión; se valida al crear), `estado ('borrador','cerrado')`,
`resultado jsonb` (indicadores con su regla), `cerrado_por`. Cerrado no cambia
(trigger). `unique (empresa_id, project_id, fecha) where estado <> 'anulado'`.

**`obra_costos`** — `id`, `tipo ('real','estimado','comprometido_externo')`,
`fuente ('manual','excel','nomina','factura','acta_pago','otro')`,
`referencia text` (número de factura, acta…), `fecha`, `partida_id text null`,
`insumo_clave text null`, `capitulo text null`, `descripcion`,
`valor numeric(18,2)`, `iva numeric(18,2) default 0`, `moneda ('COP')`,
`documento_id uuid null → obra_documentos`, `estado ('vigente','anulado')`,
`motivo_anulacion`, `version`.
**Índice único `(empresa_id, project_id, fuente, lower(referencia)) where estado = 'vigente' and btrim(referencia) <> ''`**:
la misma factura no se registra dos veces. Lo comprometido en **órdenes y
contratos de Compras no se guarda aquí**: se lee en vivo de Compras; el tipo
`comprometido_externo` es solo para compromisos que no pasaron por Compras.

### 4.4 Calidad (Fase 6)

**`obra_criterios`** — criterio de aceptación por proyecto, **nunca escrito en el
código**: `id`, `codigo`, `nombre` (p. ej. "Concreto 21 MPa — resistencia a 28
días"), `material ('concreto','acero','otro')`, `tipo_ensayo` (resistencia a
compresión, asentamiento, fluencia del acero, …, lista configurable),
`unidad`, `parametros jsonb` (p. ej. valor especificado, edad de ensayo, número
de muestras por ensayo, límites individual y de promedio móvil — los define el
responsable técnico citando su norma), `referencia_normativa text`,
`version_criterio integer`, `estado ('borrador','aprobado','reemplazado','inactivo')`,
`aprobado_por`, `aprobado_en`. Un criterio aprobado **no se edita**: se crea una
versión nueva y la anterior queda `reemplazado` (los ensayos viejos siguen
evaluándose con la versión con que se registraron). Solo aprueba quien está en
`obra_config.responsable_tecnico_id` o tiene `criterios.aprobar`.

**`obra_lotes`** — `id`, `codigo` (LOT-0001), `material`, `descripcion`,
`proveedor text`, `remision text`, `fecha`, `criterio_id → obra_criterios`,
`estado ('abierto','cerrado','anulado')`, `motivo_anulacion`.

**`obra_lote_elementos`** — `(lote_id, elemento_id)` pk: qué elementos se
vaciaron o armaron con ese lote.

**`obra_ensayos`** — `id`, `codigo` (ENS-0001), `lote_id`, `criterio_id` +
`version_criterio` (congelados), `muestra text`, `edad_dias integer`,
`fecha_toma`, `fecha_ensayo`, `resultado numeric(18,4)`, `unidad`,
`laboratorio`, `documento_id null`, `cumple boolean` (calculado por el servidor
con la regla pura, nunca enviado por el navegador), `estado ('registrado','aprobado','anulado')`,
`registrado_por`, `aprobado_por` (distinto si D4), `reemplaza_id`, `motivo_anulacion`.
**No se borran ni se editan** después de aprobados: se anulan con motivo.
`check (fecha_ensayo >= fecha_toma)`.

**`obra_plantillas_inspeccion`** — lista de chequeo configurable: `id`, `nombre`,
`items jsonb` (`[{id, texto, obligatorio, tipo: 'si_no'|'valor'|'foto'}]`),
`version_plantilla`, `activa`. Igual que los criterios: no se editan, se versionan.

**`obra_inspecciones`** — `id`, `codigo` (INS-0001), `plantilla_id` + versión,
`fecha`, `inspector_id`, `resultados jsonb` (por item: cumple / no cumple / no
aplica, valor, nota), `resultado ('conforme','no_conforme','pendiente')`,
`estado ('borrador','cerrada','anulada')`, `motivo_anulacion`.
**`obra_inspeccion_elementos`** — `(inspeccion_id, elemento_id)`.

**`obra_no_conformidades`** — `id`, `codigo` (NC-0001), `origen ('ensayo','inspeccion','manual')`,
`origen_id`, `descripcion`, `severidad ('menor','mayor','critica')`,
`accion_correctiva`, `responsable_id`, `fecha_limite`,
`estado ('abierta','en_tratamiento','cerrada','anulada')`, `cerrada_por`,
`evidencia_cierre_id → obra_documentos`, `motivo`.
**`obra_nc_elementos`** — `(nc_id, elemento_id)`.

**`obra_aceptaciones`** — aceptación de un elemento: `id`, `elemento_id`,
`fecha`, `aceptado_por`, `requisitos jsonb` (la foto de lo que se comprobó al
aceptar), `estado ('vigente','revocada')`, `motivo_revocacion`.
`unique (empresa_id, project_id, elemento_id) where estado = 'vigente'`.
Una función SQL con bloqueo **rechaza** la aceptación si el elemento tiene un
requisito obligatorio pendiente, un ensayo que no cumple sin NC cerrada, o una NC
abierta (y el trigger lo vuelve a revisar si alguien escribe directo en la
tabla). Revocar pide motivo; nunca se borra.

### 4.5 Documentos en el CDE (Fase 7)

**`obra_cde_carpetas`** y **`obra_documentos`** — copia del diseño de Compras
(`compras_cde_carpetas`, `compras_documentos`): `entidad_tipo ('ensayo','inspeccion','nc','elemento','corte','costo','lote','diario')`,
`entidad_id`, nombre de archivo fijo (un reintento nunca crea otro), `tamano`
(≤ 100 MB), `sha256`, `estado ('pendiente','respaldado','error','anulado')`,
`file_id`, `version_id`, `confirmado`, `intentos`, `ultimo_error`.
`check (estado <> 'respaldado' or (file_id is not null and version_id is not null and confirmado is not null))`
y trigger "sin retroceso": un documento respaldado no vuelve a pendiente.
Carpeta en Trimble: `Control de Obra/` con subcarpetas Calidad/Ensayos,
Calidad/Inspecciones, Calidad/No conformidades, Cantidades, Costos, Informes.

## 5. Unidades y conversiones

- **Magnitudes**: longitud, área, volumen, masa, conteo (de `medidaDeUnidad`).
  Una unidad que no se reconoce queda "sin magnitud" y **no se suma con nada**.
- **Del modelo**: el visor da longitud en **mm**, área en m², volumen en m³, masa
  en kg. Se guardan en la unidad base (m, m², m³, kg) y se dice la propiedad de
  donde salieron.
- **Conversiones fijas** (exactas, no discutibles): mm ↔ m, cm ↔ m, kg ↔ t,
  Entre magnitudes distintas (m² y m³, m³ y kg) no hay conversión fija. Viven en el código con prueba.
- **Conversiones del proyecto** (p. ej. "1 m³ de concreto = 2.400 kg", "1 bulto
  = 50 kg"): solo si están en `obra_conversiones`, con quién las aprobó. Sin
  conversión definida, una suma de unidades distintas da **"no se puede sumar:
  m³ y kg"**, nunca un número.
- Redondeo: se calcula sin redondear y se muestra a 4 decimales (cantidades) y 2
  (montos), con `redondear` de `calc.ts`.

## 6. Reglas de cálculo

Cada una en una función pura de `lib/control-obra/` con su `*.test.ts`
(`node:test` + `assert/strict`, nombres en español, datos inline).

| Función (nombre previsto) | Regla |
|---|---|
| `sumarCantidades(items, conversiones)` | Agrupa por magnitud; convierte solo con conversión fija o definida; si queda más de una magnitud, devuelve el error y las partes, no un total. |
| `estadoCantidad(registro)` | La cantidad del modelo es "dato del modelo"; solo la verificada cuenta como ejecutada verificada y solo la aceptada entra al valor ganado. |
| `avanceGlobal(lineaBase, aceptadas, fecha)` | % = Σ (costo de línea base de la partida × % aceptado de la partida) ÷ Σ costo de línea base = EV ÷ BAC, con `Medidor`. **Nunca** promedio simple de porcentajes. Devuelve la regla en texto. |
| `indicador(...)` | Todo indicador devuelve `{ valor | null, numerador, denominador, unidad, periodo, alcance, regla }`. Sin datos → `null` y "Sin datos suficientes" (como el panel de Compras), nunca un cero inventado. |
| `costosSeparados(presupuesto, compras, costos)` | Tres columnas que no se mezclan: **comprometido** (Compras + `comprometido_externo`), **real** (facturas, actas, nómina), **estimado**. No suma lo que ya está en otra fuente: una línea de costo con la misma fuente y referencia se cuenta una vez. |
| `evaluarEnsayos(ensayos, criterio)` | Evalúa cada ensayo y cada grupo según los parámetros del criterio aprobado. Devuelve el promedio **junto al criterio** y la lista de ensayos y lotes que **no cumplen**; un promedio que cumple nunca oculta un ensayo que no. |
| `puedeAceptar(elemento, requisitos, ensayos, inspecciones, ncs)` | Devuelve la lista de pendientes; vacía = se puede aceptar. Obligatorios pendientes, ensayos que no cumplen o NC abiertas bloquean. |
| `estadoDocumento(doc)` | "Respaldado" solo con `fileId` + `versionId` confirmados por Trimble; si no, pendiente o error con reintento. |
| `clasificarGuid(resolucion)` | Usa `resolveIfcGuid`: sin GUID, GUID inválido o duplicado en la misma versión → incidencia, no se asocia. |
| `compararVersiones(huellasA, huellasB)` | Nuevos, eliminados, cambiados (huella distinta) y sin cambio. |
| `diferenciaQuePregunta(actual, nuevo)` | Si lo nuevo pisa un valor escrito por una persona, devuelve la diferencia para mostrarla y preguntar (regla 2). |

## 7. Estados de cada registro

| Registro | Número | Estados |
|---|---|---|
| Cantidad | — | reportada → verificada → aceptada; rechazada (con motivo); anulada (con motivo) |
| Corte de Control de Obra | — | borrador → cerrado |
| Costo | — | vigente; anulado |
| Criterio | — | borrador → aprobado → reemplazado / inactivo |
| Lote | LOT-0001 | abierto → cerrado; anulado |
| Ensayo | ENS-0001 | registrado → aprobado; anulado |
| Inspección | INS-0001 | borrador → cerrada (conforme / no conforme); anulada |
| No conformidad | NC-0001 | abierta → en tratamiento → cerrada; anulada |
| Aceptación de elemento | — | vigente; revocada |
| Documento | — | pendiente → respaldado (o error → reintento); anulado |
| Licencia | — | activa, por vencer, vencida, suspendida, sin vencimiento |

Todo con versión optimista; anular, rechazar y revocar piden motivo; todo deja
fila en la bitácora.

## 8. Roles y matriz de permisos

Dos niveles fuera de la matriz:

- **Administrador técnico del producto** (variable `CONTROL_OBRA_ADMINS`): crea
  empresas, asigna y suspende licencias, nombra el primer administrador de cada
  empresa, ve la bitácora de cualquier empresa. No edita datos de obra.
- **Administrador de la empresa** (`obra_usuarios.admin_empresa`): vincula
  proyectos (siendo además ADMIN del proyecto en Trimble), crea roles, da accesos
  y configura. No cambia su propia fila ni la licencia.

Roles iniciales por empresa (editables salvo el de administración, se pueden
desactivar, no borrar):

| Clave | Rol |
|---|---|
| DIR | Director de obra |
| RES | Residente de obra |
| INS | Inspector / interventoría |
| RTC | Responsable técnico de calidad |
| LAB | Laboratorio |
| COS | Costos y presupuesto |
| DOC | Control documental |
| AUD | Auditor / consulta |

Acciones: **V** ver · **C** crear o reportar · **E** editar borradores ·
**F** verificar · **A** aprobar o aceptar · **N** anular o revocar ·
**D** adjuntar documentos · **X** exportar · **M** administrar (configurar).

| Módulo | DIR | RES | INS | RTC | LAB | COS | DOC | AUD |
|---|---|---|---|---|---|---|---|---|
| Configuración del proyecto (jerarquía, tolerancias, responsable técnico) | V M | V | V | V | — | V | — | V |
| Accesos y roles | V | — | — | — | — | — | — | V |
| Modelos, versiones e incidencias de GUID | V F | V C | V F | V | — | V | — | V |
| Cantidades | V F A N X | V C E D X | V F D X | V | — | V X | V | V X |
| Cortes de avance de Control de Obra | V A N X | V C E X | V X | V | — | V C E X | — | V X |
| Costos (real, estimado, comprometido externo) | V A N X | V | — | — | — | V C E N D X | V | V X |
| Criterios de aceptación | V | V | V | V C E A N | V | — | — | V |
| Lotes | V | V C E N D | V | V A | V C E D | — | V | V |
| Ensayos | V X | V | V F | V A N X | V C E D X | — | V | V X |
| Inspecciones y listas de chequeo | V X | V C E D | V C E F A N D X | V M | — | — | V | V X |
| No conformidades | V A N X | V C E D | V C E D | V C E A N D X | V C | — | V | V X |
| Aceptación de elementos | V A N | V | V A N | V A N | — | — | — | V |
| Documentos en el CDE | V D | V D | V D | V D | V D | V D | V D N M | V |
| Indicadores y reportes | V X | V X | V X | V X | — | V X | V | V X |
| Bitácora | V | — | — | — | — | — | — | V X |

Notas: la aceptación de elementos siempre exige que `puedeAceptar` dé la lista
vacía, tenga quien tenga el permiso. Si D4 = no, quien reportó una cantidad o
registró un ensayo no puede verificarlo ni aprobarlo, aunque su rol lo permita.
La lista de permisos válidos vive en código (`PERMISOS_VALIDOS`) y en SQL
(`obra_permisos_validos()`), con una prueba que verifica que coinciden (como
Compras).

## 9. API

Todas bajo `app/api/control-obra/`, con `?projectId=` y `Authorization: Bearer`,
excepto las del administrador técnico, que no dependen de un proyecto de una
empresa (`/admin/...`, solo para IDs en `CONTROL_OBRA_ADMINS`).

| Ruta | Métodos |
|---|---|
| `estado` | GET: empresa, licencia, mis permisos, mi ID de Trimble |
| `admin/empresas`, `admin/licencias`, `admin/administradores` | GET, POST (administrador técnico) |
| `empresa/proyectos`, `accesos`, `roles` | GET, POST |
| `config` | GET, PUT (con versión) |
| `modelos`, `modelos/lecturas`, `elementos`, `incidencias` | GET, POST |
| `cantidades`, `cantidades/{id}/verificar`, `/aceptar`, `/anular` | GET, POST |
| `cortes`, `costos` | GET, POST |
| `criterios`, `lotes`, `ensayos`, `inspecciones`, `nc`, `aceptaciones` | GET, POST, y acciones `/{id}/aprobar`, `/anular`… |
| `documentos`, `documentos/{id}/confirmar`, `/reintentar`, `/abrir` | GET, POST |
| `indicadores`, `reportes` | GET |
| `bitacora`, `bitacora/verificar` | GET |
| `vistas` | GET, POST (tarea para el visor) |

Errores como hoy: `{ error, code }`; `version-conflict` (409), `sin-acceso`,
`sin-permiso`, `licencia-vencida`, `licencia-suspendida`, `cupo-proyectos`,
`cupo-usuarios`, `otra-empresa`, `auto-aprobacion`, `pendientes-aceptacion`,
`unidades-incompatibles`, `trimble-session` (401).

## 10. Pantallas

Menú del proyecto (`/control-obra`), pestañas visibles según permisos: Inicio,
Cantidades y avance, Costos, Calidad (criterios, lotes y ensayos, inspecciones,
no conformidades), Aceptación, Documentos (CDE), Indicadores y reportes,
Modelos y versiones, Configuración, Accesos y roles, Bitácora. Para el
administrador técnico, una pestaña "Empresas y licencias".

Panel del visor (`/control-obra/visor`): seleccionar elementos y ver su ficha
(partidas, cantidades, lote, ensayos, inspecciones, NC, aceptación, documentos);
reportar cantidad; "Leer esta versión"; colorear por estado (avance, calidad,
aceptación) con leyenda y 8 colores fijos; recoger las tareas que deja el menú
("Ver en 3D").

Mismo aspecto que Presupuesto y Compras: tokens y controles de
`components/presupuesto/ui.tsx`, `DateField` de Propiedades, fechas DD-MM-AAAA,
ayudas (`title`) que dicen la cuenta o la regla.
