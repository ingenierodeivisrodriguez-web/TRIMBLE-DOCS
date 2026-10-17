-- Servicio de datos de "Compras y Contratación": quién entra a la herramienta en cada
-- proyecto (roles con su matriz de permisos y las personas autorizadas, por id de
-- usuario de Trimble Connect) y la auditoría de todo lo que se hace o se intenta.
-- Ejecútalo en Supabase → SQL Editor. Es seguro volver a ejecutarlo: no borra datos.
--
-- Solo el servidor de la app (clave de servicio) lee y escribe: RLS activado sin
-- políticas. Las reglas de accesos se revisan aquí también (no solo en la app):
-- nadie se cambia a sí mismo, nadie da más permisos de los que tiene y siempre
-- queda un Administrador de plataforma. La auditoría solo admite inserciones.
-- Compras nunca escribe en las tablas presupuesto_*.

-- Todos los permisos posibles ("modulo.accion"); la app tiene la misma lista
-- (lib/compras/types.ts, PERMISOS_VALIDOS) y una prueba verifica que coincidan.
create or replace function public.compras_permisos_validos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'accesos.ver', 'accesos.administrar', 'auditoria.ver', 'insumos.ver', 'requisiciones.ver',
    'requisiciones.crear', 'requisiciones.editar', 'requisiciones.aprobar', 'requisiciones.exceder',
    'requisiciones.anular', 'requisiciones.documentos', 'proveedores.ver', 'proveedores.crear',
    'proveedores.editar',
    'proveedores.anular', 'proveedores.documentos', 'cotizaciones.ver', 'cotizaciones.crear',
    'cotizaciones.editar', 'cotizaciones.aprobar', 'cotizaciones.anular',
    'cotizaciones.documentos', 'ordenes.ver', 'ordenes.crear', 'ordenes.editar', 'ordenes.aprobar',
    'ordenes.anular', 'ordenes.documentos', 'contratos.ver', 'contratos.crear', 'contratos.editar',
    'contratos.aprobar', 'contratos.anular', 'contratos.documentos', 'documentos.ver',
    'documentos.administrar', 'recepciones.ver', 'recepciones.crear', 'recepciones.editar',
    'recepciones.aprobar', 'recepciones.anular', 'recepciones.documentos', 'panel.ver'
  ]::text[]
$$;

-- Hoy en Colombia (las vigencias de los accesos son por día).
create or replace function public.compras_hoy()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Bogota')::date
$$;

-- Roles de cada proyecto con su matriz de permisos. Los iniciales (sistema) se crean al
-- activar Compras; el de Administrador de plataforma siempre tiene todos los permisos.
create table if not exists public.compras_roles (
  id              uuid        primary key,
  project_id      text        not null,
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
  unique (project_id, clave),
  unique (project_id, id)
);
create unique index if not exists compras_roles_nombre_unico on public.compras_roles (project_id, lower(btrim(nombre)));
alter table public.compras_roles drop constraint if exists compras_roles_permisos_validos;
alter table public.compras_roles add constraint compras_roles_permisos_validos check (permisos <@ public.compras_permisos_validos());

-- Personas autorizadas: un rol por persona y proyecto, vigente de `desde` a `hasta`
-- (null: sin fin). Revocar es `activo = false`; la fila no se borra.
create table if not exists public.compras_usuarios (
  project_id      text        not null,
  user_id         text        not null check (char_length(user_id) between 1 and 100),
  nombre          text        not null default '',
  email           text        not null default '',
  rol_id          uuid        not null,
  desde           date        not null,
  hasta           date,
  activo          boolean     not null default true,
  version         integer     not null default 1,
  otorgado_por    text        not null,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  primary key (project_id, user_id),
  foreign key (project_id, rol_id) references public.compras_roles (project_id, id),
  check (hasta is null or hasta >= desde)
);
create index if not exists compras_usuarios_rol on public.compras_usuarios (rol_id);

