-- Servicio de datos de "Control de Obra": empresas, licencias, personas, roles, accesos
-- por proyecto, estructura de obra y la bitácora de auditoría.
-- Ejecútalo en Supabase → SQL Editor. Es seguro volver a ejecutarlo: no borra datos.
--
-- Solo el servidor de la app (clave de servicio) lee y escribe: RLS activado sin
-- políticas. Cada tabla de proyecto lleva empresa_id y project_id, y sus claves
-- foráneas son compuestas: la base de datos impide mezclar registros de dos
-- empresas o de dos proyectos. Las reglas de accesos se revisan aquí también (no
-- solo en la app). La bitácora y el historial de licencias solo admiten inserciones;
-- la bitácora además lleva un hash encadenado que deja en evidencia cualquier
-- cambio hecho a mano. Control de Obra nunca escribe en presupuesto_* ni compras_*.
--
-- El archivo va por bloques numerados; cada bloque deja constancia en
-- obra_migraciones al ejecutarse (decisión D11 del diseño).

-- ================================================================ bloque 1: base comercial

create table if not exists public.obra_migraciones (
  bloque      integer     primary key,
  descripcion text        not null,
  aplicado    timestamptz not null default now()
);

-- Todos los permisos posibles ("modulo.accion"); la app tiene la misma lista
-- (lib/control-obra/types.ts, PERMISOS_VALIDOS) y una prueba verifica que coincidan.
create or replace function public.obra_permisos_validos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'panel.ver', 'estructura.ver', 'modelos.ver', 'modelos.crear', 'modelos.verificar',
    'cantidades.ver', 'cantidades.crear', 'cantidades.editar', 'cantidades.verificar', 'cantidades.aprobar',
    'cantidades.anular', 'cantidades.documentos', 'cantidades.exportar',
    'avance.ver', 'avance.crear', 'avance.editar', 'avance.aprobar', 'avance.anular', 'avance.documentos', 'avance.exportar',
    'costos.ver', 'costos.crear', 'costos.editar', 'costos.aprobar', 'costos.anular', 'costos.documentos', 'costos.exportar',
    'criterios.ver', 'criterios.crear', 'criterios.editar', 'criterios.aprobar', 'criterios.anular', 'criterios.administrar',
    'lotes.ver', 'lotes.crear', 'lotes.editar', 'lotes.aprobar', 'lotes.anular', 'lotes.documentos',
    'ensayos.ver', 'ensayos.crear', 'ensayos.editar', 'ensayos.verificar', 'ensayos.aprobar', 'ensayos.anular',
    'ensayos.documentos', 'ensayos.exportar',
    'inspecciones.ver', 'inspecciones.crear', 'inspecciones.editar', 'inspecciones.verificar', 'inspecciones.aprobar',
    'inspecciones.anular', 'inspecciones.documentos', 'inspecciones.exportar', 'inspecciones.administrar',
    'nc.ver', 'nc.crear', 'nc.editar', 'nc.aprobar', 'nc.anular', 'nc.documentos', 'nc.exportar',
    'aceptacion.ver', 'aceptacion.aprobar', 'aceptacion.anular',
    'documentos.ver', 'documentos.documentos', 'documentos.anular', 'documentos.administrar',
    'reportes.ver', 'reportes.exportar', 'bitacora.ver', 'bitacora.exportar', 'accesos.ver'
  ]::text[]
$$;

-- Los grupos de módulos que vende una licencia (lib/control-obra/types.ts, GRUPOS_LICENCIA).
create or replace function public.obra_grupos_validos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['bim', 'cantidades', 'costos', 'calidad', 'documentos', 'reportes']::text[]
$$;

