-- Realidad aumentada con QR: modelos preparados para el celular.
-- Re-ejecutable: se puede correr varias veces en el SQL Editor sin perder datos.
-- RLS activo y sin políticas: solo el servidor (service_role) lee y escribe.

-- Configuración por proyecto: a cuántos días sin uso se elimina el archivo del celular.
create table if not exists public.ra_config (
  project_id text primary key,
  dias_sin_uso integer not null default 30 check (dias_sin_uso between 1 and 365),
  actualizado timestamptz not null default now(),
  actualizado_por text
);

-- Cada modelo preparado. La fila nunca se borra: al vencerse o eliminarse solo
-- se borra el archivo del bucket y la fila queda como "eliminado" (historial).
create table if not exists public.ra_modelos (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  nombre text not null,
  -- [{ fileId, versionId, nombre }]: los IFC de Trimble Connect que se convirtieron.
  archivos jsonb not null default '[]'::jsonb,
  -- { nivelesExcluidos: [], clasesExcluidas: [] }
  filtros jsonb not null default '{}'::jsonb,
  -- subiendo: el navegador está enviando el archivo · listo · eliminado
  estado text not null default 'subiendo' check (estado in ('subiendo', 'listo', 'eliminado')),
  ruta text not null,
  bytes bigint not null default 0,
  triangulos integer not null default 0,
  elementos integer not null default 0,
  -- Origen del modelo en metros (marco de web-ifc, y hacia arriba).
  origen jsonb not null default '[0,0,0]'::jsonb,
  creado timestamptz not null default now(),
  creado_por text,
  creado_por_id text,
  ultimo_uso timestamptz,
  elimina_en timestamptz,
  eliminado timestamptz,
  eliminado_por text,
  -- vencido · manual · subida-incompleta
  motivo_eliminacion text
);

create index if not exists ra_modelos_proyecto on public.ra_modelos (project_id, creado desc);
create index if not exists ra_modelos_vencen on public.ra_modelos (elimina_en) where estado <> 'eliminado';

-- Puntos QR (fase 2): dónde va cada QR en el modelo y hacia dónde apunta su
-- flecha. El código es el que lleva el QR; quien lo tenga abre el modelo sin
-- iniciar sesión mientras no venza ni se anule. Nunca se borran: se anulan.
create table if not exists public.ra_puntos (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  modelo_id uuid not null references public.ra_modelos (id),
  codigo text not null unique check (codigo ~ '^[A-Za-z0-9_-]{22}$'),
  nombre text not null,
  -- Texto para quien pega la hoja en obra: hacia dónde debe apuntar la flecha.
  referencia text not null default '',
  -- Punto en el marco del modelo preparado (metros, y hacia arriba, relativo a su origen).
  punto jsonb not null,
  -- Dirección de la flecha en radianes (desde +z hacia +x del modelo).
  rumbo double precision not null,
  -- Elemento sobre el que se tomó el punto (para mostrarlo).
  elemento text not null default '',
  vence timestamptz not null,
  creado timestamptz not null default now(),
  creado_por text,
  creado_por_id text,
  anulado timestamptz,
  anulado_por text,
  usos integer not null default 0,
  ultimo_uso timestamptz
);

create index if not exists ra_puntos_proyecto on public.ra_puntos (project_id, creado desc);

alter table public.ra_config enable row level security;
alter table public.ra_modelos enable row level security;
alter table public.ra_puntos enable row level security;

grant select, insert, update, delete on public.ra_config to service_role;
grant select, insert, update, delete on public.ra_modelos to service_role;
grant select, insert, update, delete on public.ra_puntos to service_role;

-- Bucket privado para los archivos del celular (sin acceso público: el servidor
-- entrega enlaces firmados que vencen). Solo existe en Supabase.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('ra-modelos', 'ra-modelos', false) on conflict (id) do nothing;
    begin
      update storage.buckets
         set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/octet-stream']
       where id = 'ra-modelos';
    exception when undefined_column then
      null; -- older Storage without per-bucket limits: the server checks them anyway
    end;
  end if;
end;
$$;
