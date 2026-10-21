-- Requisitos BIM (LOIN): catálogo de parámetros, disciplinas, elementos a
-- modelar con sus imágenes de referencia y parámetros exigidos, y plantillas
-- de disciplina. Se puede ejecutar varias veces sin perder datos (Supabase →
-- SQL Editor → pegar y ejecutar).
--
-- Reglas que también cumple la base de datos:
--  * Nada se borra físicamente del catálogo, las disciplinas, los elementos ni
--    las plantillas: se desactivan (un trigger rechaza el borrado).
--  * Guardados con versión: si otra persona guardó antes, 'version-conflict'.
--  * Códigos únicos: por catálogo (parámetros), por proyecto (disciplinas) y
--    por disciplina (elementos).
--  * RLS activado sin políticas: solo el servidor (clave de servicio) lee y escribe.

-- Configuración de cada proyecto: de qué proyecto base toma el catálogo, quién
-- edita además de los administradores, valores de relleno y umbral del amarillo.
create table if not exists public.loin_config (
  project_id        text        primary key,
  base_project_id   text        not null,
  base_project_name text        not null default '',
  editores          jsonb       not null default '[]'::jsonb check (jsonb_typeof(editores) = 'array'),
  valores_basura    jsonb       check (valores_basura is null or jsonb_typeof(valores_basura) = 'array'),
  umbral_amarillo   numeric     check (umbral_amarillo is null or umbral_amarillo between 0 and 100),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- Lo que pertenece al catálogo (en su proyecto base): los nombres de los grupos TDI.
create table if not exists public.loin_catalogos (
  base_id     text        primary key,
  tdi_grupos  jsonb       not null default '[]'::jsonb check (jsonb_typeof(tdi_grupos) = 'array'),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.loin_parametros (
  id                 uuid        primary key,
  base_id            text        not null,
  codigo             text        not null check (length(btrim(codigo)) between 1 and 40),
  numero             integer     check (numero is null or numero > 0),
  nombre             text        not null check (length(btrim(nombre)) between 1 and 200),
  descripcion        text        not null default '',
  tdi                text        not null check (tdi ~ '^[A-Z]$'),
  ndi                smallint    not null check (ndi between 1 and 3),
  origen             text        not null check (origen in ('automatica', 'a_ingresar', 'por_definir')),
  tipo_dato          text        not null check (tipo_dato in ('texto', 'numero', 'booleano', 'fecha', 'lista')),
  unidad             text        not null default '',
  valores_permitidos jsonb       not null default '[]'::jsonb check (jsonb_typeof(valores_permitidos) = 'array'),
  regla              jsonb       not null default '{}'::jsonb check (jsonb_typeof(regla) = 'object'),
  alias              jsonb       not null default '[]'::jsonb check (jsonb_typeof(alias) = 'array'),
  ids_uri            text        not null default '',
  activo             boolean     not null default true,
  version            integer     not null default 1,
  creado             timestamptz not null default now(),
  creado_por         text,
  actualizado        timestamptz not null default now(),
  actualizado_por    text
);
create unique index if not exists loin_parametros_codigo_unico on public.loin_parametros (base_id, lower(btrim(codigo)));

create table if not exists public.loin_disciplinas (
  id              uuid        primary key,
  project_id      text        not null,
  codigo          text        not null check (length(btrim(codigo)) between 1 and 20),
  nombre          text        not null check (length(btrim(nombre)) between 1 and 120),
  color           text        not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden           integer     not null default 0,
  activo          boolean     not null default true,
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text,
  actualizado     timestamptz not null default now(),
  actualizado_por text
);
create unique index if not exists loin_disciplinas_codigo_unico on public.loin_disciplinas (project_id, lower(btrim(codigo)));

create table if not exists public.loin_elementos (
  id                    uuid        primary key,
  project_id            text        not null,
  disciplina_id         uuid        not null references public.loin_disciplinas (id),
  codigo                text        not null check (length(btrim(codigo)) between 1 and 30),
  nombre                text        not null check (length(btrim(nombre)) between 1 and 200),
  clase_ifc             text        not null default '' check (clase_ifc = '' or clase_ifc ~ '^Ifc[A-Za-z0-9]+$'),
  tipo_predefinido      text        not null default '',
  clasificacion_sistema text        not null default '',
  clasificacion_codigo  text        not null default '',
  notas                 text        not null default '',
  -- [{"parametroId", "obligatorio", "ndi" (null: el del catálogo), "regla" (null: la del catálogo)}]
  parametros            jsonb       not null default '[]'::jsonb check (jsonb_typeof(parametros) = 'array'),
  orden                 integer     not null default 0,
  activo                boolean     not null default true,
  version               integer     not null default 1,
  creado                timestamptz not null default now(),
  creado_por            text,
  actualizado           timestamptz not null default now(),
  actualizado_por       text
);
create unique index if not exists loin_elementos_codigo_unico on public.loin_elementos (disciplina_id, lower(btrim(codigo)));
create index if not exists loin_elementos_proyecto on public.loin_elementos (project_id);

-- Imágenes de referencia: el archivo va al bucket privado "loin-imagenes" de
-- Supabase Storage (reducido en el navegador); aquí, dónde está y sus datos.
create table if not exists public.loin_imagenes (
  id          uuid        primary key,
  project_id  text        not null,
  elemento_id uuid        not null references public.loin_elementos (id),
  ruta        text        not null unique,
  nombre      text        not null default '',
  tipo        text        not null check (tipo in ('image/webp', 'image/jpeg', 'image/png')),
  ancho       integer     not null check (ancho > 0),
  alto        integer     not null check (alto > 0),
  bytes       integer     not null check (bytes > 0),
  subida      timestamptz not null default now(),
  subida_por  text
);
create index if not exists loin_imagenes_elemento on public.loin_imagenes (elemento_id);
create index if not exists loin_imagenes_proyecto on public.loin_imagenes (project_id);

-- Plantillas de disciplina, en el proyecto base del catálogo.
create table if not exists public.loin_plantillas (
  id              uuid        primary key,
  base_id         text        not null,
  nombre          text        not null check (length(btrim(nombre)) between 1 and 120),
  descripcion     text        not null default '',
  contenido       jsonb       not null check (jsonb_typeof(contenido) = 'object'),
  activo          boolean     not null default true,
  version         integer     not null default 1,
  creada          timestamptz not null default now(),
  creada_por      text,
  actualizado     timestamptz not null default now(),
  actualizado_por text
);
create index if not exists loin_plantillas_base on public.loin_plantillas (base_id);

-- Nada del catálogo, disciplinas, elementos ni plantillas se borra: se desactiva.
create or replace function public.loin_sin_borrar()
returns trigger
language plpgsql
as $$
begin
  raise exception 'loin-sin-borrar: los registros de % no se borran, se desactivan', tg_table_name;
end;
$$;

drop trigger if exists loin_parametros_sin_borrar on public.loin_parametros;
create trigger loin_parametros_sin_borrar before delete on public.loin_parametros for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_disciplinas_sin_borrar on public.loin_disciplinas;
create trigger loin_disciplinas_sin_borrar before delete on public.loin_disciplinas for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_elementos_sin_borrar on public.loin_elementos;
create trigger loin_elementos_sin_borrar before delete on public.loin_elementos for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_plantillas_sin_borrar on public.loin_plantillas;
create trigger loin_plantillas_sin_borrar before delete on public.loin_plantillas for each row execute function public.loin_sin_borrar();

-- Guarda varios parámetros de un catálogo: todos o ninguno. version 0 = nuevo;
-- si no, solo si sigue en esa versión ('version-conflict'). Código repetido:
-- 'duplicate-code'. Devuelve las filas guardadas (con su versión nueva).
create or replace function public.loin_guardar_parametros(p_base_id text, p_filas jsonb, p_usuario text)
returns setof public.loin_parametros
language plpgsql
set search_path = public
as $$
declare
  f jsonb;
  r public.loin_parametros;
  v_restriccion text;
begin
  for f in select * from jsonb_array_elements(p_filas) loop
    if (f ->> 'version')::integer = 0 then
      insert into public.loin_parametros (id, base_id, codigo, numero, nombre, descripcion, tdi, ndi, origen, tipo_dato, unidad,
                                          valores_permitidos, regla, alias, ids_uri, activo, creado_por, actualizado_por)
      values ((f ->> 'id')::uuid, p_base_id, btrim(f ->> 'codigo'), (f ->> 'numero')::integer, btrim(f ->> 'nombre'), coalesce(f ->> 'descripcion', ''),
              f ->> 'tdi', (f ->> 'ndi')::smallint, f ->> 'origen', f ->> 'tipo_dato', coalesce(f ->> 'unidad', ''),
              coalesce(f -> 'valores_permitidos', '[]'::jsonb), coalesce(f -> 'regla', '{}'::jsonb), coalesce(f -> 'alias', '[]'::jsonb),
              coalesce(f ->> 'ids_uri', ''), coalesce((f ->> 'activo')::boolean, true), p_usuario, p_usuario)
      returning * into r;
    else
      update public.loin_parametros
         set codigo = btrim(f ->> 'codigo'), numero = (f ->> 'numero')::integer, nombre = btrim(f ->> 'nombre'), descripcion = coalesce(f ->> 'descripcion', ''),
             tdi = f ->> 'tdi', ndi = (f ->> 'ndi')::smallint, origen = f ->> 'origen', tipo_dato = f ->> 'tipo_dato', unidad = coalesce(f ->> 'unidad', ''),
             valores_permitidos = coalesce(f -> 'valores_permitidos', '[]'::jsonb), regla = coalesce(f -> 'regla', '{}'::jsonb),
             alias = coalesce(f -> 'alias', '[]'::jsonb), ids_uri = coalesce(f ->> 'ids_uri', ''), activo = coalesce((f ->> 'activo')::boolean, true),
             version = version + 1, actualizado = now(), actualizado_por = p_usuario
       where id = (f ->> 'id')::uuid and base_id = p_base_id and version = (f ->> 'version')::integer
      returning * into r;
      if not found then
        raise exception 'version-conflict';
      end if;
    end if;
    return next r;
  end loop;
  return;
exception when unique_violation then
  get stacked diagnostics v_restriccion = constraint_name;
  if v_restriccion like '%_pkey' then
    raise exception 'version-conflict';
  end if;
  raise exception 'duplicate-code';
end;
$$;

create or replace function public.loin_guardar_disciplina(p_project_id text, p_fila jsonb, p_usuario text)
returns public.loin_disciplinas
language plpgsql
set search_path = public
as $$
declare
  r public.loin_disciplinas;
  v_restriccion text;
begin
  if (p_fila ->> 'version')::integer = 0 then
    insert into public.loin_disciplinas (id, project_id, codigo, nombre, color, orden, activo, creado_por, actualizado_por)
    values ((p_fila ->> 'id')::uuid, p_project_id, btrim(p_fila ->> 'codigo'), btrim(p_fila ->> 'nombre'), p_fila ->> 'color',
            coalesce((p_fila ->> 'orden')::integer, 0), coalesce((p_fila ->> 'activo')::boolean, true), p_usuario, p_usuario)
    returning * into r;
  else
    update public.loin_disciplinas
       set codigo = btrim(p_fila ->> 'codigo'), nombre = btrim(p_fila ->> 'nombre'), color = p_fila ->> 'color',
           orden = coalesce((p_fila ->> 'orden')::integer, 0), activo = coalesce((p_fila ->> 'activo')::boolean, true),
           version = version + 1, actualizado = now(), actualizado_por = p_usuario
     where id = (p_fila ->> 'id')::uuid and project_id = p_project_id and version = (p_fila ->> 'version')::integer
    returning * into r;
    if not found then
      raise exception 'version-conflict';
    end if;
  end if;
  return r;
exception when unique_violation then
  get stacked diagnostics v_restriccion = constraint_name;
  if v_restriccion like '%_pkey' then
    raise exception 'version-conflict';
  end if;
  raise exception 'duplicate-code';
end;
$$;

create or replace function public.loin_guardar_elemento(p_project_id text, p_fila jsonb, p_usuario text)
returns public.loin_elementos
language plpgsql
set search_path = public
as $$
declare
  r public.loin_elementos;
  v_restriccion text;
begin
  -- The discipline must be one of the project's.
  perform 1 from public.loin_disciplinas where id = (p_fila ->> 'disciplina_id')::uuid and project_id = p_project_id;
  if not found then
    raise exception 'loin-disciplina-ajena';
  end if;
  if (p_fila ->> 'version')::integer = 0 then
    insert into public.loin_elementos (id, project_id, disciplina_id, codigo, nombre, clase_ifc, tipo_predefinido, clasificacion_sistema, clasificacion_codigo,
                                       notas, parametros, orden, activo, creado_por, actualizado_por)
    values ((p_fila ->> 'id')::uuid, p_project_id, (p_fila ->> 'disciplina_id')::uuid, btrim(p_fila ->> 'codigo'), btrim(p_fila ->> 'nombre'),
            coalesce(p_fila ->> 'clase_ifc', ''), coalesce(p_fila ->> 'tipo_predefinido', ''), coalesce(p_fila ->> 'clasificacion_sistema', ''),
            coalesce(p_fila ->> 'clasificacion_codigo', ''), coalesce(p_fila ->> 'notas', ''), coalesce(p_fila -> 'parametros', '[]'::jsonb),
            coalesce((p_fila ->> 'orden')::integer, 0), coalesce((p_fila ->> 'activo')::boolean, true), p_usuario, p_usuario)
    returning * into r;
  else
    update public.loin_elementos
       set disciplina_id = (p_fila ->> 'disciplina_id')::uuid, codigo = btrim(p_fila ->> 'codigo'), nombre = btrim(p_fila ->> 'nombre'),
           clase_ifc = coalesce(p_fila ->> 'clase_ifc', ''), tipo_predefinido = coalesce(p_fila ->> 'tipo_predefinido', ''),
           clasificacion_sistema = coalesce(p_fila ->> 'clasificacion_sistema', ''), clasificacion_codigo = coalesce(p_fila ->> 'clasificacion_codigo', ''),
           notas = coalesce(p_fila ->> 'notas', ''), parametros = coalesce(p_fila -> 'parametros', '[]'::jsonb),
           orden = coalesce((p_fila ->> 'orden')::integer, 0), activo = coalesce((p_fila ->> 'activo')::boolean, true),
           version = version + 1, actualizado = now(), actualizado_por = p_usuario
     where id = (p_fila ->> 'id')::uuid and project_id = p_project_id and version = (p_fila ->> 'version')::integer
    returning * into r;
    if not found then
      raise exception 'version-conflict';
    end if;
  end if;
  return r;
exception when unique_violation then
  get stacked diagnostics v_restriccion = constraint_name;
  if v_restriccion like '%_pkey' then
    raise exception 'version-conflict';
  end if;
  raise exception 'duplicate-code';
end;
$$;

create or replace function public.loin_guardar_plantilla(p_base_id text, p_fila jsonb, p_usuario text)
returns public.loin_plantillas
language plpgsql
set search_path = public
as $$
declare
  r public.loin_plantillas;
begin
  if (p_fila ->> 'version')::integer = 0 then
    insert into public.loin_plantillas (id, base_id, nombre, descripcion, contenido, activo, creada_por, actualizado_por)
    values ((p_fila ->> 'id')::uuid, p_base_id, btrim(p_fila ->> 'nombre'), coalesce(p_fila ->> 'descripcion', ''), p_fila -> 'contenido',
            coalesce((p_fila ->> 'activo')::boolean, true), p_usuario, p_usuario)
    returning * into r;
  else
    -- The content of a template doesn't change after it is saved: only its name, description and whether it is active.
    update public.loin_plantillas
       set nombre = btrim(p_fila ->> 'nombre'), descripcion = coalesce(p_fila ->> 'descripcion', ''), activo = coalesce((p_fila ->> 'activo')::boolean, true),
           version = version + 1, actualizado = now(), actualizado_por = p_usuario
     where id = (p_fila ->> 'id')::uuid and base_id = p_base_id and version = (p_fila ->> 'version')::integer
    returning * into r;
    if not found then
      raise exception 'version-conflict';
    end if;
  end if;
  return r;
exception when unique_violation then
  raise exception 'version-conflict';
end;
$$;

-- Bucket privado de Storage para las imágenes (sin acceso público: el servidor
-- entrega enlaces firmados que vencen). Solo existe en Supabase.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('loin-imagenes', 'loin-imagenes', false) on conflict (id) do nothing;
    begin
      update storage.buckets
         set public = false, file_size_limit = 2000000, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
       where id = 'loin-imagenes';
    exception when undefined_column then
      null; -- older Storage without per-bucket limits: the server checks them anyway
    end;
  end if;
end;
$$;

alter table public.loin_config enable row level security;
alter table public.loin_catalogos enable row level security;
alter table public.loin_parametros enable row level security;
alter table public.loin_disciplinas enable row level security;
alter table public.loin_elementos enable row level security;
alter table public.loin_imagenes enable row level security;
alter table public.loin_plantillas enable row level security;
revoke all on function public.loin_guardar_parametros(text, jsonb, text) from public;
revoke all on function public.loin_guardar_disciplina(text, jsonb, text) from public;
revoke all on function public.loin_guardar_elemento(text, jsonb, text) from public;
revoke all on function public.loin_guardar_plantilla(text, jsonb, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.loin_guardar_parametros(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_guardar_disciplina(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_guardar_elemento(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_guardar_plantilla(text, jsonb, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loin_guardar_parametros(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_disciplina(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_elemento(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_plantilla(text, jsonb, text) to service_role;
  end if;
end;
$$;

-- Que la API REST de Supabase vea las tablas y funciones nuevas.
notify pgrst, 'reload schema';