-- El grupo de la licencia al que pertenece un módulo (null: viene con toda licencia).
create or replace function public.obra_grupo_de_modulo(p_modulo text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_modulo in ('estructura', 'modelos') then 'bim'
    when p_modulo in ('cantidades', 'avance') then 'cantidades'
    when p_modulo = 'costos' then 'costos'
    when p_modulo in ('criterios', 'lotes', 'ensayos', 'inspecciones', 'nc', 'aceptacion') then 'calidad'
    when p_modulo = 'documentos' then 'documentos'
    when p_modulo = 'reportes' then 'reportes'
    else null
  end
$$;

-- Hoy en Colombia (las vigencias son por día).
create or replace function public.obra_hoy()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Bogota')::date
$$;

-- Las tablas que solo admiten inserciones (bitácora, historial de licencias).
create or replace function public.obra_solo_insercion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'obra:historial-inmutable';
end;
$$;

-- ---------------------------------------------------------------- empresas y licencias

create table if not exists public.obra_empresas (
  id              uuid        primary key,
  nombre          text        not null check (char_length(btrim(nombre)) between 1 and 150),
  nit             text        not null default '' check (nit ~ '^[0-9]{0,15}$'),
  dv              smallint    check (dv between 0 and 9),
  activa          boolean     not null default true,
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text        not null,
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  check ((nit = '') = (dv is null))
);
create unique index if not exists obra_empresas_nit on public.obra_empresas (nit) where nit <> '';
create unique index if not exists obra_empresas_nombre on public.obra_empresas (lower(btrim(nombre)));

-- Historial de la licencia de cada empresa: cada evento (activación, renovación, cambio,
-- suspensión, reactivación) es una fila nueva; la más reciente es la vigente.
create table if not exists public.obra_licencias (
  id            uuid        primary key,
  empresa_id    uuid        not null references public.obra_empresas (id),
  evento        text        not null check (evento in ('activacion', 'renovacion', 'cambio', 'suspension', 'reactivacion')),
  plan          text        not null check (char_length(btrim(plan)) between 1 and 80),
  desde         date        not null,
  hasta         date,
  max_proyectos integer     not null check (max_proyectos between 1 and 10000),
  max_usuarios  integer     not null check (max_usuarios between 1 and 100000),
  grupos        text[]      not null default '{}',
  suspendida    boolean     not null default false,
  motivo        text        not null default '' check (char_length(motivo) <= 1000),
  soporte       text        not null default '' check (char_length(soporte) <= 300),
  otorgada_por  text        not null,
  creado        timestamptz not null default clock_timestamp(),
  check (hasta is null or hasta >= desde),
  check (suspendida = (evento = 'suspension')),
  check (evento not in ('suspension', 'reactivacion') or btrim(motivo) <> '')
);
alter table public.obra_licencias drop constraint if exists obra_licencias_grupos_validos;
alter table public.obra_licencias add constraint obra_licencias_grupos_validos check (grupos <@ public.obra_grupos_validos());
create index if not exists obra_licencias_empresa on public.obra_licencias (empresa_id, creado desc);

drop trigger if exists obra_licencias_sin_cambios on public.obra_licencias;
create trigger obra_licencias_sin_cambios
  before update or delete on public.obra_licencias
  for each row execute function public.obra_solo_insercion();
drop trigger if exists obra_licencias_sin_vaciar on public.obra_licencias;
create trigger obra_licencias_sin_vaciar
  before truncate on public.obra_licencias
  for each statement execute function public.obra_solo_insercion();

-- Proyectos de Trimble Connect registrados por cada empresa. Un proyecto activo pertenece a
-- una sola empresa. Retirarlo es activo = false con motivo: sus datos quedan.
create table if not exists public.obra_empresa_proyectos (
  empresa_id       uuid        not null references public.obra_empresas (id),
  project_id       text        not null check (project_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  project_name     text        not null default '' check (char_length(project_name) <= 300),
  activo           boolean     not null default true,
  vinculado_por    text        not null,
  vinculado        timestamptz not null default now(),
  desvinculado_por text,
  motivo           text        not null default '' check (char_length(motivo) <= 1000),
  primary key (empresa_id, project_id),
  check (activo or btrim(motivo) <> '')
);
create unique index if not exists obra_proyecto_una_empresa on public.obra_empresa_proyectos (project_id) where activo;

-- ---------------------------------------------------------------- roles, personas y accesos

-- Roles de cada empresa con su matriz de permisos (los iniciales se crean con la empresa).
create table if not exists public.obra_roles (
  id              uuid        primary key,
  empresa_id      uuid        not null references public.obra_empresas (id),
  clave           text        not null check (clave ~ '^[a-z0-9_]{2,60}$'),
  nombre          text        not null check (char_length(btrim(nombre)) between 1 and 80),
  descripcion     text        not null default '' check (char_length(descripcion) <= 300),
  sistema         boolean     not null default false,
  activo          boolean     not null default true,
  permisos        text[]      not null default '{}',
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  unique (empresa_id, clave),
  unique (empresa_id, id)
);
create unique index if not exists obra_roles_nombre_unico on public.obra_roles (empresa_id, lower(btrim(nombre)));
alter table public.obra_roles drop constraint if exists obra_roles_permisos_validos;
alter table public.obra_roles add constraint obra_roles_permisos_validos check (permisos <@ public.obra_permisos_validos());

-- Personas de la empresa. Un administrador invitado se conoce por su correo hasta que abre
-- Control de Obra (entonces se guarda su id de usuario de Trimble). Desactivar a una persona
-- corta todos sus accesos en la empresa; la fila no se borra.
create table if not exists public.obra_usuarios (
  id              uuid        primary key,
  empresa_id      uuid        not null references public.obra_empresas (id),
  user_id         text        check (char_length(user_id) between 1 and 100),
  email           text        not null check (email = lower(btrim(email)) and position('@' in email) > 1 and char_length(email) <= 254),
  nombre          text        not null default '' check (char_length(nombre) <= 200),
  admin_empresa   boolean     not null default false,
  activo          boolean     not null default true,
  version         integer     not null default 1,
  otorgado_por    text        not null,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  unique (empresa_id, user_id),
  unique (empresa_id, email),
  unique (empresa_id, id)
);

-- El rol de una persona en un proyecto, vigente de `desde` a `hasta` (null: sin fin).
-- Revocar es activo = false; la fila no se borra.
create table if not exists public.obra_asignaciones (
  empresa_id      uuid        not null,
  project_id      text        not null,
  user_id         text        not null,
  nombre          text        not null default '',
  email           text        not null default '',
  rol_id          uuid        not null,
  admin_proyecto  boolean     not null default false,
  desde           date        not null,
  hasta           date,
  activo          boolean     not null default true,
  version         integer     not null default 1,
  otorgado_por    text        not null,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  primary key (empresa_id, project_id, user_id),
  foreign key (empresa_id, project_id) references public.obra_empresa_proyectos (empresa_id, project_id),
  foreign key (empresa_id, user_id) references public.obra_usuarios (empresa_id, user_id),
  foreign key (empresa_id, rol_id) references public.obra_roles (empresa_id, id),
  check (hasta is null or hasta >= desde)
);
create index if not exists obra_asignaciones_usuario on public.obra_asignaciones (empresa_id, user_id);

-- ---------------------------------------------------------------- configuración y estructura de obra

create table if not exists public.obra_config (
  empresa_id                         uuid         not null,
  project_id                         text         not null,
  responsable_tecnico_id             text,
  responsable_tecnico_nombre         text         not null default '' check (char_length(responsable_tecnico_nombre) <= 200),
  tolerancia_verificacion_pct        numeric(6,2) not null default 0 check (tolerancia_verificacion_pct between 0 and 100),
  permite_aceptado_con_observaciones boolean      not null default false,
  version                            integer      not null default 1,
  actualizado                        timestamptz  not null default now(),
  actualizado_por                    text,
  primary key (empresa_id, project_id),
  foreign key (empresa_id, project_id) references public.obra_empresa_proyectos (empresa_id, project_id)
);

-- Niveles de la estructura (torre, etapa, zona, nivel, frente, disciplina…): los de la
-- plantilla de la empresa (project_id null) y los propios de un proyecto, que reemplazan al
-- de la plantilla con la misma clave. Capítulo, actividad y paquete vienen de Presupuesto.
create table if not exists public.obra_niveles (
  id              uuid        primary key,
  empresa_id      uuid        not null references public.obra_empresas (id),
  project_id      text,
  clave           text        not null check (clave ~ '^[a-z][a-z0-9_]{1,39}$' and clave not in ('capitulo', 'actividad', 'paquete', 'proyecto', 'empresa', 'elemento')),
  nombre          text        not null check (char_length(btrim(nombre)) between 1 and 60),
  orden           integer     not null default 0 check (orden between 0 and 999),
  padre_clave     text,
  fuente          text        not null check (fuente in ('modelo', 'propiedad', 'manual')),
  clave_fuente    text        not null default '' check (char_length(clave_fuente) <= 200),
  activo          boolean     not null default true,
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  unique (empresa_id, id),
  foreign key (empresa_id, project_id) references public.obra_empresa_proyectos (empresa_id, project_id),
  check ((fuente = 'manual') = (clave_fuente = '')),
  check (padre_clave is null or padre_clave <> clave)
);
create unique index if not exists obra_niveles_clave on public.obra_niveles (empresa_id, coalesce(project_id, ''), clave);

-- Los valores de cada nivel en un proyecto ("Torre 1", "Piso 5") con su responsable,
-- fechas y estado. No se borran: se dejan inactivos.
create table if not exists public.obra_nodos (
  id                 uuid        primary key,
  empresa_id         uuid        not null,
  project_id         text        not null,
  nivel_clave        text        not null,
  valor              text        not null check (char_length(btrim(valor)) between 1 and 120),
  padre_id           uuid,
  responsable_id     text,
  responsable_nombre text        not null default '' check (char_length(responsable_nombre) <= 200),
  inicio             date,
  fin                date,
  estado             text        not null default 'activo' check (estado in ('activo', 'cerrado', 'inactivo')),
  nota               text        not null default '' check (char_length(nota) <= 500),
  version            integer     not null default 1,
  creado             timestamptz not null default now(),
  creado_por         text,
  actualizado        timestamptz not null default now(),
  actualizado_por    text,
  unique (empresa_id, project_id, id),
  foreign key (empresa_id, project_id) references public.obra_empresa_proyectos (empresa_id, project_id),
  foreign key (empresa_id, project_id, padre_id) references public.obra_nodos (empresa_id, project_id, id),
  check (inicio is null or fin is null or fin >= inicio),
  check ((responsable_id is null) = (btrim(responsable_nombre) = ''))
);
create unique index if not exists obra_nodos_valor on public.obra_nodos (empresa_id, project_id, nivel_clave, lower(btrim(valor)));

-- ---------------------------------------------------------------- bitácora

-- Una cadena por empresa (y "global" para el administrador técnico): cada fila guarda el
-- hash de la anterior. Solo inserción; la posición `n` y los hashes los pone el trigger.
create table if not exists public.obra_bitacora (
  n              bigint      not null,
  cadena         text        not null,
  creado         timestamptz not null default now(),
  empresa_id     uuid        references public.obra_empresas (id),
  project_id     text,
  actor_id       text        not null,
  actor_nombre   text        not null default '',
  accion         text        not null check (char_length(accion) between 1 and 60),
  modulo         text        not null default '',
  objeto_tipo    text        not null default '',
  objeto_id      text        not null default '',
  ifc_guid       text,
  file_id        text,
  version_modelo text,
  cambios        jsonb       not null default '{}'::jsonb check (jsonb_typeof(cambios) = 'object'),
  motivo         text        not null default '',
  evidencia_id   uuid,
  resultado      text        not null check (resultado in ('ok', 'denegado', 'error')),
  origen         text        not null default 'menu' check (origen in ('menu', 'visor', 'sistema')),
  hash_anterior  text        not null,
  hash           text        not null,
  primary key (cadena, n)
);
create index if not exists obra_bitacora_proyecto on public.obra_bitacora (empresa_id, project_id, n desc);
create index if not exists obra_bitacora_objeto on public.obra_bitacora (empresa_id, objeto_tipo, objeto_id);

-- La fila como el texto que se encadena (orden fijo de campos; jsonb::text siempre sale igual
-- para el mismo contenido).
create or replace function public.obra_bitacora_canon(b public.obra_bitacora)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws('|',
    b.n::text, b.cadena, to_char(b.creado at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(b.empresa_id::text, ''), coalesce(b.project_id, ''), b.actor_id, b.actor_nombre, b.accion, b.modulo,
    b.objeto_tipo, b.objeto_id, coalesce(b.ifc_guid, ''), coalesce(b.file_id, ''), coalesce(b.version_modelo, ''),
    b.cambios::text, b.motivo, coalesce(b.evidencia_id::text, ''), b.resultado, b.origen)
$$;

-- Pone la posición, la hora del servidor y los hashes; una inserción a la vez por cadena.
create or replace function public.obra_bitacora_encadenar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_n bigint;
  v_hash text;
begin
  new.cadena := coalesce(new.empresa_id::text, 'global');
  perform pg_advisory_xact_lock(hashtext('obra-bitacora:' || new.cadena));
  select b.n, b.hash into v_n, v_hash from public.obra_bitacora b where b.cadena = new.cadena order by b.n desc limit 1;
  new.n := coalesce(v_n, 0) + 1;
  new.creado := now();
  new.hash_anterior := coalesce(v_hash, repeat('0', 64));
  new.hash := encode(sha256(convert_to(new.hash_anterior || '|' || public.obra_bitacora_canon(new), 'UTF8')), 'hex');
  return new;
end;
$$;

drop trigger if exists obra_bitacora_encadenar on public.obra_bitacora;
create trigger obra_bitacora_encadenar
  before insert on public.obra_bitacora
  for each row execute function public.obra_bitacora_encadenar();
drop trigger if exists obra_bitacora_sin_cambios on public.obra_bitacora;
create trigger obra_bitacora_sin_cambios
  before update or delete on public.obra_bitacora
  for each row execute function public.obra_solo_insercion();
drop trigger if exists obra_bitacora_sin_vaciar on public.obra_bitacora;
create trigger obra_bitacora_sin_vaciar
  before truncate on public.obra_bitacora
  for each statement execute function public.obra_solo_insercion();

-- Recalcula una cadena: cuántas filas tiene y la primera posición que no cuadra (null: íntegra).
create or replace function public.obra_bitacora_verificar(p_cadena text)
returns table (filas bigint, rota_en bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  r public.obra_bitacora%rowtype;
  v_esperado bigint := 0;
  v_anterior text := repeat('0', 64);
begin
  filas := 0;
  rota_en := null;
  for r in select * from public.obra_bitacora b where b.cadena = p_cadena order by b.n loop
    filas := filas + 1;
    v_esperado := v_esperado + 1;
    if rota_en is null and (
      r.n <> v_esperado or r.hash_anterior <> v_anterior
      or r.hash <> encode(sha256(convert_to(r.hash_anterior || '|' || public.obra_bitacora_canon(r), 'UTF8')), 'hex')
    ) then
      rota_en := r.n;
    end if;
    v_anterior := r.hash;
  end loop;
  return next;
end;
$$;

-- Agrega una fila a la bitácora (lo usan las funciones de abajo).
create or replace function public.obra_registrar(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text, p_accion text, p_modulo text,
  p_objeto_tipo text, p_objeto_id text, p_cambios jsonb, p_motivo text default '')
returns void
language sql
set search_path = public
as $$
  insert into public.obra_bitacora (empresa_id, project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, cambios, motivo, resultado, origen, hash_anterior, hash)
  values (p_empresa_id, p_project_id, p_actor_id, coalesce(p_actor_nombre, ''), p_accion, p_modulo, p_objeto_tipo, p_objeto_id,
          coalesce(p_cambios, '{}'::jsonb), coalesce(p_motivo, ''), 'ok', 'menu', '', '');
$$;

-- ---------------------------------------------------------------- licencia y permisos vigentes

-- La licencia vigente de una empresa: su evento más reciente.
create or replace function public.obra_licencia_vigente(p_empresa_id uuid)
returns public.obra_licencias
language sql
stable
set search_path = public
as $$
  select * from public.obra_licencias where empresa_id = p_empresa_id order by creado desc, id desc limit 1
$$;

-- La empresa puede trabajar hoy: activa, con licencia que ya empezó, no vencida ni suspendida.
create or replace function public.obra_licencia_usable(p_empresa_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select e.activa and l.id is not null and not l.suspendida and l.desde <= public.obra_hoy()
           and (l.hasta is null or l.hasta >= public.obra_hoy())
      from public.obra_empresas e
      left join lateral (select * from public.obra_licencia_vigente(e.id)) l on true
     where e.id = p_empresa_id
  ), false)
$$;

create or replace function public.obra_es_admin_empresa(p_empresa_id uuid, p_user_id text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.obra_licencia_usable(p_empresa_id) and exists (
    select 1 from public.obra_usuarios u
     where u.empresa_id = p_empresa_id and u.user_id = p_user_id and u.activo and u.admin_empresa)
$$;

-- El acceso vigente de una persona en un proyecto (persona activa, proyecto registrado).
create or replace function public.obra_asignacion_vigente(p_empresa_id uuid, p_project_id text, p_user_id text)
returns public.obra_asignaciones
language sql
stable
set search_path = public
as $$
  select a.*
    from public.obra_asignaciones a
    join public.obra_usuarios u on u.empresa_id = a.empresa_id and u.user_id = a.user_id
    join public.obra_empresa_proyectos p on p.empresa_id = a.empresa_id and p.project_id = a.project_id
   where a.empresa_id = p_empresa_id and a.project_id = p_project_id and a.user_id = p_user_id
     and a.activo and u.activo and p.activo
     and a.desde <= public.obra_hoy() and (a.hasta is null or a.hasta >= public.obra_hoy())
$$;

create or replace function public.obra_es_admin_proyecto(p_empresa_id uuid, p_project_id text, p_user_id text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.obra_licencia_usable(p_empresa_id)
     and coalesce((select a.admin_proyecto from public.obra_asignacion_vigente(p_empresa_id, p_project_id, p_user_id) a), false)
$$;

-- Los permisos operativos vigentes de una persona en un proyecto, recortados a lo que vende
-- la licencia (vacío: sin acceso).
create or replace function public.obra_permisos_de(p_empresa_id uuid, p_project_id text, p_user_id text)
returns text[]
language sql
stable
set search_path = public
as $$
  select case when not public.obra_licencia_usable(p_empresa_id) then '{}'::text[] else coalesce((
    select array(
      select p from unnest(r.permisos) p
       where public.obra_grupo_de_modulo(split_part(p, '.', 1)) is null
          or public.obra_grupo_de_modulo(split_part(p, '.', 1)) = any ((public.obra_licencia_vigente(p_empresa_id)).grupos))
      from public.obra_asignacion_vigente(p_empresa_id, p_project_id, p_user_id) a
      join public.obra_roles r on r.empresa_id = a.empresa_id and r.id = a.rol_id
     where r.activo and a.user_id is not null
  ), '{}'::text[]) end
$$;

-- ---------------------------------------------------------------- administrador técnico
-- La app solo llama estas funciones para los IDs de CONTROL_OBRA_ADMINS (variable de Vercel).

-- Crea (versión 0) o cambia una empresa. Al crearla, crea sus roles iniciales y la plantilla
-- de niveles de la estructura. Devuelve la nueva versión.
create or replace function public.obra_guardar_empresa(
  p_actor_id text, p_actor_nombre text, p_id uuid, p_nombre text, p_nit text, p_dv smallint, p_activa boolean,
  p_version integer, p_roles jsonb, p_niveles jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_empresas%rowtype;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('obra-empresas'));
  select * into v_antes from public.obra_empresas where id = p_id for update;
  if not found then
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_empresas (id, nombre, nit, dv, activa, creado_por, actualizado_por)
    values (p_id, btrim(p_nombre), coalesce(p_nit, ''), p_dv, p_activa, p_actor_nombre, p_actor_nombre);
    insert into public.obra_roles (id, empresa_id, clave, nombre, descripcion, sistema, permisos, actualizado_por)
    select gen_random_uuid(), p_id, r ->> 'clave', r ->> 'nombre', coalesce(r ->> 'descripcion', ''), true,
           array(select jsonb_array_elements_text(r -> 'permisos')), p_actor_nombre
      from jsonb_array_elements(coalesce(p_roles, '[]'::jsonb)) r;
    insert into public.obra_niveles (id, empresa_id, project_id, clave, nombre, orden, padre_clave, fuente, clave_fuente, actualizado_por)
    select gen_random_uuid(), p_id, null, n ->> 'clave', n ->> 'nombre', (n ->> 'orden')::integer, n ->> 'padreClave',
           n ->> 'fuente', coalesce(n ->> 'claveFuente', ''), p_actor_nombre
      from jsonb_array_elements(coalesce(p_niveles, '[]'::jsonb)) n;
    perform public.obra_registrar(p_id, null, p_actor_id, p_actor_nombre, 'empresa.crear', 'empresas', 'empresa', p_id::text,
      jsonb_build_object('nombre', btrim(p_nombre), 'nit', p_nit, 'activa', p_activa, 'roles', jsonb_array_length(coalesce(p_roles, '[]'::jsonb))));
    return 1;
  end if;

  update public.obra_empresas
     set nombre = btrim(p_nombre), nit = coalesce(p_nit, ''), dv = p_dv, activa = p_activa,
         version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
   where id = p_id and version = p_version
  returning version into v_version;
  if v_version is null then
    raise exception 'version-conflict';
  end if;
  perform public.obra_registrar(p_id, null, p_actor_id, p_actor_nombre, 'empresa.cambiar', 'empresas', 'empresa', p_id::text,
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (values
      ('nombre', case when v_antes.nombre <> btrim(p_nombre) then jsonb_build_array(v_antes.nombre, btrim(p_nombre)) end),
      ('nit', case when v_antes.nit <> coalesce(p_nit, '') then jsonb_build_array(v_antes.nit, p_nit) end),
      ('activa', case when v_antes.activa <> p_activa then jsonb_build_array(v_antes.activa, p_activa) end)
    ) x(k, v) where v is not null));
  return v_version;
end;
$$;

-- Registra un evento de la licencia de una empresa (siempre una fila nueva).
create or replace function public.obra_registrar_licencia(
  p_actor_id text, p_actor_nombre text, p_id uuid, p_empresa_id uuid, p_evento text, p_plan text, p_desde date, p_hasta date,
  p_max_proyectos integer, p_max_usuarios integer, p_grupos text[], p_suspendida boolean, p_motivo text, p_soporte text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.obra_empresas where id = p_empresa_id) then
    raise exception 'obra:no-existe';
  end if;
  insert into public.obra_licencias (id, empresa_id, evento, plan, desde, hasta, max_proyectos, max_usuarios, grupos, suspendida, motivo, soporte, otorgada_por)
  values (p_id, p_empresa_id, p_evento, btrim(p_plan), p_desde, p_hasta, p_max_proyectos, p_max_usuarios, p_grupos, p_suspendida,
          coalesce(p_motivo, ''), coalesce(p_soporte, ''), p_actor_nombre);
  perform public.obra_registrar(p_empresa_id, null, p_actor_id, p_actor_nombre, 'licencias.registrar', 'empresas', 'licencia', p_id::text,
    jsonb_build_object('evento', p_evento, 'plan', btrim(p_plan), 'desde', p_desde, 'hasta', p_hasta, 'maxProyectos', p_max_proyectos,
                       'maxUsuarios', p_max_usuarios, 'grupos', to_jsonb(p_grupos), 'suspendida', p_suspendida),
    coalesce(p_motivo, ''));
end;
$$;

-- Nombra o quita un administrador de la empresa, por su correo de Trimble Connect.
create or replace function public.obra_guardar_admin_empresa(
  p_actor_id text, p_actor_nombre text, p_empresa_id uuid, p_email text, p_nombre text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_usuarios%rowtype;
  v_email text := lower(btrim(p_email));
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  if not exists (select 1 from public.obra_empresas where id = p_empresa_id) then
    raise exception 'obra:no-existe';
  end if;
  -- The quota of people comes from the license: without one there is nobody to name yet.
  if p_admin and (public.obra_licencia_vigente(p_empresa_id)).id is null then
    raise exception 'obra:licencia-no-vigente';
  end if;
  select * into v_antes from public.obra_usuarios where empresa_id = p_empresa_id and email = v_email for update;
  if not found then
    if not p_admin then
      raise exception 'obra:no-existe';
    end if;
    if (select count(*) from public.obra_usuarios where empresa_id = p_empresa_id and activo)
       >= coalesce((public.obra_licencia_vigente(p_empresa_id)).max_usuarios, 0) then
      raise exception 'obra:cupo-usuarios';
    end if;
    insert into public.obra_usuarios (id, empresa_id, user_id, email, nombre, admin_empresa, activo, otorgado_por, actualizado_por)
    values (gen_random_uuid(), p_empresa_id, null, v_email, coalesce(btrim(p_nombre), ''), true, true, p_actor_nombre, p_actor_nombre);
  else
    if p_admin and not v_antes.activo
       and (select count(*) from public.obra_usuarios where empresa_id = p_empresa_id and activo)
           >= coalesce((public.obra_licencia_vigente(p_empresa_id)).max_usuarios, 0) then
      raise exception 'obra:cupo-usuarios';
    end if;
    update public.obra_usuarios
       set admin_empresa = p_admin, activo = case when p_admin then true else activo end,
           nombre = case when btrim(coalesce(p_nombre, '')) <> '' then btrim(p_nombre) else nombre end,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where id = v_antes.id;
  end if;
  perform public.obra_registrar(p_empresa_id, null, p_actor_id, p_actor_nombre,
    case when p_admin then 'administradores.nombrar' else 'administradores.quitar' end, 'empresas', 'usuario', v_email,
    jsonb_build_object('email', v_email, 'adminEmpresa', jsonb_build_array(coalesce(v_antes.admin_empresa, false), p_admin)));
end;
$$;

-- ---------------------------------------------------------------- personas y proyectos

-- La primera vez que una persona invitada por correo abre Control de Obra, se guarda su id de
-- usuario de Trimble (el correo lo da Trimble Connect con su sesión). Devuelve cuántas filas ligó.
create or replace function public.obra_vincular_usuario(p_email text, p_user_id text, p_nombre text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.obra_usuarios%rowtype;
  v_ligadas integer := 0;
begin
  for r in
    select * from public.obra_usuarios u
     where u.email = lower(btrim(p_email)) and u.user_id is null
       and not exists (select 1 from public.obra_usuarios o where o.empresa_id = u.empresa_id and o.user_id = p_user_id)
     for update
  loop
    update public.obra_usuarios
       set user_id = p_user_id, nombre = case when nombre = '' then coalesce(btrim(p_nombre), '') else nombre end,
           version = version + 1, actualizado = now(), actualizado_por = p_nombre
     where id = r.id;
    perform public.obra_registrar(r.empresa_id, null, p_user_id, p_nombre, 'usuarios.vincular', 'accesos', 'usuario', r.email,
      jsonb_build_object('email', r.email));
    v_ligadas := v_ligadas + 1;
  end loop;
  return v_ligadas;
end;
$$;

-- Registra un proyecto de Trimble Connect en la empresa (la app exige además que quien lo hace
-- sea administrador del proyecto en Trimble).
create or replace function public.obra_vincular_proyecto(
  p_empresa_id uuid, p_project_id text, p_project_name text, p_actor_id text, p_actor_nombre text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  perform pg_advisory_xact_lock(hashtext('obra-proyecto:' || p_project_id));
  if not public.obra_licencia_usable(p_empresa_id) then
    raise exception 'obra:licencia-no-vigente';
  end if;
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) then
    raise exception 'obra:solo-admin-empresa';
  end if;
  if exists (select 1 from public.obra_empresa_proyectos where project_id = p_project_id and activo) then
    raise exception 'obra:ya-vinculado';
  end if;
  if (select count(*) from public.obra_empresa_proyectos where empresa_id = p_empresa_id and activo)
     >= (public.obra_licencia_vigente(p_empresa_id)).max_proyectos then
    raise exception 'obra:cupo-proyectos';
  end if;
  insert into public.obra_empresa_proyectos (empresa_id, project_id, project_name, activo, vinculado_por)
  values (p_empresa_id, p_project_id, coalesce(p_project_name, ''), true, p_actor_nombre)
  on conflict (empresa_id, project_id) do update
     set activo = true, project_name = excluded.project_name, vinculado_por = excluded.vinculado_por,
         vinculado = now(), desvinculado_por = null, motivo = '';
  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre, 'proyecto.vincular', 'accesos', 'proyecto', p_project_id,
    jsonb_build_object('proyecto', p_project_name));
end;
$$;

-- Retira un proyecto de la empresa (con motivo). Sus datos quedan; nadie entra hasta registrarlo de nuevo.
create or replace function public.obra_desvincular_proyecto(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) then
    raise exception 'obra:solo-admin-empresa';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'obra:motivo-requerido';
  end if;
  update public.obra_empresa_proyectos
     set activo = false, desvinculado_por = p_actor_nombre, motivo = btrim(p_motivo)
   where empresa_id = p_empresa_id and project_id = p_project_id and activo;
  if not found then
    raise exception 'obra:sin-empresa';
  end if;
  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre, 'proyecto.desvincular', 'accesos', 'proyecto', p_project_id,
    '{}'::jsonb, btrim(p_motivo));
end;
$$;

-- Crea o cambia un rol de la empresa. Solo administradores de la empresa; nadie cambia un rol
-- que tiene asignado (cambiaría sus propios permisos). Devuelve la nueva versión.
create or replace function public.obra_guardar_rol(
  p_empresa_id uuid, p_actor_id text, p_actor_nombre text,
  p_id uuid, p_nombre text, p_descripcion text, p_permisos text[], p_activo boolean, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_roles%rowtype;
  v_existia boolean;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) then
    raise exception 'obra:solo-admin-empresa';
  end if;
  if exists (select 1 from public.obra_asignaciones where empresa_id = p_empresa_id and user_id = p_actor_id and rol_id = p_id and activo) then
    raise exception 'obra:propio';
  end if;
  select * into v_antes from public.obra_roles where id = p_id for update;
  v_existia := found;
  if v_existia and v_antes.empresa_id <> p_empresa_id then
    raise exception 'obra:otra-empresa';
  end if;
  if v_existia and v_antes.sistema and not p_activo then
    raise exception 'obra:rol-protegido';
  end if;
  if v_existia then
    update public.obra_roles
       set nombre = btrim(p_nombre), descripcion = p_descripcion, permisos = p_permisos, activo = p_activo,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where id = p_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_roles (id, empresa_id, clave, nombre, descripcion, sistema, activo, permisos, actualizado_por)
    values (p_id, p_empresa_id, 'personal_' || replace(left(p_id::text, 13), '-', ''), btrim(p_nombre), p_descripcion, false, p_activo, p_permisos, p_actor_nombre);
    v_version := 1;
  end if;
  perform public.obra_registrar(p_empresa_id, null, p_actor_id, p_actor_nombre,
    case when v_existia then 'roles.cambiar' else 'roles.crear' end, 'accesos', 'rol', p_id::text,
    jsonb_build_object(
      'nombre', btrim(p_nombre),
      'agregados', to_jsonb(array(select unnest(p_permisos) except select unnest(coalesce(v_antes.permisos, '{}'::text[])))),
      'quitados', to_jsonb(array(select unnest(coalesce(v_antes.permisos, '{}'::text[])) except select unnest(p_permisos))),
      'activo', p_activo));
  return v_version;
end;
$$;

-- Da, cambia o revoca el rol de una persona en un proyecto. Administradores de la empresa o
-- del proyecto; nadie cambia el suyo; el de proyecto no nombra administradores ni cambia a
-- otro administrador de proyecto. Si la persona no está en la empresa, se agrega (dentro del
-- cupo de la licencia). Devuelve la nueva versión.
create or replace function public.obra_guardar_asignacion(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text,
  p_user_id text, p_nombre text, p_email text, p_rol_id uuid, p_admin_proyecto boolean,
  p_desde date, p_hasta date, p_activo boolean, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_empresa boolean;
  v_rol public.obra_roles%rowtype;
  v_persona public.obra_usuarios%rowtype;
  v_antes public.obra_asignaciones%rowtype;
  v_rol_antes text;
  v_existia boolean;
  v_version integer;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  if not exists (select 1 from public.obra_empresa_proyectos where empresa_id = p_empresa_id and project_id = p_project_id and activo) then
    raise exception 'obra:sin-empresa';
  end if;
  v_admin_empresa := public.obra_es_admin_empresa(p_empresa_id, p_actor_id);
  if not v_admin_empresa and not public.obra_es_admin_proyecto(p_empresa_id, p_project_id, p_actor_id) then
    raise exception 'obra:no-admin';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'obra:propio';
  end if;
  select * into v_rol from public.obra_roles where empresa_id = p_empresa_id and id = p_rol_id;
  if not found or (p_activo and not v_rol.activo) then
    raise exception 'obra:rol-no-valido';
  end if;
  select * into v_antes from public.obra_asignaciones where empresa_id = p_empresa_id and project_id = p_project_id and user_id = p_user_id for update;
  v_existia := found;
  if not v_admin_empresa then
    if p_admin_proyecto then
      raise exception 'obra:solo-admin-empresa';
    end if;
    if v_existia and v_antes.admin_proyecto then
      raise exception 'obra:es-administrador';
    end if;
  end if;

  -- The person in the company: by Trimble id, or the invitation by e-mail; else a new one.
  select * into v_persona from public.obra_usuarios where empresa_id = p_empresa_id and user_id = p_user_id for update;
  if not found and v_email <> '' then
    select * into v_persona from public.obra_usuarios where empresa_id = p_empresa_id and email = v_email and user_id is null for update;
    if found then
      update public.obra_usuarios set user_id = p_user_id, version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
       where id = v_persona.id;
      v_persona.user_id := p_user_id;
    end if;
  end if;
  if v_persona.id is null then
    if p_activo and (select count(*) from public.obra_usuarios where empresa_id = p_empresa_id and activo)
                    >= (public.obra_licencia_vigente(p_empresa_id)).max_usuarios then
      raise exception 'obra:cupo-usuarios';
    end if;
    if v_email = '' then
      raise exception 'obra:datos';
    end if;
    insert into public.obra_usuarios (id, empresa_id, user_id, email, nombre, activo, otorgado_por, actualizado_por)
    values (gen_random_uuid(), p_empresa_id, p_user_id, v_email, coalesce(btrim(p_nombre), ''), true, p_actor_nombre, p_actor_nombre);
  elsif not v_persona.activo and p_activo then
    raise exception 'obra:usuario-inactivo';
  end if;

  if v_existia then
    select nombre into v_rol_antes from public.obra_roles where id = v_antes.rol_id;
    update public.obra_asignaciones
       set nombre = coalesce(btrim(p_nombre), nombre), email = case when v_email <> '' then v_email else email end,
           rol_id = p_rol_id, admin_proyecto = p_admin_proyecto, desde = p_desde, hasta = p_hasta, activo = p_activo,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where empresa_id = p_empresa_id and project_id = p_project_id and user_id = p_user_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_asignaciones (empresa_id, project_id, user_id, nombre, email, rol_id, admin_proyecto, desde, hasta, activo, otorgado_por, actualizado_por)
    values (p_empresa_id, p_project_id, p_user_id, coalesce(btrim(p_nombre), ''), v_email, p_rol_id, p_admin_proyecto, p_desde, p_hasta, p_activo, p_actor_nombre, p_actor_nombre);
    v_version := 1;
  end if;

  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre,
    case when not v_existia then 'accesos.asignar' when not p_activo then 'accesos.revocar' else 'accesos.cambiar' end,
    'accesos', 'usuario', p_user_id,
    jsonb_build_object(
      'persona', coalesce(btrim(p_nombre), p_user_id),
      'antes', case when v_existia then jsonb_build_object('rol', v_rol_antes, 'adminProyecto', v_antes.admin_proyecto, 'desde', v_antes.desde, 'hasta', v_antes.hasta, 'activo', v_antes.activo) end,
      'despues', jsonb_build_object('rol', v_rol.nombre, 'adminProyecto', p_admin_proyecto, 'desde', p_desde, 'hasta', p_hasta, 'activo', p_activo)));
  return v_version;
end;
$$;

-- Activa o desactiva a una persona en toda la empresa (los administradores de la empresa los
-- cambia solo el administrador técnico). Devuelve la nueva versión.
create or replace function public.obra_guardar_usuario(
  p_empresa_id uuid, p_actor_id text, p_actor_nombre text, p_id uuid, p_activo boolean, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_usuarios%rowtype;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('obra-accesos:' || p_empresa_id::text));
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) then
    raise exception 'obra:solo-admin-empresa';
  end if;
  select * into v_antes from public.obra_usuarios where empresa_id = p_empresa_id and id = p_id for update;
  if not found then
    raise exception 'obra:no-existe';
  end if;
  if v_antes.user_id = p_actor_id then
    raise exception 'obra:propio';
  end if;
  if v_antes.admin_empresa then
    raise exception 'obra:es-administrador';
  end if;
  if p_activo and not v_antes.activo
     and (select count(*) from public.obra_usuarios where empresa_id = p_empresa_id and activo)
         >= (public.obra_licencia_vigente(p_empresa_id)).max_usuarios then
    raise exception 'obra:cupo-usuarios';
  end if;
  update public.obra_usuarios
     set activo = p_activo, version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
   where id = p_id and version = p_version
  returning version into v_version;
  if v_version is null then
    raise exception 'version-conflict';
  end if;
  perform public.obra_registrar(p_empresa_id, null, p_actor_id, p_actor_nombre,
    case when p_activo then 'usuarios.activar' else 'usuarios.desactivar' end, 'accesos', 'usuario', coalesce(v_antes.user_id, v_antes.email),
    jsonb_build_object('persona', coalesce(nullif(v_antes.nombre, ''), v_antes.email)));
  return v_version;
end;
$$;

-- ---------------------------------------------------------------- configuración y estructura

-- El nivel que rige en un proyecto con esta clave: el propio del proyecto o el de la plantilla.
create or replace function public.obra_nivel_efectivo(p_empresa_id uuid, p_project_id text, p_clave text)
returns public.obra_niveles
language sql
stable
set search_path = public
as $$
  select * from public.obra_niveles
   where empresa_id = p_empresa_id and clave = p_clave and (project_id = p_project_id or project_id is null)
   order by (project_id is null) limit 1
$$;

-- Guarda la configuración del proyecto (administradores de la empresa o del proyecto).
create or replace function public.obra_guardar_config(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text,
  p_responsable_id text, p_responsable_nombre text, p_tolerancia numeric, p_permite_obs boolean, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_config%rowtype;
  v_version integer;
begin
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) and not public.obra_es_admin_proyecto(p_empresa_id, p_project_id, p_actor_id) then
    raise exception 'obra:no-admin';
  end if;
  select * into v_antes from public.obra_config where empresa_id = p_empresa_id and project_id = p_project_id for update;
  if found then
    update public.obra_config
       set responsable_tecnico_id = p_responsable_id, responsable_tecnico_nombre = coalesce(p_responsable_nombre, ''),
           tolerancia_verificacion_pct = p_tolerancia, permite_aceptado_con_observaciones = p_permite_obs,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where empresa_id = p_empresa_id and project_id = p_project_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_config (empresa_id, project_id, responsable_tecnico_id, responsable_tecnico_nombre, tolerancia_verificacion_pct, permite_aceptado_con_observaciones, actualizado_por)
    values (p_empresa_id, p_project_id, p_responsable_id, coalesce(p_responsable_nombre, ''), p_tolerancia, p_permite_obs, p_actor_nombre);
    v_version := 1;
  end if;
  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre, 'config.cambiar', 'estructura', 'proyecto', p_project_id,
    jsonb_build_object(
      'responsableTecnico', jsonb_build_array(v_antes.responsable_tecnico_nombre, coalesce(p_responsable_nombre, '')),
      'toleranciaVerificacionPct', jsonb_build_array(v_antes.tolerancia_verificacion_pct, p_tolerancia),
      'permiteAceptadoConObservaciones', jsonb_build_array(v_antes.permite_aceptado_con_observaciones, p_permite_obs)));
  return v_version;
end;
$$;

-- Crea o cambia un nivel de la plantilla de la empresa (p_project_id null: solo administradores
-- de la empresa) o de un proyecto (administradores de la empresa o de ese proyecto).
create or replace function public.obra_guardar_nivel(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text,
  p_id uuid, p_clave text, p_nombre text, p_orden integer, p_padre_clave text, p_fuente text, p_clave_fuente text,
  p_activo boolean, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.obra_niveles%rowtype;
  v_existia boolean;
  v_version integer;
  v_actual text;
  v_pasos integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('obra-estructura:' || p_empresa_id::text));
  if p_project_id is null then
    if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) then
      raise exception 'obra:solo-admin-empresa';
    end if;
  else
    if not exists (select 1 from public.obra_empresa_proyectos where empresa_id = p_empresa_id and project_id = p_project_id and activo) then
      raise exception 'obra:sin-empresa';
    end if;
    if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) and not public.obra_es_admin_proyecto(p_empresa_id, p_project_id, p_actor_id) then
      raise exception 'obra:no-admin';
    end if;
  end if;

  -- The parent must be a level in force where this one applies, without cycles.
  if p_padre_clave is not null then
    v_actual := p_padre_clave;
    while v_actual is not null loop
      v_pasos := v_pasos + 1;
      if v_actual = p_clave or v_pasos > 50 then
        raise exception 'obra:padre-no-valido';
      end if;
      select n.padre_clave into v_actual
        from public.obra_niveles n
       where n.empresa_id = p_empresa_id and n.clave = v_actual and n.activo
         and (n.project_id is null or n.project_id = p_project_id)
       order by (n.project_id is null) limit 1;
      if not found then
        raise exception 'obra:padre-no-valido';
      end if;
    end loop;
  end if;

  select * into v_antes from public.obra_niveles where id = p_id for update;
  v_existia := found;
  if v_existia then
    if v_antes.empresa_id <> p_empresa_id or v_antes.project_id is distinct from p_project_id then
      raise exception 'obra:otra-empresa';
    end if;
    if v_antes.clave <> p_clave then
      raise exception 'obra:datos';
    end if;
    update public.obra_niveles
       set nombre = btrim(p_nombre), orden = p_orden, padre_clave = p_padre_clave, fuente = p_fuente, clave_fuente = coalesce(p_clave_fuente, ''),
           activo = p_activo, version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where id = p_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_niveles (id, empresa_id, project_id, clave, nombre, orden, padre_clave, fuente, clave_fuente, activo, actualizado_por)
    values (p_id, p_empresa_id, p_project_id, p_clave, btrim(p_nombre), p_orden, p_padre_clave, p_fuente, coalesce(p_clave_fuente, ''), p_activo, p_actor_nombre);
    v_version := 1;
  end if;
  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre,
    case when v_existia then 'estructura.nivel.cambiar' else 'estructura.nivel.crear' end, 'estructura', 'nivel', p_clave,
    jsonb_build_object('alcance', case when p_project_id is null then 'plantilla' else 'proyecto' end, 'nombre', btrim(p_nombre),
                       'fuente', p_fuente, 'claveFuente', coalesce(p_clave_fuente, ''), 'padre', p_padre_clave, 'activo', p_activo,
                       'antes', case when v_existia then jsonb_build_object('nombre', v_antes.nombre, 'fuente', v_antes.fuente, 'claveFuente', v_antes.clave_fuente, 'padre', v_antes.padre_clave, 'activo', v_antes.activo) end));
  return v_version;
