-- Requisitos BIM (LOIN): catálogo de parámetros, disciplinas, elementos a
-- modelar con sus imágenes de referencia y parámetros exigidos, y plantillas
-- de disciplina, etapas y matriz LOIN, modelos por disciplina, reglas y
-- asociaciones manuales con los objetos de los modelos, auditorías y
-- excepciones. Se puede ejecutar varias veces sin perder datos (Supabase →
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

-- Lo que pertenece al catálogo (en su proyecto base): los grupos TDI y los
-- niveles NDI (null = los de fábrica, NDI-1 a NDI-3).
create table if not exists public.loin_catalogos (
  base_id     text        primary key,
  tdi_grupos  jsonb       not null default '[]'::jsonb check (jsonb_typeof(tdi_grupos) = 'array'),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.loin_catalogos add column if not exists ndi_niveles jsonb check (ndi_niveles is null or jsonb_typeof(ndi_niveles) = 'array');

create table if not exists public.loin_parametros (
  id                 uuid        primary key,
  base_id            text        not null,
  codigo             text        not null check (length(btrim(codigo)) between 1 and 40),
  numero             integer     check (numero is null or numero > 0),
  nombre             text        not null check (length(btrim(nombre)) between 1 and 200),
  descripcion        text        not null default '',
  tdi                text        not null check (tdi ~ '^[A-Z]$'),
  ndi                smallint    not null check (ndi between 1 and 9),
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
-- Los niveles NDI se configuran (del 1 al 9; antes iban fijos del 1 al 3).
alter table public.loin_parametros drop constraint if exists loin_parametros_ndi_check;
alter table public.loin_parametros add constraint loin_parametros_ndi_check check (ndi between 1 and 9);

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
-- Regla de asociación con los objetos de los modelos: {"modo": "todas"|"alguna", "condiciones": [...]}.
alter table public.loin_elementos add column if not exists regla jsonb check (regla is null or jsonb_typeof(regla) = 'object');
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

-- Etapas o hitos del proyecto (Anteproyecto, Proyecto, Licencia, Construcción, As-built…).
create table if not exists public.loin_etapas (
  id              uuid        primary key,
  project_id      text        not null,
  codigo          text        not null check (length(btrim(codigo)) between 1 and 20),
  nombre          text        not null check (length(btrim(nombre)) between 1 and 120),
  fecha           date,
  orden           integer     not null default 0,
  activo          boolean     not null default true,
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text,
  actualizado     timestamptz not null default now(),
  actualizado_por text
);
create unique index if not exists loin_etapas_codigo_unico on public.loin_etapas (project_id, lower(btrim(codigo)));

-- Matriz LOIN: lo que cada elemento debe tener en cada etapa. LOD y NDI vacíos
-- = no se exige en esa etapa (la celda no se borra, se deja sin exigencia).
create table if not exists public.loin_matriz (
  id              uuid        primary key,
  project_id      text        not null,
  elemento_id     uuid        not null references public.loin_elementos (id),
  etapa_id        uuid        not null references public.loin_etapas (id),
  lod             smallint    check (lod is null or lod in (100, 200, 300, 350, 400, 500)),
  ndi             smallint    check (ndi is null or ndi between 1 and 9),
  propositos      jsonb       not null default '[]'::jsonb check (jsonb_typeof(propositos) = 'array'),
  actor           text        not null default '',
  nota            text        not null default '',
  version         integer     not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text,
  actualizado     timestamptz not null default now(),
  actualizado_por text
);
create unique index if not exists loin_matriz_celda_unica on public.loin_matriz (elemento_id, etapa_id);
alter table public.loin_matriz drop constraint if exists loin_matriz_ndi_check;
alter table public.loin_matriz add constraint loin_matriz_ndi_check check (ndi is null or ndi between 1 and 9);
create index if not exists loin_matriz_proyecto on public.loin_matriz (project_id);

-- Modelos del proyecto (por id de archivo, que no cambia con las versiones) y
-- las disciplinas a las que pertenecen: sus objetos se comparan con las
-- reglas de los elementos de esas disciplinas.
create table if not exists public.loin_modelos (
  project_id  text        not null,
  file_id     text        not null check (length(file_id) between 1 and 100),
  nombre      text        not null default '',
  disciplinas jsonb       not null default '[]'::jsonb check (jsonb_typeof(disciplinas) = 'array'),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (project_id, file_id)
);

-- Objetos asociados a mano a un elemento (por IFCGUID); ganan sobre las reglas.
create table if not exists public.loin_asociaciones (
  project_id  text        not null,
  ifc_guid    text        not null check (ifc_guid ~ '^[0-3][0-9A-Za-z_$]{21}$'),
  file_id     text        not null,
  elemento_id uuid        not null references public.loin_elementos (id),
  creado      timestamptz not null default now(),
  creado_por  text,
  primary key (project_id, ifc_guid)
);
create index if not exists loin_asociaciones_elemento on public.loin_asociaciones (elemento_id);

-- Nombres de grupos y propiedades leídos de los modelos (para elegir equivalencias y campos de reglas).
create table if not exists public.loin_campos_modelo (
  project_id text        primary key,
  leido      timestamptz not null default now(),
  leido_por  text,
  modelos    jsonb       not null default '[]'::jsonb check (jsonb_typeof(modelos) = 'array'),
  campos     jsonb       not null default '[]'::jsonb check (jsonb_typeof(campos) = 'array')
);

-- Asocia (p_elemento_id) o quita la asociación manual (p_elemento_id null) de
-- varios objetos: todos o ninguno; el elemento debe ser del proyecto.
create or replace function public.loin_asociar(p_project_id text, p_elemento_id uuid, p_filas jsonb, p_usuario text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  f jsonb;
  n integer := 0;
begin
  if p_elemento_id is not null then
    perform 1 from public.loin_elementos where id = p_elemento_id and project_id = p_project_id;
    if not found then
      raise exception 'disciplina-ajena';
    end if;
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    if p_elemento_id is null then
      delete from public.loin_asociaciones where project_id = p_project_id and ifc_guid = f ->> 'ifc_guid';
    else
      insert into public.loin_asociaciones (project_id, ifc_guid, file_id, elemento_id, creado_por)
      values (p_project_id, f ->> 'ifc_guid', f ->> 'file_id', p_elemento_id, p_usuario)
      on conflict (project_id, ifc_guid) do update
        set elemento_id = excluded.elemento_id, file_id = excluded.file_id, creado = now(), creado_por = excluded.creado_por;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Auditorías guardadas: la cabecera (resumen y configuración usada) y sus
-- objetos por partes. Mientras se guardan están 'guardando'; al cerrarlas
-- quedan 'completa' y ya no cambian. Nunca se borran.
create table if not exists public.loin_auditorias (
  id         uuid        primary key,
  project_id text        not null,
  etapa_id   uuid        not null references public.loin_etapas (id),
  estado     text        not null default 'guardando' check (estado in ('guardando', 'completa')),
  creada     timestamptz not null default now(),
  creada_por text,
  nota       text        not null default '',
  resumen    jsonb       not null check (jsonb_typeof(resumen) = 'object')
);
create index if not exists loin_auditorias_proyecto on public.loin_auditorias (project_id, creada desc);

create table if not exists public.loin_auditoria_resultados (
  auditoria_id uuid    not null references public.loin_auditorias (id),
  parte        integer not null check (parte > 0),
  elemento_id  uuid,
  objetos      jsonb   not null check (jsonb_typeof(objetos) = 'array'),
  primary key (auditoria_id, parte)
);

-- Incumplimientos aceptados por el coordinador (objeto + parámetro + etapa),
-- con justificación y autor. Se revocan, nunca se borran.
create table if not exists public.loin_excepciones (
  id                uuid        primary key,
  project_id        text        not null,
  etapa_id          uuid        not null references public.loin_etapas (id),
  ifc_guid          text        not null check (ifc_guid ~ '^[0-3][0-9A-Za-z_$]{21}$'),
  parametro_id      uuid        not null references public.loin_parametros (id),
  elemento_id       uuid,
  justificacion     text        not null check (length(btrim(justificacion)) between 5 and 1000),
  creada            timestamptz not null default now(),
  creada_por        text,
  activa            boolean     not null default true,
  revocada          timestamptz,
  revocada_por      text,
  motivo_revocacion text        not null default ''
);
create unique index if not exists loin_excepciones_vigente on public.loin_excepciones (project_id, etapa_id, ifc_guid, parametro_id) where activa;
create index if not exists loin_excepciones_proyecto on public.loin_excepciones (project_id);

-- Una auditoría completa no cambia; sus resultados no cambian nunca; una
-- excepción solo pasa de activa a revocada.
create or replace function public.loin_auditoria_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'loin_auditorias' then
    if old.estado = 'completa' then
      raise exception 'loin-inmutable: una auditoría completa no se cambia';
    end if;
  elsif tg_table_name = 'loin_auditoria_resultados' then
    raise exception 'loin-inmutable: los resultados de una auditoría no se cambian';
  elsif tg_table_name = 'loin_excepciones' then
    if not old.activa or new.activa or new.ifc_guid <> old.ifc_guid or new.parametro_id <> old.parametro_id or new.etapa_id <> old.etapa_id
       or new.justificacion <> old.justificacion or new.creada <> old.creada then
      raise exception 'loin-inmutable: una excepción solo se puede revocar';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loin_auditorias_inmutable on public.loin_auditorias;
create trigger loin_auditorias_inmutable before update on public.loin_auditorias for each row execute function public.loin_auditoria_inmutable();
drop trigger if exists loin_auditoria_resultados_inmutable on public.loin_auditoria_resultados;
create trigger loin_auditoria_resultados_inmutable before update on public.loin_auditoria_resultados for each row execute function public.loin_auditoria_inmutable();
drop trigger if exists loin_excepciones_inmutable on public.loin_excepciones;
create trigger loin_excepciones_inmutable before update on public.loin_excepciones for each row execute function public.loin_auditoria_inmutable();

-- Crea la cabecera de una auditoría ('guardando'); la etapa debe ser del proyecto.
create or replace function public.loin_crear_auditoria(p_project_id text, p_id uuid, p_etapa_id uuid, p_resumen jsonb, p_nota text, p_usuario text)
returns public.loin_auditorias
language plpgsql
set search_path = public
as $$
declare
  r public.loin_auditorias;
begin
  perform 1 from public.loin_etapas where id = p_etapa_id and project_id = p_project_id;
  if not found then
    raise exception 'disciplina-ajena';
  end if;
  insert into public.loin_auditorias (id, project_id, etapa_id, resumen, nota, creada_por)
  values (p_id, p_project_id, p_etapa_id, p_resumen, coalesce(p_nota, ''), p_usuario)
  returning * into r;
  return r;
exception when unique_violation then
  raise exception 'version-conflict';
end;
$$;

-- Agrega partes de los objetos a una auditoría que se está guardando. Una
-- parte ya guardada se deja como está (así un reintento no la duplica).
create or replace function public.loin_agregar_resultados(p_project_id text, p_auditoria_id uuid, p_lotes jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  l jsonb;
  n integer := 0;
begin
  perform 1 from public.loin_auditorias where id = p_auditoria_id and project_id = p_project_id and estado = 'guardando' for update;
  if not found then
    raise exception 'loin-auditoria-cerrada';
  end if;
  for l in select * from jsonb_array_elements(p_lotes) loop
    insert into public.loin_auditoria_resultados (auditoria_id, parte, elemento_id, objetos)
    values (p_auditoria_id, (l ->> 'parte')::integer, (l ->> 'elemento_id')::uuid, coalesce(l -> 'objetos', '[]'::jsonb))
    on conflict (auditoria_id, parte) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Cierra la auditoría si tiene todas sus partes (si falta alguna: 'loin-auditoria-incompleta').
create or replace function public.loin_cerrar_auditoria(p_project_id text, p_id uuid, p_partes integer)
returns public.loin_auditorias
language plpgsql
set search_path = public
as $$
declare
  r public.loin_auditorias;
  v_partes integer;
begin
  perform 1 from public.loin_auditorias where id = p_id and project_id = p_project_id and estado = 'guardando' for update;
  if not found then
    raise exception 'loin-auditoria-cerrada';
  end if;
  select count(*) into v_partes from public.loin_auditoria_resultados where auditoria_id = p_id;
  if v_partes <> p_partes then
    raise exception 'loin-auditoria-incompleta';
  end if;
  update public.loin_auditorias set estado = 'completa' where id = p_id returning * into r;
  return r;
end;
$$;

-- Crea excepciones (las que ya están vigentes para el mismo objeto, parámetro y etapa se dejan).
create or replace function public.loin_crear_excepciones(p_project_id text, p_filas jsonb, p_usuario text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  f jsonb;
  n integer := 0;
  v integer;
begin
  for f in select * from jsonb_array_elements(p_filas) loop
    perform 1 from public.loin_etapas where id = (f ->> 'etapa_id')::uuid and project_id = p_project_id;
    if not found then
      raise exception 'disciplina-ajena';
    end if;
    insert into public.loin_excepciones (id, project_id, etapa_id, ifc_guid, parametro_id, elemento_id, justificacion, creada_por)
    values ((f ->> 'id')::uuid, p_project_id, (f ->> 'etapa_id')::uuid, f ->> 'ifc_guid', (f ->> 'parametro_id')::uuid, (f ->> 'elemento_id')::uuid,
            btrim(f ->> 'justificacion'), p_usuario)
    on conflict (project_id, etapa_id, ifc_guid, parametro_id) where activa do nothing;
    get diagnostics v = row_count;
    n := n + v;
  end loop;
  return n;
end;
$$;

create or replace function public.loin_revocar_excepcion(p_project_id text, p_id uuid, p_motivo text, p_usuario text)
returns public.loin_excepciones
language plpgsql
set search_path = public
as $$
declare
  r public.loin_excepciones;
begin
  update public.loin_excepciones
     set activa = false, revocada = now(), revocada_por = p_usuario, motivo_revocacion = coalesce(btrim(p_motivo), '')
   where id = p_id and project_id = p_project_id and activa
  returning * into r;
  if not found then
    raise exception 'version-conflict';
  end if;
  return r;
end;
$$;

-- Nada del catálogo, disciplinas, elementos, plantillas, etapas ni matriz se borra: se desactiva.
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
drop trigger if exists loin_etapas_sin_borrar on public.loin_etapas;
create trigger loin_etapas_sin_borrar before delete on public.loin_etapas for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_matriz_sin_borrar on public.loin_matriz;
create trigger loin_matriz_sin_borrar before delete on public.loin_matriz for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_auditorias_sin_borrar on public.loin_auditorias;
create trigger loin_auditorias_sin_borrar before delete on public.loin_auditorias for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_auditoria_resultados_sin_borrar on public.loin_auditoria_resultados;
create trigger loin_auditoria_resultados_sin_borrar before delete on public.loin_auditoria_resultados for each row execute function public.loin_sin_borrar();
drop trigger if exists loin_excepciones_sin_borrar on public.loin_excepciones;
create trigger loin_excepciones_sin_borrar before delete on public.loin_excepciones for each row execute function public.loin_sin_borrar();

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
                                       notas, parametros, regla, orden, activo, creado_por, actualizado_por)
    values ((p_fila ->> 'id')::uuid, p_project_id, (p_fila ->> 'disciplina_id')::uuid, btrim(p_fila ->> 'codigo'), btrim(p_fila ->> 'nombre'),
            coalesce(p_fila ->> 'clase_ifc', ''), coalesce(p_fila ->> 'tipo_predefinido', ''), coalesce(p_fila ->> 'clasificacion_sistema', ''),
            coalesce(p_fila ->> 'clasificacion_codigo', ''), coalesce(p_fila ->> 'notas', ''), coalesce(p_fila -> 'parametros', '[]'::jsonb),
            nullif(p_fila -> 'regla', 'null'::jsonb),
            coalesce((p_fila ->> 'orden')::integer, 0), coalesce((p_fila ->> 'activo')::boolean, true), p_usuario, p_usuario)
    returning * into r;
  else
    update public.loin_elementos
       set disciplina_id = (p_fila ->> 'disciplina_id')::uuid, codigo = btrim(p_fila ->> 'codigo'), nombre = btrim(p_fila ->> 'nombre'),
           clase_ifc = coalesce(p_fila ->> 'clase_ifc', ''), tipo_predefinido = coalesce(p_fila ->> 'tipo_predefinido', ''),
           clasificacion_sistema = coalesce(p_fila ->> 'clasificacion_sistema', ''), clasificacion_codigo = coalesce(p_fila ->> 'clasificacion_codigo', ''),
           notas = coalesce(p_fila ->> 'notas', ''), parametros = coalesce(p_fila -> 'parametros', '[]'::jsonb),
           regla = nullif(p_fila -> 'regla', 'null'::jsonb),
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

create or replace function public.loin_guardar_etapa(p_project_id text, p_fila jsonb, p_usuario text)
returns public.loin_etapas
language plpgsql
set search_path = public
as $$
declare
  r public.loin_etapas;
  v_restriccion text;
begin
  if (p_fila ->> 'version')::integer = 0 then
    insert into public.loin_etapas (id, project_id, codigo, nombre, fecha, orden, activo, creado_por, actualizado_por)
    values ((p_fila ->> 'id')::uuid, p_project_id, btrim(p_fila ->> 'codigo'), btrim(p_fila ->> 'nombre'), (p_fila ->> 'fecha')::date,
            coalesce((p_fila ->> 'orden')::integer, 0), coalesce((p_fila ->> 'activo')::boolean, true), p_usuario, p_usuario)
    returning * into r;
  else
    update public.loin_etapas
       set codigo = btrim(p_fila ->> 'codigo'), nombre = btrim(p_fila ->> 'nombre'), fecha = (p_fila ->> 'fecha')::date,
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

-- Guarda varias celdas de la matriz: todas o ninguna. El elemento y la etapa
-- deben ser del proyecto ('disciplina-ajena'); una celda creada por otra
-- persona mientras tanto, o una versión vieja, es 'version-conflict'.
create or replace function public.loin_guardar_matriz(p_project_id text, p_filas jsonb, p_usuario text)
returns setof public.loin_matriz
language plpgsql
set search_path = public
as $$
declare
  f jsonb;
  r public.loin_matriz;
begin
  for f in select * from jsonb_array_elements(p_filas) loop
    perform 1 from public.loin_elementos where id = (f ->> 'elemento_id')::uuid and project_id = p_project_id;
    if not found then
      raise exception 'disciplina-ajena';
    end if;
    perform 1 from public.loin_etapas where id = (f ->> 'etapa_id')::uuid and project_id = p_project_id;
    if not found then
      raise exception 'disciplina-ajena';
    end if;
    if (f ->> 'version')::integer = 0 then
      insert into public.loin_matriz (id, project_id, elemento_id, etapa_id, lod, ndi, propositos, actor, nota, creado_por, actualizado_por)
      values ((f ->> 'id')::uuid, p_project_id, (f ->> 'elemento_id')::uuid, (f ->> 'etapa_id')::uuid, (f ->> 'lod')::smallint, (f ->> 'ndi')::smallint,
              coalesce(f -> 'propositos', '[]'::jsonb), coalesce(f ->> 'actor', ''), coalesce(f ->> 'nota', ''), p_usuario, p_usuario)
      returning * into r;
    else
      update public.loin_matriz
         set lod = (f ->> 'lod')::smallint, ndi = (f ->> 'ndi')::smallint, propositos = coalesce(f -> 'propositos', '[]'::jsonb),
             actor = coalesce(f ->> 'actor', ''), nota = coalesce(f ->> 'nota', ''),
             version = version + 1, actualizado = now(), actualizado_por = p_usuario
       where id = (f ->> 'id')::uuid and project_id = p_project_id and version = (f ->> 'version')::integer
         and elemento_id = (f ->> 'elemento_id')::uuid and etapa_id = (f ->> 'etapa_id')::uuid
      returning * into r;
      if not found then
        raise exception 'version-conflict';
      end if;
    end if;
    return next r;
  end loop;
  return;
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
alter table public.loin_etapas enable row level security;
alter table public.loin_matriz enable row level security;
alter table public.loin_modelos enable row level security;
alter table public.loin_asociaciones enable row level security;
alter table public.loin_campos_modelo enable row level security;
alter table public.loin_auditorias enable row level security;
alter table public.loin_auditoria_resultados enable row level security;
alter table public.loin_excepciones enable row level security;
revoke all on function public.loin_crear_auditoria(text, uuid, uuid, jsonb, text, text) from public;
revoke all on function public.loin_agregar_resultados(text, uuid, jsonb) from public;
revoke all on function public.loin_cerrar_auditoria(text, uuid, integer) from public;
revoke all on function public.loin_crear_excepciones(text, jsonb, text) from public;
revoke all on function public.loin_revocar_excepcion(text, uuid, text, text) from public;
revoke all on function public.loin_asociar(text, uuid, jsonb, text) from public;
revoke all on function public.loin_guardar_parametros(text, jsonb, text) from public;
revoke all on function public.loin_guardar_etapa(text, jsonb, text) from public;
revoke all on function public.loin_guardar_matriz(text, jsonb, text) from public;
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
    revoke all on function public.loin_guardar_etapa(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_guardar_matriz(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_asociar(text, uuid, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_crear_auditoria(text, uuid, uuid, jsonb, text, text) from anon, authenticated;
    revoke all on function public.loin_agregar_resultados(text, uuid, jsonb) from anon, authenticated;
    revoke all on function public.loin_cerrar_auditoria(text, uuid, integer) from anon, authenticated;
    revoke all on function public.loin_crear_excepciones(text, jsonb, text) from anon, authenticated;
    revoke all on function public.loin_revocar_excepcion(text, uuid, text, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loin_guardar_parametros(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_disciplina(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_elemento(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_plantilla(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_etapa(text, jsonb, text) to service_role;
    grant execute on function public.loin_guardar_matriz(text, jsonb, text) to service_role;
    grant execute on function public.loin_asociar(text, uuid, jsonb, text) to service_role;
    grant execute on function public.loin_crear_auditoria(text, uuid, uuid, jsonb, text, text) to service_role;
    grant execute on function public.loin_agregar_resultados(text, uuid, jsonb) to service_role;
    grant execute on function public.loin_cerrar_auditoria(text, uuid, integer) to service_role;
    grant execute on function public.loin_crear_excepciones(text, jsonb, text) to service_role;
    grant execute on function public.loin_revocar_excepcion(text, uuid, text, text) to service_role;
  end if;
end;
$$;

-- Que la API REST de Supabase vea las tablas y funciones nuevas.
notify pgrst, 'reload schema';
