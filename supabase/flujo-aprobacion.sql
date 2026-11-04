-- Flujo de aprobación: flujos (con su título o hito), quién hace qué en sus
-- carpetas y archivos, e historial. Los archivos nunca se guardan aquí: viven
-- en Trimble Connect; aquí se guarda la configuración y lo que pasó.
-- Re-ejecutable: se puede correr varias veces en el SQL Editor sin perder datos.
-- RLS activo y sin políticas: solo el servidor (service_role) lee y escribe.

-- Un flujo de aprobación. No se borra: se desactiva.
create table if not exists public.aprobacion_flujos (
  id uuid primary key default gen_random_uuid(),
  proyecto text not null,
  -- El título o hito que soportan los archivos del flujo
  -- ("Aprobar diseño arquitectónico Torre 1").
  hito text not null,
  -- El hito en minúsculas, sin tildes ni espacios dobles: no se repite en el proyecto.
  hito_clave text not null,
  -- Los pasos después de "Realiza": [{ "id": "p1", "nombre": "Revisa" }, …] (1 a 5).
  pasos jsonb not null default '[]'::jsonb,
  -- Carpetas de revisión: [{ "id", "ruta", "ancestros": [ids de la raíz hacia abajo] }].
  carpetas jsonb not null default '[]'::jsonb,
  -- Carpeta destino: { "id", "ruta", "ancestros" }.
  destino jsonb not null,
  activo boolean not null default true,
  -- Guardado optimista: quien guarda manda la versión que vio.
  version integer not null default 1,
  creado timestamptz not null default now(),
  creado_por text,
  actualizado timestamptz not null default now(),
  actualizado_por text
);

create unique index if not exists aprobacion_flujos_hito on public.aprobacion_flujos (proyecto, hito_clave);
create index if not exists aprobacion_flujos_proyecto on public.aprobacion_flujos (proyecto);

-- Una carpeta de revisión solo puede estar en un flujo activo del proyecto.
-- El bloqueo por proyecto evita que dos guardados a la vez se salten la regla.
create or replace function public.aprobacion_revisar_carpetas() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('aprobacion:' || new.proyecto));
  if new.activo and exists (
    select 1
    from public.aprobacion_flujos f,
         jsonb_array_elements(f.carpetas) c,
         jsonb_array_elements(new.carpetas) n
    where f.proyecto = new.proyecto
      and f.id <> new.id
      and f.activo
      and c ->> 'id' = n ->> 'id'
  ) then
    raise exception 'carpeta-en-otro-flujo' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists aprobacion_flujos_carpetas on public.aprobacion_flujos;
create trigger aprobacion_flujos_carpetas
  before insert or update on public.aprobacion_flujos
  for each row execute function public.aprobacion_revisar_carpetas();

-- Quién hace qué en una carpeta o un archivo de un flujo. Papel: 'realiza'
-- (sube y corrige), 'consulta' (solo ve) o el id de un paso del flujo.
-- No se borra: se desactiva.
create table if not exists public.aprobacion_asignaciones (
  id uuid primary key default gen_random_uuid(),
  flujo_id uuid not null references public.aprobacion_flujos (id),
  proyecto text not null,
  objetivo_tipo text not null check (objetivo_tipo in ('carpeta', 'archivo')),
  objetivo_id text not null,
  objetivo_ruta text not null default '',
  -- Ids de las carpetas de arriba (de la raíz hacia abajo): manda lo más cercano.
  objetivo_ancestros text[] not null default '{}',
  papel text not null,
  quien_tipo text not null check (quien_tipo in ('persona', 'grupo')),
  quien_id text not null,
  quien_nombre text not null default '',
  activa boolean not null default true,
  creado timestamptz not null default now(),
  creado_por text
);

create unique index if not exists aprobacion_asignaciones_unica
  on public.aprobacion_asignaciones (flujo_id, objetivo_id, papel, quien_tipo, quien_id)
  where activa;
create index if not exists aprobacion_asignaciones_proyecto on public.aprobacion_asignaciones (proyecto);

-- Historial: solo se agregan filas, nunca se cambian ni se borran.
create table if not exists public.aprobacion_historial (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  proyecto text not null,
  flujo_id uuid,
  -- flujo-creado · flujo-modificado · flujo-desactivado · flujo-activado ·
  -- asignacion-agregada · asignacion-quitada
  accion text not null,
  usuario text,
  usuario_id text,
  detalle text not null default ''
);

create index if not exists aprobacion_historial_proyecto on public.aprobacion_historial (proyecto, creado desc);
create index if not exists aprobacion_historial_flujo on public.aprobacion_historial (flujo_id, creado desc);

alter table public.aprobacion_flujos enable row level security;
alter table public.aprobacion_asignaciones enable row level security;
alter table public.aprobacion_historial enable row level security;

revoke all on public.aprobacion_flujos from anon, authenticated;
revoke all on public.aprobacion_asignaciones from anon, authenticated;
revoke all on public.aprobacion_historial from anon, authenticated;
revoke all on function public.aprobacion_revisar_carpetas() from public, anon, authenticated;

-- Sin "delete": los flujos y las asignaciones se desactivan y el historial no se toca.
revoke delete, truncate on table public.aprobacion_flujos from public, anon, authenticated, service_role;
revoke delete, truncate on table public.aprobacion_asignaciones from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.aprobacion_historial from public, anon, authenticated, service_role;
grant select, insert, update on public.aprobacion_flujos to service_role;
grant select, insert, update on public.aprobacion_asignaciones to service_role;
grant select, insert on public.aprobacion_historial to service_role;