end;
$$;

-- Crea o cambia un valor de un nivel en un proyecto (administradores de la empresa o del proyecto).
create or replace function public.obra_guardar_nodo(
  p_empresa_id uuid, p_project_id text, p_actor_id text, p_actor_nombre text,
  p_id uuid, p_nivel_clave text, p_valor text, p_padre_id uuid, p_responsable_id text, p_responsable_nombre text,
  p_inicio date, p_fin date, p_estado text, p_nota text, p_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nivel public.obra_niveles%rowtype;
  v_padre public.obra_nodos%rowtype;
  v_antes public.obra_nodos%rowtype;
  v_existia boolean;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('obra-estructura:' || p_empresa_id::text));
  if not exists (select 1 from public.obra_empresa_proyectos where empresa_id = p_empresa_id and project_id = p_project_id and activo) then
    raise exception 'obra:sin-empresa';
  end if;
  if not public.obra_es_admin_empresa(p_empresa_id, p_actor_id) and not public.obra_es_admin_proyecto(p_empresa_id, p_project_id, p_actor_id) then
    raise exception 'obra:no-admin';
  end if;
  v_nivel := public.obra_nivel_efectivo(p_empresa_id, p_project_id, p_nivel_clave);
  if v_nivel.id is null or not v_nivel.activo then
    raise exception 'obra:nivel-no-valido';
  end if;
  if p_padre_id is not null then
    select * into v_padre from public.obra_nodos where empresa_id = p_empresa_id and project_id = p_project_id and id = p_padre_id;
    if not found or v_nivel.padre_clave is null or v_padre.nivel_clave <> v_nivel.padre_clave then
      raise exception 'obra:padre-no-valido';
    end if;
  end if;

  select * into v_antes from public.obra_nodos where id = p_id for update;
  v_existia := found;
  if v_existia then
    if v_antes.empresa_id <> p_empresa_id or v_antes.project_id <> p_project_id then
      raise exception 'obra:otra-empresa';
    end if;
    if v_antes.nivel_clave <> p_nivel_clave then
      raise exception 'obra:datos';
    end if;
    update public.obra_nodos
       set valor = btrim(p_valor), padre_id = p_padre_id, responsable_id = p_responsable_id, responsable_nombre = coalesce(btrim(p_responsable_nombre), ''),
           inicio = p_inicio, fin = p_fin, estado = p_estado, nota = coalesce(p_nota, ''),
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where id = p_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.obra_nodos (id, empresa_id, project_id, nivel_clave, valor, padre_id, responsable_id, responsable_nombre, inicio, fin, estado, nota, creado_por, actualizado_por)
    values (p_id, p_empresa_id, p_project_id, p_nivel_clave, btrim(p_valor), p_padre_id, p_responsable_id, coalesce(btrim(p_responsable_nombre), ''),
            p_inicio, p_fin, p_estado, coalesce(p_nota, ''), p_actor_nombre, p_actor_nombre);
    v_version := 1;
  end if;
  perform public.obra_registrar(p_empresa_id, p_project_id, p_actor_id, p_actor_nombre,
    case when v_existia then 'estructura.nodo.cambiar' else 'estructura.nodo.crear' end, 'estructura', 'nodo', p_id::text,
    jsonb_build_object('nivel', p_nivel_clave, 'valor', btrim(p_valor), 'responsable', coalesce(btrim(p_responsable_nombre), ''),
                       'inicio', p_inicio, 'fin', p_fin, 'estado', p_estado,
                       'antes', case when v_existia then jsonb_build_object('valor', v_antes.valor, 'responsable', v_antes.responsable_nombre, 'inicio', v_antes.inicio, 'fin', v_antes.fin, 'estado', v_antes.estado) end));
  return v_version;
