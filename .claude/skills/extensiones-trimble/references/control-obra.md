# Control de Obra

## Estado

Octava extensión, comercial y multiempresa. Menú del proyecto: `/control-obra`,
`public/manifest-control-obra.json` (el panel del visor llega en la fase 4).
Diagnóstico y diseño aprobados en `docs/control-obra/` (leer `diseno.md`,
incluida la sección 14 de ajustes). La especificación del dueño ("CONTROL DE
OBRA — Documento de definición funcional, técnica y de implementación",
v1.0) **no está en el repositorio** porque el repositorio es público: pedirla
si hace falta.

Fases: 1–2 diagnóstico y diseño; **3 base comercial (hecha)**; 4 modelos 3D e
IFCGUID; 5 cantidades, costos y avance; 6 calidad; 7 documentos en el CDE;
8 pruebas finales e instalación. Una fase por vez, subirla y esperar la
revisión del dueño ("sigue con la Fase N").

## Decisiones aprobadas (D1–D13)

No escribe en los cortes de Presupuesto (calcula su propio valor ganado con lo
aceptado); seguridad en el servidor con claves compuestas (sin políticas RLS
ni Supabase Auth); administrador técnico por `CONTROL_OBRA_ADMINS`; quien
elabora no aprueba; archivos en el CDE; bitácora = auditoría (sin diario de
obra); licencias a mano; un rol por persona y proyecto; costos reales a mano o
Excel; expediente descargable como copia aparte del CDE; un SQL re-ejecutable
por bloques con `obra_migraciones`; "aceptado con observaciones" por
proyecto, apagado; 7 roles iniciales.

## Capas y archivos

Igual que Compras: `app/api/control-obra/**/route.ts` → `lib/control-obra/routes.ts`
(`handle`, `esAdminTecnico`) → `service.ts` → `store.ts` (Supabase o
`memoryStore()` con las mismas reglas) → `supabase/control-obra.sql`.
Reglas puras: `accesos.ts`, `licencias.ts`, `estructura.ts`, `bitacora.ts`,
`roles.ts` (matriz con letras VCEFANDXM), `formato.ts`. Pantallas en
`components/control-obra/` (usan `ui.tsx` de Presupuesto y `estilos.ts` de
Compras).

## Reglas clave

- **La empresa la deduce el servidor** del proyecto (`proyectoActivo`); el
  navegador nunca la manda. Todo lo de un proyecto se lee con un `Alcance`
  (empresa + proyecto); `store.test.ts` comprueba los filtros de cada URL.
- Claves foráneas compuestas `(empresa_id, project_id, …)` en todas las
  tablas. El rol de servicio **solo lee** (y agrega a `obra_bitacora`); los
  cambios van por funciones `security definer` con candado
  `obra-accesos:<empresa>` / `obra-estructura:<empresa>`. Errores
  `raise exception 'obra:<motivo>'` → `MotivoRechazo` en `accesos.ts`.
- Tres niveles de administración separados de los permisos de obra:
  técnico (empresas, licencias, administradores de empresa por correo),
  empresa (proyectos, roles, personas, accesos, plantilla), proyecto
  (accesos y estructura de su proyecto, sin nombrar administradores). Nadie
  cambia lo suyo ni se da un rol: el admin de proyecto se lo da al de empresa.
- Licencia: historial de eventos, la última rige; solo activa, por vencer y
  sin vencimiento dejan trabajar (ni los administradores entran si no);
  permisos recortados a los grupos de módulos contratados.
- Bitácora: solo inserción (privilegios + triggers) y cadena SHA-256 por
  empresa ("global" para el técnico) calculada en el trigger
  `obra_bitacora_encadenar` (`sha256()` de PostgreSQL, sin extensiones);
  `obra_bitacora_verificar(cadena)` dice dónde se rompe. Se registran los
  intentos negados (`denegar()`), salvo la entrada del técnico a un proyecto.
  Cada acción nueva necesita su texto en `formato.ts`.

## Probar

- `npx tsx --test lib/control-obra/*.test.ts` (72 pruebas en la fase 3, con
  acceso cruzado entre dos empresas en `service.test.ts`).
- SQL con PGlite: script por fase en el scratchpad que crea
  `service_role` con **`bypassrls`** (como Supabase), corre el SQL dos veces,
  siembra con las funciones (roles y niveles iniciales con
  `npx tsx` exportando `ROLES_INICIALES` y `NIVELES_INICIALES` a JSON) y
  comprueba reglas, aislamiento (escrituras directas que rompen las claves
  compuestas), privilegios (`set role service_role`: update directo =
  permission denied) y la bitácora (desactivar el trigger, cambiar una fila,
  `obra_bitacora_verificar` la encuentra). La fase 3 tenía 82 comprobaciones.
- Interfaz: página temporal con `ControlObraApp` y una `ObraApi` que llama al
  servicio real sobre `memoryStore()` con `?como=ana|luis|marta|tec|beto`;
  Playwright global (`npm root -g`/playwright) con Chromium de
  `/opt/pw-browsers`. Cada recarga vuelve a sembrar la memoria. `next dev`
  crea `AGENTS.md` y `CLAUDE.md` en la raíz: borrarlos antes de confirmar.
