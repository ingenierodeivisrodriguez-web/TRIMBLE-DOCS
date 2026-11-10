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

-- ------------------------------------------------------------------ fase 2
-- Archivos de las carpetas de revisión, registrados al abrir la extensión o
-- con "Revisar ahora". Uno por archivo de Trimble. No se borra: un archivo que
-- ya no está queda "retirado".

-- Cuándo y quién revisó por última vez las carpetas de un flujo, y quién lo
-- está revisando ahora (para que dos personas no registren lo mismo a la vez).
alter table public.aprobacion_flujos add column if not exists revisando_hasta timestamptz;
alter table public.aprobacion_flujos add column if not exists revisado timestamptz;
alter table public.aprobacion_flujos add column if not exists revisado_por text;

create table if not exists public.aprobacion_archivos (
  id uuid primary key default gen_random_uuid(),
  proyecto text not null,
  flujo_id uuid not null references public.aprobacion_flujos (id),
  -- Id del archivo en Trimble Connect.
  file_id text not null,
  nombre text not null,
  ruta text not null default '',
  carpeta_id text,
  -- Ids de las carpetas de arriba (de la raíz hacia abajo).
  ancestros text[] not null default '{}',
  tipo text not null default '',
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'nueva-version', 'aprobado', 'rechazado', 'retirado')),
  -- Copia de los pasos del flujo cuando empezó esta revisión (un cambio del
  -- flujo no toca los archivos en trámite).
  pasos jsonb not null default '[]'::jsonb,
  paso_actual integer not null default 0,
  -- La versión en revisión (la última que tenía Trimble al verla).
  version_id text,
  revision integer,
  -- Cuándo y quién subió esa versión, según Trimble.
  subido timestamptz,
  subido_por text not null default '',
  subido_por_id text,
  -- La última versión aprobada (fase 3).
  version_aprobada_id text,
  revision_aprobada integer,
  detectado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (proyecto, file_id)
);

create index if not exists aprobacion_archivos_flujo on public.aprobacion_archivos (flujo_id);

alter table public.aprobacion_historial add column if not exists archivo_id uuid;
alter table public.aprobacion_historial add column if not exists file_id text;
alter table public.aprobacion_historial add column if not exists version integer;
-- Cuándo pasó en Trimble (por ejemplo, cuándo se subió la versión); "creado" es cuándo se anotó.
alter table public.aprobacion_historial add column if not exists ocurrido timestamptz;
create index if not exists aprobacion_historial_archivo on public.aprobacion_historial (archivo_id, creado desc);

alter table public.aprobacion_archivos enable row level security;
revoke all on public.aprobacion_archivos from anon, authenticated;
revoke delete, truncate on table public.aprobacion_archivos from public, anon, authenticated, service_role;
grant select, insert, update on public.aprobacion_archivos to service_role;

-- ------------------------------------------------------------------ fase 3
-- Las decisiones de la revisión en curso, paso por paso: [{ "pasoId", "paso",
-- "decision": aprobado | rechazado, "quien", "quienId", "comoAdmin", "fecha",
-- "revision", "versionId", "comentario" }]. Se vacía al empezar una revisión
-- nueva (versión nueva); lo anterior queda en el historial.
alter table public.aprobacion_archivos add column if not exists firmas jsonb not null default '[]'::jsonb;

-- ------------------------------------------------------------------ fase 4
-- La copia de la versión aprobada a la carpeta destino: { "estado": pendiente |
-- en-curso | hecho | diferencia | error, "mensaje", "versionId", "revision",
-- "carpetaId", "carpetaRuta", "uploadId", "destinoFileId", "destinoVersionId",
-- "destinoRevision", "por", "porId", "fecha", "diferenciaVersionId",
-- "diferenciaTexto" }. "traslado_hasta" evita que dos personas copien el mismo
-- archivo a la vez.
alter table public.aprobacion_archivos add column if not exists traslado jsonb;
alter table public.aprobacion_archivos add column if not exists traslado_hasta timestamptz;

-- ------------------------------------------- pantalla única (06-11-2026)
-- Fecha de vencimiento del hito (opcional) y notas del flujo.
alter table public.aprobacion_flujos add column if not exists vence date;
alter table public.aprobacion_flujos add column if not exists notas text not null default '';

-- Comentarios de un flujo: solo se agregan, nunca se cambian ni se borran.
create table if not exists public.aprobacion_comentarios (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  proyecto text not null,
  flujo_id uuid not null references public.aprobacion_flujos (id),
  texto text not null check (char_length(texto) between 1 and 2000),
  usuario text,
  usuario_id text
);

create index if not exists aprobacion_comentarios_flujo on public.aprobacion_comentarios (flujo_id, creado);

alter table public.aprobacion_comentarios enable row level security;
revoke all on public.aprobacion_comentarios from anon, authenticated;
revoke update, delete, truncate on table public.aprobacion_comentarios from public, anon, authenticated, service_role;
grant select, insert on public.aprobacion_comentarios to service_role;