-- Auditoría: quién, a quién, qué, en qué proyecto, cuándo y con qué resultado.
-- Solo inserción: un trigger rechaza cualquier cambio o borrado.
create table if not exists public.compras_auditoria (
  id            bigint      generated always as identity primary key,
  creado        timestamptz not null default now(),
  project_id    text        not null,
  actor_id      text        not null,
  actor_nombre  text        not null default '',
  accion        text        not null check (char_length(accion) between 1 and 60),
  modulo        text        not null default '',
  objeto_tipo   text        not null default '',
  objeto_id     text        not null default '',
  sujeto_id     text,
  sujeto_nombre text        not null default '',
  resultado     text        not null check (resultado in ('ok', 'denegado', 'error')),
  detalle       jsonb       not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object')
);
create index if not exists compras_auditoria_proyecto on public.compras_auditoria (project_id, id desc);

create or replace function public.compras_auditoria_inmutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'compras:auditoria-inmutable';
end;
$$;

drop trigger if exists compras_auditoria_sin_cambios on public.compras_auditoria;
create trigger compras_auditoria_sin_cambios
  before update or delete on public.compras_auditoria
  for each row execute function public.compras_auditoria_inmutable();
drop trigger if exists compras_auditoria_sin_vaciar on public.compras_auditoria;
create trigger compras_auditoria_sin_vaciar
  before truncate on public.compras_auditoria
  for each statement execute function public.compras_auditoria_inmutable();

-- Los permisos vigentes de una persona en un proyecto (vacío: sin acceso).
create or replace function public.compras_permisos_de(p_project_id text, p_user_id text)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce((
    select r.permisos
      from public.compras_usuarios u
      join public.compras_roles r on r.id = u.rol_id
     where u.project_id = p_project_id and u.user_id = p_user_id
       and u.activo and r.activo
       and u.desde <= public.compras_hoy()
       and (u.hasta is null or u.hasta >= public.compras_hoy())
  ), '{}'::text[])
$$;