end;
$$;

-- ---------------------------------------------------------------- seguridad

alter table public.obra_migraciones enable row level security;
alter table public.obra_empresas enable row level security;
alter table public.obra_licencias enable row level security;
alter table public.obra_empresa_proyectos enable row level security;
alter table public.obra_roles enable row level security;
alter table public.obra_usuarios enable row level security;
alter table public.obra_asignaciones enable row level security;
alter table public.obra_config enable row level security;
alter table public.obra_niveles enable row level security;
alter table public.obra_nodos enable row level security;
alter table public.obra_bitacora enable row level security;

-- Only the app's server (service role) uses these tables and functions. It can only read the
-- tables (and add rows to the bitácora): every change goes through the functions above, which
-- run as the tables' owner (security definer) and check the rules, so not even the server's
-- key can write around them.
revoke all on table public.obra_migraciones, public.obra_empresas, public.obra_licencias, public.obra_empresa_proyectos, public.obra_roles,
  public.obra_usuarios, public.obra_asignaciones, public.obra_config, public.obra_niveles, public.obra_nodos, public.obra_bitacora
  from anon, authenticated;
grant select on table public.obra_migraciones, public.obra_empresas, public.obra_empresa_proyectos, public.obra_roles, public.obra_usuarios,
  public.obra_asignaciones, public.obra_config, public.obra_niveles, public.obra_nodos to service_role;