-- ------------------------------- archivos elegidos y responsables (09-11-2026)
-- Quien crea el flujo marca sus archivos (ya no hay carpetas de revisión ni
-- "quién hace qué" por carpeta) y elige el responsable de cada paso, que se
-- guarda dentro de "pasos": [{ "id", "nombre", "responsable": { "tipo":
-- persona | grupo, "id", "nombre" } }]. Ya no se elige carpeta destino al
-- crear: queda solo en los flujos de antes.

-- Archivos del flujo: [{ "id", "ruta", "ancestros": [ids de la raíz hacia abajo] }].
alter table public.aprobacion_flujos add column if not exists archivos jsonb not null default '[]'::jsonb;
-- Quién lo creó (id de Trimble): esa persona y los administradores lo cambian.
alter table public.aprobacion_flujos add column if not exists creado_por_id text;
alter table public.aprobacion_flujos alter column destino drop not null;

-- Un archivo solo puede estar en un flujo activo del proyecto.
create or replace function public.aprobacion_revisar_archivos() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('aprobacion:' || new.proyecto));
  if new.activo and exists (
    select 1
    from public.aprobacion_flujos f,
         jsonb_array_elements(f.archivos) c,
         jsonb_array_elements(new.archivos) n
    where f.proyecto = new.proyecto
      and f.id <> new.id
      and f.activo
      and c ->> 'id' = n ->> 'id'
  ) then
    raise exception 'archivo-en-otro-flujo' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists aprobacion_flujos_archivos on public.aprobacion_flujos;
create trigger aprobacion_flujos_archivos
  before insert or update on public.aprobacion_flujos
  for each row execute function public.aprobacion_revisar_archivos();
revoke all on function public.aprobacion_revisar_archivos() from public, anon, authenticated;

-- Flujos de antes: los archivos que ya tenían registrados (no retirados) pasan
-- a ser sus archivos elegidos. Solo se hace una vez (cuando todavía no tienen).
update public.aprobacion_flujos f
   set archivos = coalesce((
         select jsonb_agg(jsonb_build_object('id', a.file_id, 'ruta', a.ruta, 'ancestros', to_jsonb(a.ancestros)) order by a.ruta)
         from public.aprobacion_archivos a
         where a.flujo_id = f.id and a.estado <> 'retirado'
       ), '[]'::jsonb)
 where f.archivos = '[]'::jsonb
   and f.carpetas <> '[]'::jsonb;

-- ---------------------------------------- versión fija del flujo (10-11-2026)
-- Un flujo conserva la versión que se le dio (la que tenía Trimble al elegir el
-- archivo): si sube una más nueva, no la reemplaza ni empieza otra revisión;
-- solo se anota aquí para avisarla en la pantalla:
-- { "versionId", "revision", "nombre", "subido", "subidoPor", "subidoPorId", "visto" }.
alter table public.aprobacion_archivos add column if not exists version_nueva jsonb;

-- Una sola vez: los archivos que ya estaban aprobados y volvieron a revisión
-- porque llegó una versión nueva («Nueva versión pendiente», como
-- CIRCUITOS TR2.rvt) vuelven a «Aprobado» con su versión aprobada, y la nueva
-- queda como aviso. Quién subió la versión aprobada y cuándo salen del
-- historial (las firmas de esa aprobación siguen en el historial y en el PDF).
update public.aprobacion_archivos a
   set estado = 'aprobado',
       version_nueva = jsonb_build_object(
         'versionId', a.version_id, 'revision', a.revision, 'nombre', a.nombre,
         'subido', a.subido, 'subidoPor', a.subido_por, 'subidoPorId', a.subido_por_id, 'visto', now()),
       version_id = a.version_aprobada_id,
       revision = a.revision_aprobada,
       subido = (select h.ocurrido from public.aprobacion_historial h
                  where h.archivo_id = a.id and h.version = a.revision_aprobada
                    and h.accion in ('archivo-detectado', 'version-reemplazada', 'nueva-version')
                  order by h.id desc limit 1),
       subido_por = coalesce((select h.usuario from public.aprobacion_historial h
                  where h.archivo_id = a.id and h.version = a.revision_aprobada
                    and h.accion in ('archivo-detectado', 'version-reemplazada', 'nueva-version')
                  order by h.id desc limit 1), ''),
       subido_por_id = (select h.usuario_id from public.aprobacion_historial h
                  where h.archivo_id = a.id and h.version = a.revision_aprobada
                    and h.accion in ('archivo-detectado', 'version-reemplazada', 'nueva-version')
                  order by h.id desc limit 1),
       firmas = '[]'::jsonb,
       actualizado = now()
 where a.estado = 'nueva-version'
   and a.version_aprobada_id is not null
   and a.version_id is distinct from a.version_aprobada_id;
