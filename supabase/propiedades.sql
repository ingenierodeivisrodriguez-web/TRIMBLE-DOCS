-- Servicio de datos de la herramienta "Propiedades": catálogo de atributos por
-- proyecto y valores asignados a elementos del modelo por su IFCGUID.
-- Ejecútalo en Supabase → SQL Editor. Es seguro volver a ejecutarlo: no borra
-- datos, y así se aplican también las actualizaciones (p. ej. los responsables).
-- No usa los Property Sets/UDA de Trimble Connect: estos datos viven solo aquí.

-- Definiciones de atributos (el catálogo que configura el administrador).
create table if not exists public.propiedades_definiciones (
  id          uuid        primary key default gen_random_uuid(),
  project_id  text        not null,
  title       text        not null check (char_length(btrim(title)) between 1 and 120),
  data_type   text        not null check (data_type in ('text', 'number', 'boolean', 'date')),
  group_name  text        not null default 'General' check (char_length(btrim(group_name)) between 1 and 80),
  sort_order  integer     not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists propiedades_definiciones_project_idx
  on public.propiedades_definiciones (project_id);

-- Responsables: personas o grupos de Trimble Connect que pueden asignar los
-- valores del atributo, además de los administradores del proyecto. Lista de
-- {"type": "user" | "group", "id": "...", "name": "..."}; vacía = solo administradores.
alter table public.propiedades_definiciones
  add column if not exists responsables jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'propiedades_definiciones_responsables_lista') then
    alter table public.propiedades_definiciones
      add constraint propiedades_definiciones_responsables_lista check (jsonb_typeof(responsables) = 'array');
  end if;
end;
$$;

-- Valores asignados. Un valor por (proyecto, IFCGUID, atributo): el valor sigue
-- al elemento aunque cambie la versión del modelo. Cada fila guarda el valor en
-- la columna de su tipo (fechas como date, ISO internamente).
create table if not exists public.propiedades_valores (
  id            bigint      generated always as identity primary key,
  project_id    text        not null,
  model_id      text        not null,
  ifc_guid      text        not null check (ifc_guid ~ '^[0-3][0-9A-Za-z_$]{21}$'),
  attribute_id  uuid        not null references public.propiedades_definiciones (id) on delete restrict,
  value_text    text,
  value_number  double precision,
  value_boolean boolean,
  value_date    date,
  updated_at    timestamptz not null default now(),
  updated_by    text,
  constraint propiedades_valores_un_valor
    check (num_nonnulls(value_text, value_number, value_boolean, value_date) = 1),
  constraint propiedades_valores_unico unique (project_id, ifc_guid, attribute_id)
);
create index if not exists propiedades_valores_attribute_idx
  on public.propiedades_valores (attribute_id);

-- Catálogo con la cantidad de valores de cada atributo (para saber si se puede
-- borrar o solo desactivar). Las columnas van en orden fijo y las nuevas al
-- final, para que "create or replace" funcione sobre la versión anterior.
create or replace view public.propiedades_definiciones_uso
with (security_invoker = true) as
select d.id, d.project_id, d.title, d.data_type, d.group_name, d.sort_order, d.active,
       d.created_at, d.created_by, d.updated_at, d.updated_by,
       (select count(*) from public.propiedades_valores v where v.attribute_id = d.id) as value_count,
       d.responsables
from public.propiedades_definiciones d;

-- Guarda varios atributos en varios elementos en una sola transacción.
--   p_items:   [{"ifcGuid": "...", "modelId": "..."}, ...]
--   p_changes: [{"attributeId": "uuid", "value": <valor> | null}, ...]  (null = borrar el valor)
-- Rechaza atributos de otro proyecto o inactivos, y valores que no encajan con
-- el tipo del atributo (el cast falla y la transacción entera se deshace).
create or replace function public.propiedades_guardar_valores(
  p_project_id text,
  p_items      jsonb,
  p_changes    jsonb,
  p_user       text
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  change   jsonb;
  def      public.propiedades_definiciones%rowtype;
  v        jsonb;
  touched  integer := 0;
  n        integer;
begin
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into def
      from public.propiedades_definiciones
     where id = (change->>'attributeId')::uuid and project_id = p_project_id;
    if not found then
      raise exception 'El atributo % no existe en este proyecto', change->>'attributeId'
        using errcode = 'P0002';
    end if;
    if not def.active then
      raise exception 'El atributo "%" está inactivo y no admite valores nuevos', def.title
        using errcode = 'P0001';
    end if;

    v := change->'value';
    if v is null or jsonb_typeof(v) = 'null' then
      delete from public.propiedades_valores
       where project_id = p_project_id
         and attribute_id = def.id
         and ifc_guid in (select i->>'ifcGuid' from jsonb_array_elements(p_items) i);
    else
      insert into public.propiedades_valores as pv
        (project_id, model_id, ifc_guid, attribute_id,
         value_text, value_number, value_boolean, value_date, updated_at, updated_by)
      select p_project_id, i->>'modelId', i->>'ifcGuid', def.id,
             case when def.data_type = 'text'    then v #>> '{}' end,
             case when def.data_type = 'number'  then (v #>> '{}')::double precision end,
             case when def.data_type = 'boolean' then (v #>> '{}')::boolean end,
             case when def.data_type = 'date'    then (v #>> '{}')::date end,
             now(), p_user
        from jsonb_array_elements(p_items) i
      on conflict (project_id, ifc_guid, attribute_id) do update set
        model_id      = excluded.model_id,
        value_text    = excluded.value_text,
        value_number  = excluded.value_number,
        value_boolean = excluded.value_boolean,
        value_date    = excluded.value_date,
        updated_at    = excluded.updated_at,
        updated_by    = excluded.updated_by;
    end if;
    get diagnostics n = row_count;
    touched := touched + n;
  end loop;
  return touched;
end;
$$;

-- Configuraciones guardadas de "Seleccionar por agrupación" (panel del visor):
-- por qué propiedades agrupar y con qué modelos. Se comparten con todo el
-- proyecto; las borra quien las guardó o un administrador.
create table if not exists public.propiedades_agrupaciones (
  id             uuid        primary key default gen_random_uuid(),
  project_id     text        not null,
  name           text        not null check (char_length(btrim(name)) between 1 and 80),
  config         jsonb       not null check (jsonb_typeof(config) = 'object'),
  created_at     timestamptz not null default now(),
  created_by     text,
  created_by_id  text
);
create unique index if not exists propiedades_agrupaciones_nombre_unico
  on public.propiedades_agrupaciones (project_id, lower(btrim(name)));

-- RLS activado y sin políticas: solo el servidor (clave de servicio) lee y
-- escribe. La función se ejecuta con los permisos de quien la llama, así que
-- tampoco abre acceso a la clave pública.
alter table public.propiedades_definiciones enable row level security;
alter table public.propiedades_valores enable row level security;
alter table public.propiedades_agrupaciones enable row level security;
revoke all on function public.propiedades_guardar_valores(text, jsonb, jsonb, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.propiedades_guardar_valores(text, jsonb, jsonb, text) to service_role;
  end if;
end;
$$;

-- Que la API REST de Supabase vea las tablas, la vista y la función nuevas.
notify pgrst, 'reload schema';
