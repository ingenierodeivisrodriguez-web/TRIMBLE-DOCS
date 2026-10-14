-- Servicio de datos de la herramienta "Presupuesto": catálogos de insumos y
-- partidas (en un proyecto "base" que otros proyectos pueden usar), el
-- presupuesto de cada proyecto y los elementos del modelo (por IFCGUID)
-- asociados a sus partidas.
-- Ejecútalo en Supabase → SQL Editor. Es seguro volver a ejecutarlo: no borra datos.

-- Configuración de cada proyecto: qué catálogo usa y quiénes editan además de los administradores.
create table if not exists public.presupuesto_config (
  project_id        text        primary key,
  base_project_id   text        not null,
  base_project_name text        not null default '',
  editores          jsonb       not null default '[]'::jsonb check (jsonb_typeof(editores) = 'array'),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- Columnas de la memoria de cantidades que eligió el proyecto: lista de
-- {"id", "label", "fuente": "modelo" | "propiedad" | "ifcguid", "clave"}. Vacía = las de fábrica.
alter table public.presupuesto_config add column if not exists memoria_columnas jsonb;

-- Propiedades de los modelos cargados en el visor, tal como se leyeron la última vez
-- (para elegir las columnas de la memoria de cantidades desde el menú del proyecto).
create table if not exists public.presupuesto_campos_modelo (
  project_id text        primary key,
  leido      timestamptz not null default now(),
  leido_por  text,
  modelos    jsonb       not null default '[]'::jsonb check (jsonb_typeof(modelos) = 'array'),
  campos     jsonb       not null default '[]'::jsonb check (jsonb_typeof(campos) = 'array')
);

-- "Ver en 3D": los elementos que una persona pidió ver desde el menú del proyecto, para que el
-- panel Presupuesto del visor 3D los seleccione al abrirse (una fila por persona; dura minutos).
create table if not exists public.presupuesto_vistas (
  project_id text        not null,
  user_id    text        not null,
  item_id    text        not null,
  elementos  jsonb       not null check (jsonb_typeof(elementos) = 'array'),
  creado     timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Qué debe hacer el panel del visor al abrirse: 'ver' (seleccionar elementos) o 'memoria'
-- (actualizar la memoria de cantidades de todas las partidas).
alter table public.presupuesto_vistas add column if not exists tarea text not null default 'ver';

-- Catálogo de insumos. base_id = proyecto de Trimble Connect dueño del catálogo.
create table if not exists public.presupuesto_insumos (
  id          uuid        primary key,
  base_id     text        not null,
  codigo      text        not null default '',
  descripcion text        not null check (char_length(btrim(descripcion)) between 1 and 300),
  unidad      text        not null default '' check (char_length(unidad) <= 20),
  precio      numeric     not null default 0 check (precio >= 0),
  tipo        text        not null check (tipo in ('MO', 'MT', 'EQ', 'SC')),
  iu          text        not null default '',
  omniclass   text        not null default '',
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists presupuesto_insumos_base_idx on public.presupuesto_insumos (base_id);
create unique index if not exists presupuesto_insumos_codigo_unico
  on public.presupuesto_insumos (base_id, lower(btrim(codigo))) where btrim(codigo) <> '';

-- Catálogo de partidas con su análisis de precios unitarios (componentes: lista de
-- {"tipo": "insumo" | "subpartida", "id": "...", "cuadrilla": n | null, "cantidad": n}).
create table if not exists public.presupuesto_partidas (
  id          uuid        primary key,
  base_id     text        not null,
  codigo      text        not null default '',
  descripcion text        not null check (char_length(btrim(descripcion)) between 1 and 300),
  unidad      text        not null default '' check (char_length(unidad) <= 20),
  rendimiento numeric     not null default 1 check (rendimiento > 0),
  jornada     numeric     not null default 8 check (jornada > 0),
  omniclass   text        not null default '',
  componentes jsonb       not null default '[]'::jsonb check (jsonb_typeof(componentes) = 'array'),
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists presupuesto_partidas_base_idx on public.presupuesto_partidas (base_id);

-- Diccionario de la EDT de la partida: {"descripcion": "...", "criterios": "...", "responsable": "..."}.
alter table public.presupuesto_partidas add column if not exists edt jsonb;
create unique index if not exists presupuesto_partidas_codigo_unico
  on public.presupuesto_partidas (base_id, lower(btrim(codigo))) where btrim(codigo) <> '';

-- Códigos OmniClass importados (además de las divisiones de la Tabla 22 que trae la app).
create table if not exists public.presupuesto_omniclass (
  base_id text not null,
  codigo  text not null check (char_length(btrim(codigo)) between 1 and 60),
  titulo  text not null check (char_length(btrim(titulo)) between 1 and 300),
  primary key (base_id, codigo)
);

-- El presupuesto de cada proyecto (subpresupuestos, precios, subpartidas, gastos y pie)
-- como un documento; `version` evita que un guardado pise el de otra persona.
create table if not exists public.presupuesto_documentos (
  project_id text        primary key,
  data       jsonb       not null,
  version    integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Programación (Gantt) del presupuesto: fecha de inicio, calendario laboral y, por partida,
-- duración, cuadrillas, predecesoras y restricciones. Versionada como el presupuesto.
create table if not exists public.presupuesto_programacion (
  project_id text        primary key,
  data       jsonb       not null,
  version    integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Elementos del modelo asociados a cada partida (item_id = id de la fila del presupuesto).
create table if not exists public.presupuesto_elementos (
  id         bigint      generated always as identity primary key,
  project_id text        not null,
  item_id    text        not null,
  ifc_guid   text        not null check (ifc_guid ~ '^[0-3][0-9A-Za-z_$]{21}$'),
  model_id   text        not null,
  cantidad   double precision,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint presupuesto_elementos_unico unique (project_id, item_id, ifc_guid)
);
create index if not exists presupuesto_elementos_guid_idx on public.presupuesto_elementos (project_id, ifc_guid);

-- Memoria de cantidades: dónde está el elemento (bloque, conjunto, zona, nombre de zona, espacio),
-- leído de las propiedades del modelo al asociarlo.
alter table public.presupuesto_elementos add column if not exists memoria jsonb;

-- Cómo mide cada partida sus elementos: una propiedad, el conteo ('@count') o nada (campo null).
create table if not exists public.presupuesto_mediciones (
  project_id  text        not null,
  item_id     text        not null,
  campo       text,
  campo_label text        not null default '',
  unidad      text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (project_id, item_id)
);

-- Cantidad de elementos y suma de sus cantidades por partida.
create or replace view public.presupuesto_resumen_elementos
with (security_invoker = true) as
  select project_id, item_id, count(*) as elementos, coalesce(sum(cantidad), 0) as suma
  from public.presupuesto_elementos
  group by project_id, item_id;

-- Modelos a los que pertenecen los elementos asociados a partidas, con cuántos elementos tiene cada uno.
create or replace view public.presupuesto_modelos_usados
with (security_invoker = true) as
  select project_id, model_id, count(*)::integer as elementos
  from public.presupuesto_elementos
  group by project_id, model_id;

-- Guarda insumos (nuevos o editados) de un catálogo. Una fila con el id de un insumo
-- de otro catálogo no se toca.
create or replace function public.presupuesto_guardar_insumos(p_base_id text, p_rows jsonb, p_user text)
returns integer
language sql
as $$
  with input as (
    select * from jsonb_to_recordset(p_rows)
      as x(id uuid, codigo text, descripcion text, unidad text, precio numeric, tipo text, iu text, omniclass text)
  ), saved as (
    insert into public.presupuesto_insumos as t
      (id, base_id, codigo, descripcion, unidad, precio, tipo, iu, omniclass, created_by, updated_by)
    select id, p_base_id, coalesce(codigo, ''), descripcion, coalesce(unidad, ''), coalesce(precio, 0), tipo,
           coalesce(iu, ''), coalesce(omniclass, ''), p_user, p_user
    from input
    on conflict (id) do update set
      codigo = excluded.codigo, descripcion = excluded.descripcion, unidad = excluded.unidad,
      precio = excluded.precio, tipo = excluded.tipo, iu = excluded.iu, omniclass = excluded.omniclass,
      updated_at = now(), updated_by = excluded.updated_by
      where t.base_id = excluded.base_id
    returning 1
  )
  select count(*)::integer from saved;
$$;

create or replace function public.presupuesto_guardar_partidas(p_base_id text, p_rows jsonb, p_user text)
returns integer
language sql
as $$
  with input as (
    select * from jsonb_to_recordset(p_rows)
      as x(id uuid, codigo text, descripcion text, unidad text, rendimiento numeric, jornada numeric,
           omniclass text, componentes jsonb, edt jsonb)
  ), saved as (
    insert into public.presupuesto_partidas as t
      (id, base_id, codigo, descripcion, unidad, rendimiento, jornada, omniclass, componentes, edt, created_by, updated_by)
    select id, p_base_id, coalesce(codigo, ''), descripcion, coalesce(unidad, ''), rendimiento, jornada,
           coalesce(omniclass, ''), coalesce(componentes, '[]'::jsonb), edt, p_user, p_user
    from input
    on conflict (id) do update set
      codigo = excluded.codigo, descripcion = excluded.descripcion, unidad = excluded.unidad,
      rendimiento = excluded.rendimiento, jornada = excluded.jornada, omniclass = excluded.omniclass,
      componentes = excluded.componentes, edt = excluded.edt, updated_at = now(), updated_by = excluded.updated_by
      where t.base_id = excluded.base_id
    returning 1
  )
  select count(*)::integer from saved;
$$;

-- Guarda el presupuesto si nadie lo cambió desde `p_version` (0 = primera vez) y
-- borra los elementos y mediciones de partidas que ya no existen. Devuelve la versión nueva.
create or replace function public.presupuesto_guardar(p_project_id text, p_data jsonb, p_version integer, p_user text)
returns integer
language plpgsql
as $$
declare
  v_version integer;
begin
  if p_version = 0 then
    insert into public.presupuesto_documentos (project_id, data, version, updated_by)
    values (p_project_id, p_data, 1, p_user)
    on conflict (project_id) do nothing;
    if not found then
      raise exception 'version-conflict';
    end if;
    v_version := 1;
  else
    update public.presupuesto_documentos
       set data = p_data, version = version + 1, updated_at = now(), updated_by = p_user
     where project_id = p_project_id and version = p_version
    returning version into v_version;
    if v_version is null then
      raise exception 'version-conflict';
    end if;
  end if;

  delete from public.presupuesto_elementos e
   where e.project_id = p_project_id
     and not exists (
       select 1
         from jsonb_array_elements(p_data -> 'subpresupuestos') sp,
              jsonb_array_elements(sp -> 'items') it
        where it ->> 'id' = e.item_id and it ->> 'tipo' = 'partida');
  delete from public.presupuesto_mediciones m
   where m.project_id = p_project_id
     and not exists (
       select 1
         from jsonb_array_elements(p_data -> 'subpresupuestos') sp,
              jsonb_array_elements(sp -> 'items') it
        where it ->> 'id' = m.item_id and it ->> 'tipo' = 'partida');
  return v_version;
end;
$$;

-- Guarda la programación si nadie la guardó desde `p_version` (0: todavía no existe).
create or replace function public.presupuesto_guardar_programacion(p_project_id text, p_data jsonb, p_version integer, p_user text)
returns integer
language plpgsql
as $$
declare
  v_version integer;
begin
  if p_version = 0 then
    insert into public.presupuesto_programacion (project_id, data, version, updated_by)
    values (p_project_id, p_data, 1, p_user)
    on conflict (project_id) do nothing;
    if not found then
      raise exception 'version-conflict';
    end if;
    return 1;
  end if;
  update public.presupuesto_programacion
     set data = p_data, version = version + 1, updated_at = now(), updated_by = p_user
   where project_id = p_project_id and version = p_version
  returning version into v_version;
  if v_version is null then
    raise exception 'version-conflict';
  end if;
  return v_version;
end;
$$;

-- Asistente IA. Cupo mensual en pesos por proyecto y por persona; lo fijan los
-- administradores del proyecto gestor de la plataforma. project_id = '_global' guarda
-- los valores por defecto y la TRM.
create table if not exists public.presupuesto_ia_cupos (
  project_id        text        primary key,
  habilitada        boolean     not null default false,
  cupo_proyecto_cop numeric(14,2) not null default 0 check (cupo_proyecto_cop >= 0),
  cupo_usuario_cop  numeric(14,2) not null default 0 check (cupo_usuario_cop >= 0),
  trm               numeric(10,2) check (trm is null or trm > 0),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

alter table public.presupuesto_ia_cupos add column if not exists project_name text;

-- Registro de cada llamada al modelo: quién, qué tarea, modelo, tokens y costo.
create table if not exists public.presupuesto_ia_uso (
  id                     bigint generated always as identity primary key,
  project_id             text        not null,
  user_id                text        not null,
  user_name              text        not null default '',
  tarea                  text        not null,
  modelo                 text        not null,
  items                  integer     not null default 0,
  tokens_entrada         integer     not null default 0,
  tokens_salida          integer     not null default 0,
  tokens_cache_escritura integer     not null default 0,
  tokens_cache_lectura   integer     not null default 0,
  costo_usd              numeric(12,6) not null default 0,
  trm                    numeric(10,2) not null,
  costo_cop              numeric(14,2) not null default 0,
  version_prompt         text        not null default '',
  estado                 text        not null check (estado in ('ok', 'error', 'rechazado', 'incompleto')),
  detalle                text        not null default '',
  creado                 timestamptz not null default now()
);
create index if not exists presupuesto_ia_uso_mes on public.presupuesto_ia_uso (project_id, creado);

-- Lo que propone la IA, fila por fila, hasta que una persona lo acepta o lo rechaza.
create table if not exists public.presupuesto_ia_borradores (
  id           uuid        primary key,
  project_id   text        not null,
  tarea        text        not null,
  item_id      text        not null,
  referencia   text        not null default '',
  propuesta    jsonb       not null,
  anterior     jsonb,
  estado       text        not null default 'pendiente' check (estado in ('pendiente', 'aceptado', 'rechazado', 'reemplazado')),
  editado      boolean     not null default false,
  final        jsonb,
  uso_id       bigint,
  creado       timestamptz not null default now(),
  creado_por   text        not null default '',
  decidido     timestamptz,
  decidido_por text
);
create index if not exists presupuesto_ia_borradores_estado on public.presupuesto_ia_borradores (project_id, estado, creado);

-- Lo gastado desde una fecha por el proyecto y por una persona.
create or replace function public.presupuesto_ia_gasto(p_project_id text, p_desde timestamptz, p_user_id text)
returns table (proyecto numeric, usuario numeric)
language sql
stable
as $$
  select coalesce(sum(costo_cop), 0),
         coalesce(sum(costo_cop) filter (where user_id = p_user_id), 0)
    from public.presupuesto_ia_uso
   where project_id = p_project_id and creado >= p_desde;
$$;

-- Lo gastado desde una fecha por cada proyecto (para la lista de los administradores).
create or replace function public.presupuesto_ia_gasto_proyectos(p_desde timestamptz)
returns table (project_id text, gasto numeric)
language sql
stable
as $$
  select project_id, coalesce(sum(costo_cop), 0)
    from public.presupuesto_ia_uso
   where creado >= p_desde
   group by project_id;
$$;

-- Cómo se juzgaron los borradores: la evaluación base del asistente.
create or replace function public.presupuesto_ia_resumen(p_project_id text)
returns table (pendientes bigint, aceptados_sin_cambios bigint, aceptados_editados bigint, rechazados bigint)
language sql
stable
as $$
  select count(*) filter (where estado = 'pendiente'),
         count(*) filter (where estado = 'aceptado' and not editado),
         count(*) filter (where estado = 'aceptado' and editado),
         count(*) filter (where estado = 'rechazado')
    from public.presupuesto_ia_borradores
   where project_id = p_project_id;
$$;

-- La evaluación de cada tarea del asistente.
create or replace function public.presupuesto_ia_resumen_tareas(p_project_id text)
returns table (tarea text, pendientes bigint, aceptados_sin_cambios bigint, aceptados_editados bigint, rechazados bigint)
language sql
stable
as $$
  select tarea,
         count(*) filter (where estado = 'pendiente'),
         count(*) filter (where estado = 'aceptado' and not editado),
         count(*) filter (where estado = 'aceptado' and editado),
         count(*) filter (where estado = 'rechazado')
    from public.presupuesto_ia_borradores
   where project_id = p_project_id and estado <> 'reemplazado'
   group by tarea;
$$;

-- RLS activado y sin políticas: solo el servidor (clave de servicio) lee y
-- escribe. Las funciones se ejecutan con los permisos de quien las llama.
alter table public.presupuesto_config enable row level security;
alter table public.presupuesto_vistas enable row level security;
alter table public.presupuesto_campos_modelo enable row level security;
alter table public.presupuesto_insumos enable row level security;
alter table public.presupuesto_partidas enable row level security;
alter table public.presupuesto_omniclass enable row level security;
alter table public.presupuesto_documentos enable row level security;
alter table public.presupuesto_elementos enable row level security;
alter table public.presupuesto_mediciones enable row level security;
alter table public.presupuesto_programacion enable row level security;
alter table public.presupuesto_ia_cupos enable row level security;
alter table public.presupuesto_ia_uso enable row level security;
alter table public.presupuesto_ia_borradores enable row level security;
revoke all on function public.presupuesto_guardar_insumos(text, jsonb, text) from public;
revoke all on function public.presupuesto_guardar_partidas(text, jsonb, text) from public;
revoke all on function public.presupuesto_guardar(text, jsonb, integer, text) from public;
revoke all on function public.presupuesto_guardar_programacion(text, jsonb, integer, text) from public;
revoke all on function public.presupuesto_ia_gasto(text, timestamptz, text) from public;
revoke all on function public.presupuesto_ia_resumen(text) from public;
revoke all on function public.presupuesto_ia_gasto_proyectos(timestamptz) from public;
revoke all on function public.presupuesto_ia_resumen_tareas(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.presupuesto_guardar_insumos(text, jsonb, text) to service_role;
    grant execute on function public.presupuesto_guardar_partidas(text, jsonb, text) to service_role;
    grant execute on function public.presupuesto_guardar(text, jsonb, integer, text) to service_role;
    grant execute on function public.presupuesto_guardar_programacion(text, jsonb, integer, text) to service_role;
    grant execute on function public.presupuesto_ia_gasto(text, timestamptz, text) to service_role;
    grant execute on function public.presupuesto_ia_resumen(text) to service_role;
    grant execute on function public.presupuesto_ia_gasto_proyectos(timestamptz) to service_role;
    grant execute on function public.presupuesto_ia_resumen_tareas(text) to service_role;
  end if;
end;
$$;

-- Que la API REST de Supabase vea las tablas, la vista y las funciones nuevas.
notify pgrst, 'reload schema';
