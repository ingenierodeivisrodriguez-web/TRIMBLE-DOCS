# Control de Obra

## Estado

Octava extensión, comercial y multiempresa. Menú del proyecto: `/control-obra`,
`public/manifest-control-obra.json` (el panel del visor llega en la fase 4).
Diagnóstico y diseño aprobados en `docs/control-obra/` (leer `diseno.md`,
incluida la sección 14 de ajustes). La especificación del dueño ("CONTROL DE
OBRA — Documento de definición funcional, técnica y de implementación",
v1.0) **no está en el repositorio** porque el repositorio es público: pedirla
si hace falta.

Fases del diseño: 1–2 diagnóstico y diseño; **3 base comercial (hecha)**.
Desde el 21-10-2026 el resto sigue el **plan de actas**
(`docs/control-obra/plan-actas.md`, léelo entero: decisiones, lecturas de
Presupuesto y Compras, cambios autorizados en Presupuesto, fases y prueba de
aceptación), que reemplazó las fases 4–8 del diseño: **1 flujos de
aprobación y roles (hecha)**, 2 ubicaciones y mediciones, 3 calidad,
4 actas, 5 enlace con Presupuesto, 6 almacén, 7 costo real, 8 panel y visor.
Una fase por vez, subirla y esperar "sigue con la siguiente fase".

## Decisiones aprobadas (D1–D13; D1 y D9 cambiadas por el plan de actas)

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

## Flujos de aprobación (plan de actas, fase 1)

- `lib/control-obra/flujos.ts`: `revisarPasos`, `avisosFlujo`,
  `flujosSugeridos`, `accionFlujo` (enviar, aprobar, devolver un paso con
  motivo, anular), `accionesPosibles`. El mismo motor en SQL:
  `obra_flujo_accion` (interna, sin `grant` al servidor: la llaman las
  funciones de cada documento dentro de su transacción y bloqueo).
- Cada documento con flujo guarda `estado` (borrador, devuelto, en_tramite,
  aprobado, anulado), `elaborado_por` y `flujo` jsonb
  `{pasos (copia con rolNombre), paso, firmas {"0": quien envió, "1": …}}`.
  Devolver quita la firma del paso al que vuelve; quien elabora y quien ya
  firmó otro paso no aprueban (`auto-aprobacion`).
- `obra_flujos` (pasos por proyecto y tipo) y `obra_aprobaciones` (solo
  inserción). Tipos: acta_cliente, acta_subcontrato, inspeccion, cierre_nc
  (paso 0 con `nc.editar`), vale_salida; `TIPOS_FLUJO` y
  `obra_tipos_flujo()`/`obra_modulo_de_flujo()` con prueba que los compara.
- Permisos nuevos solo se **agregan** a `obra_permisos_validos()` (los roles
  guardados deben seguir pasando la restricción). Roles iniciales nuevos se
  crean en las empresas existentes con un bloque `do` del SQL; a los viejos
  se les ofrecen con `permisosSugeridos` (aviso "Marcarlos" en Roles).

## Probar

- `npx tsx --test lib/control-obra/*.test.ts` (96 pruebas tras la fase 1
  del plan de actas, con acceso cruzado entre dos empresas en
  `service.test.ts`).
- Para probar un cambio del SQL sobre la base como está en producción: correr
  primero `git show HEAD~N:supabase/control-obra.sql` (el viejo), sembrar una
  empresa con sus funciones, y luego el nuevo dos veces encima.
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