revoke update, delete, truncate on table public.obra_licencias, public.obra_bitacora from public, anon, authenticated, service_role;
grant select on table public.obra_licencias to service_role;
grant select, insert on table public.obra_bitacora to service_role;

revoke all on function public.obra_permisos_validos() from public, anon, authenticated;
revoke all on function public.obra_grupos_validos() from public, anon, authenticated;
revoke all on function public.obra_grupo_de_modulo(text) from public, anon, authenticated;
revoke all on function public.obra_hoy() from public, anon, authenticated;
revoke all on function public.obra_solo_insercion() from public, anon, authenticated;
revoke all on function public.obra_bitacora_canon(public.obra_bitacora) from public, anon, authenticated;
revoke all on function public.obra_bitacora_encadenar() from public, anon, authenticated;
revoke all on function public.obra_bitacora_verificar(text) from public, anon, authenticated;
revoke all on function public.obra_registrar(uuid, text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.obra_licencia_vigente(uuid) from public, anon, authenticated;
revoke all on function public.obra_licencia_usable(uuid) from public, anon, authenticated;
revoke all on function public.obra_es_admin_empresa(uuid, text) from public, anon, authenticated;
revoke all on function public.obra_asignacion_vigente(uuid, text, text) from public, anon, authenticated;
revoke all on function public.obra_es_admin_proyecto(uuid, text, text) from public, anon, authenticated;
revoke all on function public.obra_permisos_de(uuid, text, text) from public, anon, authenticated;
revoke all on function public.obra_guardar_empresa(text, text, uuid, text, text, smallint, boolean, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.obra_registrar_licencia(text, text, uuid, uuid, text, text, date, date, integer, integer, text[], boolean, text, text) from public, anon, authenticated;
revoke all on function public.obra_guardar_admin_empresa(text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.obra_vincular_usuario(text, text, text) from public, anon, authenticated;
revoke all on function public.obra_vincular_proyecto(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.obra_desvincular_proyecto(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.obra_guardar_rol(uuid, text, text, uuid, text, text, text[], boolean, integer) from public, anon, authenticated;
revoke all on function public.obra_guardar_asignacion(uuid, text, text, text, text, text, text, uuid, boolean, date, date, boolean, integer) from public, anon, authenticated;
revoke all on function public.obra_guardar_usuario(uuid, text, text, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.obra_nivel_efectivo(uuid, text, text) from public, anon, authenticated;
revoke all on function public.obra_guardar_config(uuid, text, text, text, text, text, numeric, boolean, integer) from public, anon, authenticated;
revoke all on function public.obra_guardar_nivel(uuid, text, text, text, uuid, text, text, integer, text, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.obra_guardar_nodo(uuid, text, text, text, uuid, text, text, uuid, text, text, date, date, text, text, integer) from public, anon, authenticated;
grant execute on function public.obra_permisos_validos() to service_role;
grant execute on function public.obra_grupos_validos() to service_role;
grant execute on function public.obra_grupo_de_modulo(text) to service_role;
grant execute on function public.obra_hoy() to service_role;
grant execute on function public.obra_bitacora_canon(public.obra_bitacora) to service_role;
grant execute on function public.obra_bitacora_verificar(text) to service_role;
grant execute on function public.obra_licencia_vigente(uuid) to service_role;
grant execute on function public.obra_licencia_usable(uuid) to service_role;
grant execute on function public.obra_es_admin_empresa(uuid, text) to service_role;
grant execute on function public.obra_asignacion_vigente(uuid, text, text) to service_role;
grant execute on function public.obra_es_admin_proyecto(uuid, text, text) to service_role;
grant execute on function public.obra_permisos_de(uuid, text, text) to service_role;
grant execute on function public.obra_guardar_empresa(text, text, uuid, text, text, smallint, boolean, integer, jsonb, jsonb) to service_role;
grant execute on function public.obra_registrar_licencia(text, text, uuid, uuid, text, text, date, date, integer, integer, text[], boolean, text, text) to service_role;
grant execute on function public.obra_guardar_admin_empresa(text, text, uuid, text, text, boolean) to service_role;
grant execute on function public.obra_vincular_usuario(text, text, text) to service_role;
grant execute on function public.obra_vincular_proyecto(uuid, text, text, text, text) to service_role;
grant execute on function public.obra_desvincular_proyecto(uuid, text, text, text, text) to service_role;
grant execute on function public.obra_guardar_rol(uuid, text, text, uuid, text, text, text[], boolean, integer) to service_role;
grant execute on function public.obra_guardar_asignacion(uuid, text, text, text, text, text, text, uuid, boolean, date, date, boolean, integer) to service_role;
grant execute on function public.obra_guardar_usuario(uuid, text, text, uuid, boolean, integer) to service_role;
grant execute on function public.obra_nivel_efectivo(uuid, text, text) to service_role;
grant execute on function public.obra_guardar_config(uuid, text, text, text, text, text, numeric, boolean, integer) to service_role;
grant execute on function public.obra_guardar_nivel(uuid, text, text, text, uuid, text, text, integer, text, text, text, boolean, integer) to service_role;
grant execute on function public.obra_guardar_nodo(uuid, text, text, text, uuid, text, text, uuid, text, text, date, date, text, text, integer) to service_role;

insert into public.obra_migraciones (bloque, descripcion)
values (1, 'Base comercial: empresas, licencias, personas, roles, accesos, estructura de obra y bitácora')
on conflict (bloque) do nothing;