-- Activa Compras en un proyecto: crea los roles iniciales (los que falten) y deja a quien
-- la activa como Administrador de plataforma. Solo funciona si el proyecto no tiene ya un
-- administrador vigente (la app exige además que sea administrador del proyecto en Trimble).
create or replace function public.compras_activar(p_project_id text, p_user_id text, p_nombre text, p_email text, p_roles jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_admin uuid;
begin
  perform pg_advisory_xact_lock(hashtext('compras-accesos:' || p_project_id));
  if exists (
    select 1
      from public.compras_usuarios u
      join public.compras_roles r on r.id = u.rol_id
     where u.project_id = p_project_id and r.clave = 'admin_plataforma' and u.activo
       and (u.hasta is null or u.hasta >= public.compras_hoy())
  ) then
    raise exception 'compras:ya-activo';
  end if;

  insert into public.compras_roles (id, project_id, clave, nombre, descripcion, sistema, permisos, actualizado_por)
  select gen_random_uuid(), p_project_id, r ->> 'clave', r ->> 'nombre', coalesce(r ->> 'descripcion', ''), true,
         array(select jsonb_array_elements_text(r -> 'permisos')), p_nombre
    from jsonb_array_elements(p_roles) r
  on conflict (project_id, clave) do nothing;

  update public.compras_roles
     set permisos = public.compras_permisos_validos(), activo = true
   where project_id = p_project_id and clave = 'admin_plataforma'
  returning id into v_admin;
  if v_admin is null then
    raise exception 'compras:rol-no-valido';
  end if;

  insert into public.compras_usuarios (project_id, user_id, nombre, email, rol_id, desde, hasta, activo, version, otorgado_por, actualizado_por)
  values (p_project_id, p_user_id, p_nombre, p_email, v_admin, public.compras_hoy(), null, true, 1, p_nombre, p_nombre)
  on conflict (project_id, user_id) do update
     set nombre = excluded.nombre, email = excluded.email, rol_id = excluded.rol_id, desde = excluded.desde,
         hasta = null, activo = true, version = public.compras_usuarios.version + 1,
         actualizado = now(), actualizado_por = excluded.actualizado_por;

  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (p_project_id, p_user_id, p_nombre, 'proyecto.activar', 'accesos', 'proyecto', p_project_id, p_user_id, p_nombre, 'ok',
          jsonb_build_object('rol', 'Administrador de plataforma'));
end;
$$;

-- Da, cambia o revoca el acceso de una persona. Devuelve la nueva versión.
create or replace function public.compras_guardar_usuario(
  p_project_id text, p_actor_id text, p_actor_nombre text,
  p_user_id text, p_nombre text, p_email text, p_rol_id uuid,
  p_desde date, p_hasta date, p_activo boolean, p_version integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_mios text[];
  v_rol public.compras_roles%rowtype;
  v_antes public.compras_usuarios%rowtype;
  v_rol_antes public.compras_roles%rowtype;
  v_existia boolean;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('compras-accesos:' || p_project_id));
  v_mios := public.compras_permisos_de(p_project_id, p_actor_id);
  if not ('accesos.administrar' = any (v_mios)) then
    raise exception 'compras:sin-permiso';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'compras:propio';
  end if;

  select * into v_rol from public.compras_roles where project_id = p_project_id and id = p_rol_id;
  if not found or (p_activo and not v_rol.activo) then
    raise exception 'compras:rol-no-valido';
  end if;
  if not (v_rol.permisos <@ v_mios) then
    raise exception 'compras:escalamiento';
  end if;

  select * into v_antes from public.compras_usuarios where project_id = p_project_id and user_id = p_user_id for update;
  v_existia := found;
  if v_existia then
    select * into v_rol_antes from public.compras_roles where id = v_antes.rol_id;
    if not (v_rol_antes.permisos <@ v_mios) then
      raise exception 'compras:escalamiento';
    end if;
    update public.compras_usuarios
       set nombre = p_nombre, email = p_email, rol_id = p_rol_id, desde = p_desde, hasta = p_hasta, activo = p_activo,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where project_id = p_project_id and user_id = p_user_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  else
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.compras_usuarios (project_id, user_id, nombre, email, rol_id, desde, hasta, activo, version, otorgado_por, actualizado_por)
    values (p_project_id, p_user_id, p_nombre, p_email, p_rol_id, p_desde, p_hasta, p_activo, 1, p_actor_nombre, p_actor_nombre);
    v_version := 1;
  end if;

  -- Always at least one Administrador de plataforma in force and without an end date.
  if not exists (
    select 1
      from public.compras_usuarios u
      join public.compras_roles r on r.id = u.rol_id
     where u.project_id = p_project_id and r.clave = 'admin_plataforma' and u.activo
       and u.hasta is null and u.desde <= public.compras_hoy()
  ) then
    raise exception 'compras:ultimo-admin';
  end if;

  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (
    p_project_id, p_actor_id, p_actor_nombre,
    case when not v_existia then 'accesos.asignar' when not p_activo then 'accesos.revocar' else 'accesos.cambiar' end,
    'accesos', 'usuario', p_user_id, p_user_id, p_nombre, 'ok',
    jsonb_build_object(
      'antes', case when v_existia then jsonb_build_object('rol', v_rol_antes.nombre, 'desde', v_antes.desde, 'hasta', v_antes.hasta, 'activo', v_antes.activo) end,
      'despues', jsonb_build_object('rol', v_rol.nombre, 'desde', p_desde, 'hasta', p_hasta, 'activo', p_activo)
    )
  );
  return v_version;
end;
$$;

-- Crea o cambia un rol (nombre, descripción, permisos, activo). Devuelve la nueva versión.
create or replace function public.compras_guardar_rol(
  p_project_id text, p_actor_id text, p_actor_nombre text,
  p_id uuid, p_nombre text, p_descripcion text, p_permisos text[], p_activo boolean, p_version integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_mios text[];
  v_mi_rol uuid;
  v_antes public.compras_roles%rowtype;
  v_existia boolean;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('compras-accesos:' || p_project_id));
  v_mios := public.compras_permisos_de(p_project_id, p_actor_id);
  if not ('accesos.administrar' = any (v_mios)) then
    raise exception 'compras:sin-permiso';
  end if;
  select * into v_antes from public.compras_roles where project_id = p_project_id and id = p_id for update;
  v_existia := found;
  if v_existia and (v_antes.clave = 'admin_plataforma' or (v_antes.sistema and not p_activo)) then
    raise exception 'compras:rol-protegido';
  end if;
  select rol_id into v_mi_rol from public.compras_usuarios where project_id = p_project_id and user_id = p_actor_id;
  if v_mi_rol = p_id then
    raise exception 'compras:propio';
  end if;
  if not (p_permisos <@ v_mios) then
    raise exception 'compras:escalamiento';
  end if;

  if v_existia then
    if not (v_antes.permisos <@ v_mios) then
      raise exception 'compras:escalamiento';
    end if;
    update public.compras_roles
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
    insert into public.compras_roles (id, project_id, clave, nombre, descripcion, sistema, activo, permisos, actualizado_por)
    values (p_id, p_project_id, 'personal_' || replace(left(p_id::text, 13), '-', ''), btrim(p_nombre), p_descripcion, false, p_activo, p_permisos, p_actor_nombre);
    v_version := 1;
  end if;

  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (
    p_project_id, p_actor_id, p_actor_nombre,
    case when v_existia then 'roles.cambiar' else 'roles.crear' end,
    'accesos', 'rol', p_id::text, null, btrim(p_nombre), 'ok',
    jsonb_build_object(
      'agregados', to_jsonb(array(select unnest(p_permisos) except select unnest(coalesce(v_antes.permisos, '{}'::text[])))),
      'quitados', to_jsonb(array(select unnest(coalesce(v_antes.permisos, '{}'::text[])) except select unnest(p_permisos))),
      'activo', p_activo
    )
  );
  return v_version;
end;
$$;

-- ================================================================ requisiciones

-- Configuración de Compras por proyecto: cuánto (en %) se puede pedir sobre lo planificado
-- sin justificar el exceso.
create table if not exists public.compras_config (
  project_id      text         primary key,
  tolerancia_pct  numeric(5,2) not null default 0 check (tolerancia_pct between 0 and 100),
  version         integer      not null default 1,
  actualizado     timestamptz  not null default now(),
  actualizado_por text
);

-- Consecutivos por proyecto y tipo de documento (REQ-0001...).
create table if not exists public.compras_consecutivos (
  project_id text    not null,
  tipo       text    not null,
  ultimo     integer not null default 0,
  primary key (project_id, tipo)
);

-- Requisiciones: borrador → enviada → aprobada | rechazada | (devuelta: borrador) ; anulada.
-- No se borran.
create table if not exists public.compras_requisiciones (
  id                  uuid        primary key,
  project_id          text        not null,
  numero              integer     not null,
  estado              text        not null default 'borrador' check (estado in ('borrador', 'enviada', 'aprobada', 'rechazada', 'anulada')),
  solicitante_id      text        not null,
  solicitante_nombre  text        not null default '',
  fecha_requerida     date        not null,
  prioridad           text        not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  justificacion       text        not null default '' check (char_length(justificacion) <= 1000),
  motivo              text        not null default '' check (char_length(motivo) <= 1000),
  presupuesto_version integer,
  enviada             timestamptz,
  enviada_por         text,
  decidida            timestamptz,
  decidida_por        text,
  version             integer     not null default 1,
  creada              timestamptz not null default now(),
  actualizado         timestamptz not null default now(),
  actualizado_por     text,
  unique (project_id, numero),
  unique (project_id, id)
);
create index if not exists compras_requisiciones_estado on public.compras_requisiciones (project_id, estado);

-- Líneas: un insumo planificado del presupuesto (con copia de sus datos), la cantidad pedida y la
-- aprobada. insumo_id = clave del insumo en presupuesto_documentos.data.insumos.
create table if not exists public.compras_requisicion_lineas (
  id                   uuid          primary key,
  project_id           text          not null,
  requisicion_id       uuid          not null,
  orden                integer       not null default 0,
  insumo_id            text          not null check (char_length(insumo_id) between 1 and 64),
  partida_item_id      text          check (partida_item_id is null or char_length(partida_item_id) between 1 and 64),
  codigo               text          not null default '',
  descripcion          text          not null default '',
  unidad               text          not null default '',
  tipo                 text          not null check (tipo in ('MO', 'MT', 'EQ', 'SC')),
  precio               numeric       not null default 0 check (precio >= 0),
  cantidad             numeric(18,4) not null check (cantidad > 0),
  cantidad_aprobada    numeric(18,4) check (cantidad_aprobada >= 0 and cantidad_aprobada <= cantidad),
  planificado          numeric(18,4),
  justificacion_exceso text          not null default '' check (char_length(justificacion_exceso) <= 500),
  foreign key (project_id, requisicion_id) references public.compras_requisiciones (project_id, id)
);
create unique index if not exists compras_req_lineas_unica
  on public.compras_requisicion_lineas (requisicion_id, insumo_id, coalesce(partida_item_id, ''));
create index if not exists compras_req_lineas_insumo on public.compras_requisicion_lineas (project_id, insumo_id);

-- Lo pedido de un insumo en el proyecto (enviadas: lo pedido; aprobadas: lo aprobado), sin una requisición.
create or replace function public.compras_solicitado(p_project_id text, p_insumo_id text, p_excluir uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(case when r.estado = 'aprobada' then coalesce(l.cantidad_aprobada, 0) else l.cantidad end), 0)
    from public.compras_requisicion_lineas l
    join public.compras_requisiciones r on r.id = l.requisicion_id
   where l.project_id = p_project_id and l.insumo_id = p_insumo_id
     and r.estado in ('enviada', 'aprobada') and r.id <> p_excluir
$$;

-- Cambia la tolerancia (permiso Accesos y roles: administrar). Devuelve la nueva versión.
create or replace function public.compras_guardar_config(p_project_id text, p_actor_id text, p_actor_nombre text, p_tolerancia numeric, p_version integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_antes numeric;
  v_version integer;
begin
  if not ('accesos.administrar' = any (public.compras_permisos_de(p_project_id, p_actor_id))) then
    raise exception 'compras:sin-permiso';
  end if;
  select tolerancia_pct into v_antes from public.compras_config where project_id = p_project_id for update;
  if not found then
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.compras_config (project_id, tolerancia_pct, version, actualizado_por) values (p_project_id, p_tolerancia, 1, p_actor_nombre);
    v_version := 1;
  else
    update public.compras_config
       set tolerancia_pct = p_tolerancia, version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where project_id = p_project_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  end if;
  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (p_project_id, p_actor_id, p_actor_nombre, 'config.cambiar', 'requisiciones', 'proyecto', p_project_id, null, '', 'ok',
          jsonb_build_object('tolerancia_antes', coalesce(v_antes, 0), 'tolerancia', p_tolerancia));
  return v_version;
end;
$$;

-- Crea (p_version 0) o cambia el borrador de una requisición y reemplaza sus líneas
-- (p_lineas: [{id, orden, insumo_id, partida_item_id, codigo, descripcion, unidad, tipo, precio, cantidad,
-- justificacion_exceso}], con los datos del insumo tomados del presupuesto por la app). Devuelve la versión.
create or replace function public.compras_guardar_requisicion(
  p_project_id text, p_actor_id text, p_actor_nombre text, p_id uuid,
  p_fecha_requerida date, p_prioridad text, p_justificacion text, p_lineas jsonb, p_version integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_mios text[];
  v_req public.compras_requisiciones%rowtype;
  v_numero integer;
  v_version integer;
  v_existia boolean;
begin
  perform pg_advisory_xact_lock(hashtext('compras-requisiciones:' || p_project_id));
  v_mios := public.compras_permisos_de(p_project_id, p_actor_id);
  select * into v_req from public.compras_requisiciones where project_id = p_project_id and id = p_id for update;
  v_existia := found;
  if not v_existia then
    if not ('requisiciones.crear' = any (v_mios)) then
      raise exception 'compras:sin-permiso';
    end if;
    if p_version <> 0 then
      raise exception 'version-conflict';
    end if;
    insert into public.compras_consecutivos (project_id, tipo, ultimo) values (p_project_id, 'requisicion', 1)
    on conflict (project_id, tipo) do update set ultimo = public.compras_consecutivos.ultimo + 1
    returning ultimo into v_numero;
    insert into public.compras_requisiciones (id, project_id, numero, solicitante_id, solicitante_nombre, fecha_requerida, prioridad, justificacion, actualizado_por)
    values (p_id, p_project_id, v_numero, p_actor_id, p_actor_nombre, p_fecha_requerida, p_prioridad, p_justificacion, p_actor_nombre);
    v_version := 1;
  else
    if v_req.estado <> 'borrador' then
      raise exception 'compras:estado-no-valido';
    end if;
    if not ('requisiciones.editar' = any (v_mios) or (v_req.solicitante_id = p_actor_id and 'requisiciones.crear' = any (v_mios))) then
      raise exception 'compras:sin-permiso';
    end if;
    update public.compras_requisiciones
       set fecha_requerida = p_fecha_requerida, prioridad = p_prioridad, justificacion = p_justificacion,
           version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
     where id = p_id and version = p_version
    returning version, numero into v_version, v_numero;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
    -- Lines of a draft are not referenced by anything yet: they are replaced.
    delete from public.compras_requisicion_lineas where requisicion_id = p_id;
  end if;

  insert into public.compras_requisicion_lineas (id, project_id, requisicion_id, orden, insumo_id, partida_item_id, codigo, descripcion, unidad, tipo, precio, cantidad, justificacion_exceso)
  select x.id, p_project_id, p_id, x.orden, x.insumo_id, nullif(x.partida_item_id, ''), coalesce(x.codigo, ''), coalesce(x.descripcion, ''), coalesce(x.unidad, ''),
         x.tipo, coalesce(x.precio, 0), x.cantidad, coalesce(x.justificacion_exceso, '')
    from jsonb_to_recordset(p_lineas) as x(id uuid, orden integer, insumo_id text, partida_item_id text, codigo text, descripcion text, unidad text,
                                           tipo text, precio numeric, cantidad numeric, justificacion_exceso text);

  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (p_project_id, p_actor_id, p_actor_nombre, case when v_existia then 'requisiciones.editar' else 'requisiciones.crear' end,
          'requisiciones', 'requisicion', p_id::text, null, 'REQ-' || lpad(v_numero::text, 4, '0'), 'ok',
          jsonb_build_object('lineas', jsonb_array_length(p_lineas), 'fecha_requerida', p_fecha_requerida, 'prioridad', p_prioridad));
  return v_version;
end;
$$;

-- Envía, aprueba, rechaza, devuelve o anula una requisición con todas sus reglas.
-- p_limites: {insumo_id: {"planificado": n, "limite": n}} del presupuesto vigente, calculado por la app
-- (un insumo que no está tiene límite 0). p_aprobadas: {linea_id: cantidad} al aprobar.
create or replace function public.compras_cambiar_estado_requisicion(
  p_project_id text, p_actor_id text, p_actor_nombre text, p_id uuid, p_accion text, p_motivo text,
  p_aprobadas jsonb, p_limites jsonb, p_presupuesto_version integer, p_version integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_mios text[];
  v_req public.compras_requisiciones%rowtype;
  v_estado text;
  v_version integer;
  v_fila record;
begin
  perform pg_advisory_xact_lock(hashtext('compras-requisiciones:' || p_project_id));
  v_mios := public.compras_permisos_de(p_project_id, p_actor_id);
  select * into v_req from public.compras_requisiciones where project_id = p_project_id and id = p_id for update;
  if not found then
    raise exception 'compras:no-existe';
  end if;

  v_estado := case p_accion when 'enviar' then 'enviada' when 'aprobar' then 'aprobada' when 'rechazar' then 'rechazada'
                            when 'devolver' then 'borrador' when 'anular' then 'anulada' end;
  if v_estado is null then
    raise exception 'compras:datos';
  end if;
  if not ((p_accion = 'enviar' and v_req.estado = 'borrador')
       or (p_accion in ('aprobar', 'rechazar', 'devolver') and v_req.estado = 'enviada')
       or (p_accion = 'anular' and v_req.estado in ('borrador', 'enviada', 'aprobada'))) then
    raise exception 'compras:estado-no-valido';
  end if;
  if p_accion = 'enviar' then
    if not ('requisiciones.editar' = any (v_mios) or (v_req.solicitante_id = p_actor_id and 'requisiciones.crear' = any (v_mios))) then
      raise exception 'compras:sin-permiso';
    end if;
  elsif p_accion = 'anular' then
    if not ('requisiciones.anular' = any (v_mios)) then
      raise exception 'compras:sin-permiso';
    end if;
  else
    if not ('requisiciones.aprobar' = any (v_mios)) then
      raise exception 'compras:sin-permiso';
    end if;
    if v_req.solicitante_id = p_actor_id then
      raise exception 'compras:auto-aprobacion';
    end if;
  end if;
  if p_accion in ('rechazar', 'devolver', 'anular') and btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'compras:motivo-requerido';
  end if;
  if v_req.version <> p_version then
    raise exception 'version-conflict';
  end if;

  if p_accion = 'enviar' then
    if not exists (select 1 from public.compras_requisicion_lineas where requisicion_id = p_id) then
      raise exception 'compras:sin-lineas';
    end if;
    if btrim(v_req.justificacion) = '' then
      raise exception 'compras:justificacion-requerida';
    end if;
    if v_req.fecha_requerida < public.compras_hoy() then
      raise exception 'compras:fecha-pasada';
    end if;
    -- Over the limit (with what others already asked) only with a justification on every line of that resource.
    for v_fila in
      select l.insumo_id, sum(l.cantidad) as pedido, bool_or(btrim(l.justificacion_exceso) = '') as sin_justificar
        from public.compras_requisicion_lineas l where l.requisicion_id = p_id group by l.insumo_id
    loop
      if public.compras_solicitado(p_project_id, v_fila.insumo_id, p_id) + v_fila.pedido
           > coalesce((p_limites -> v_fila.insumo_id ->> 'limite')::numeric, 0)
         and v_fila.sin_justificar then
        raise exception 'compras:cantidad-excedida';
      end if;
    end loop;
    update public.compras_requisicion_lineas l
       set planificado = coalesce((p_limites -> l.insumo_id ->> 'planificado')::numeric, 0), cantidad_aprobada = null
     where l.requisicion_id = p_id;
    update public.compras_requisiciones
       set estado = 'enviada', enviada = now(), enviada_por = p_actor_nombre, presupuesto_version = p_presupuesto_version, motivo = ''
     where id = p_id;
  elsif p_accion = 'aprobar' then
    if exists (select 1 from jsonb_object_keys(coalesce(p_aprobadas, '{}'::jsonb)) k
                where not exists (select 1 from public.compras_requisicion_lineas l where l.requisicion_id = p_id and l.id::text = k)) then
      raise exception 'compras:cantidad-no-valida';
    end if;
    if exists (select 1 from public.compras_requisicion_lineas l
                where l.requisicion_id = p_id
                  and (coalesce((p_aprobadas ->> l.id::text)::numeric, l.cantidad) < 0 or coalesce((p_aprobadas ->> l.id::text)::numeric, l.cantidad) > l.cantidad))
       or not exists (select 1 from public.compras_requisicion_lineas l
                       where l.requisicion_id = p_id and coalesce((p_aprobadas ->> l.id::text)::numeric, l.cantidad) > 0) then
      raise exception 'compras:cantidad-no-valida';
    end if;
    update public.compras_requisicion_lineas l
       set cantidad_aprobada = round(coalesce((p_aprobadas ->> l.id::text)::numeric, l.cantidad), 4)
     where l.requisicion_id = p_id;
    if not ('requisiciones.exceder' = any (v_mios)) then
      for v_fila in
        select l.insumo_id, sum(l.cantidad_aprobada) as aprobado
          from public.compras_requisicion_lineas l where l.requisicion_id = p_id group by l.insumo_id
      loop
        if public.compras_solicitado(p_project_id, v_fila.insumo_id, p_id) + v_fila.aprobado
             > coalesce((p_limites -> v_fila.insumo_id ->> 'limite')::numeric, 0) then
          raise exception 'compras:exceso-sin-permiso';
        end if;
      end loop;
    end if;
    update public.compras_requisiciones
       set estado = 'aprobada', decidida = now(), decidida_por = p_actor_nombre, motivo = coalesce(btrim(p_motivo), '')
     where id = p_id;
  else
    update public.compras_requisiciones
       set estado = v_estado, decidida = now(), decidida_por = p_actor_nombre, motivo = btrim(p_motivo)
     where id = p_id;
  end if;

  update public.compras_requisiciones
     set version = version + 1, actualizado = now(), actualizado_por = p_actor_nombre
   where id = p_id
  returning version into v_version;

  insert into public.compras_auditoria (project_id, actor_id, actor_nombre, accion, modulo, objeto_tipo, objeto_id, sujeto_id, sujeto_nombre, resultado, detalle)
  values (p_project_id, p_actor_id, p_actor_nombre, 'requisiciones.' || p_accion, 'requisiciones', 'requisicion', p_id::text,
          v_req.solicitante_id, 'REQ-' || lpad(v_req.numero::text, 4, '0'), 'ok',
          jsonb_build_object('de', v_req.estado, 'a', v_estado, 'motivo', coalesce(btrim(p_motivo), ''),
                             'aprobadas', (select coalesce(jsonb_object_agg(l.descripcion, l.cantidad_aprobada), '{}'::jsonb)
                                             from public.compras_requisicion_lineas l where l.requisicion_id = p_id and p_accion = 'aprobar')));
  return v_version;
end;
$$;

-- If the list of permissions grew, the administrators' role gets the new ones.
update public.compras_roles
   set permisos = public.compras_permisos_validos()
 where clave = 'admin_plataforma' and not (public.compras_permisos_validos() <@ permisos);

alter table public.compras_roles enable row level security;
alter table public.compras_usuarios enable row level security;
alter table public.compras_auditoria enable row level security;
alter table public.compras_config enable row level security;
alter table public.compras_consecutivos enable row level security;
alter table public.compras_requisiciones enable row level security;
alter table public.compras_requisicion_lineas enable row level security;

-- Only the app's server (service role) uses these tables and functions.
revoke all on table public.compras_roles, public.compras_usuarios, public.compras_auditoria from anon, authenticated;
revoke all on table public.compras_config, public.compras_consecutivos, public.compras_requisiciones, public.compras_requisicion_lineas from anon, authenticated;
grant select, insert, update on table public.compras_config, public.compras_consecutivos, public.compras_requisiciones to service_role;
grant select, insert, update, delete on table public.compras_requisicion_lineas to service_role;
revoke update, delete, truncate on table public.compras_auditoria from public, anon, authenticated, service_role;
grant select, insert on table public.compras_auditoria to service_role;
grant select, insert, update on table public.compras_roles, public.compras_usuarios to service_role;

revoke all on function public.compras_permisos_validos() from public, anon, authenticated;
revoke all on function public.compras_hoy() from public, anon, authenticated;
revoke all on function public.compras_auditoria_inmutable() from public, anon, authenticated;
revoke all on function public.compras_permisos_de(text, text) from public, anon, authenticated;
revoke all on function public.compras_activar(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.compras_guardar_usuario(text, text, text, text, text, text, uuid, date, date, boolean, integer) from public, anon, authenticated;
revoke all on function public.compras_guardar_rol(text, text, text, uuid, text, text, text[], boolean, integer) from public, anon, authenticated;
grant execute on function public.compras_permisos_validos() to service_role;
grant execute on function public.compras_hoy() to service_role;
grant execute on function public.compras_permisos_de(text, text) to service_role;
grant execute on function public.compras_activar(text, text, text, text, jsonb) to service_role;
grant execute on function public.compras_guardar_usuario(text, text, text, text, text, text, uuid, date, date, boolean, integer) to service_role;
grant execute on function public.compras_guardar_rol(text, text, text, uuid, text, text, text[], boolean, integer) to service_role;
revoke all on function public.compras_solicitado(text, text, uuid) from public, anon, authenticated;
revoke all on function public.compras_guardar_config(text, text, text, numeric, integer) from public, anon, authenticated;
revoke all on function public.compras_guardar_requisicion(text, text, text, uuid, date, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.compras_cambiar_estado_requisicion(text, text, text, uuid, text, text, jsonb, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.compras_solicitado(text, text, uuid) to service_role;
grant execute on function public.compras_guardar_config(text, text, text, numeric, integer) to service_role;
grant execute on function public.compras_guardar_requisicion(text, text, text, uuid, date, text, text, jsonb, integer) to service_role;
grant execute on function public.compras_cambiar_estado_requisicion(text, text, text, uuid, text, text, jsonb, jsonb, integer, integer) to service_role;
