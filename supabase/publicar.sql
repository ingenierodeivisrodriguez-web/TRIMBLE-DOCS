-- Publicar entre proyectos: carpetas de recepción, publicaciones, archivos
-- seguidos y actividad. Los archivos nunca se guardan aquí: viven en Trimble
-- Connect; aquí solo queda qué se publicó, adónde y qué versión se copió.
-- Re-ejecutable: se puede correr varias veces en el SQL Editor sin perder datos.
-- RLS activo y sin políticas: solo el servidor (service_role) lee y escribe.

-- La carpeta donde llega lo que un proyecto origen publica en este proyecto
-- (destino). La define un administrador del destino; una por proyecto origen.
-- No se borra: se desactiva.
create table if not exists public.publicar_recepciones (
  id uuid primary key default gen_random_uuid(),
  destino_proyecto text not null,
  origen_proyecto text not null,
  origen_nombre text not null default '',
  carpeta_id text not null,
  carpeta_ruta text not null default '',
  activa boolean not null default true,
  actualizado timestamptz not null default now(),
  actualizado_por text,
  actualizado_por_id text,
  unique (destino_proyecto, origen_proyecto)
);

-- Un documento o una carpeta del origen publicado en un destino. No se borra:
-- se detiene (deja de actualizarse) o queda retirada (ya no está en el origen).
create table if not exists public.publicar_publicaciones (
  id uuid primary key default gen_random_uuid(),
  origen_proyecto text not null,
  origen_nombre text not null default '',
  destino_proyecto text not null,
  destino_nombre text not null default '',
  tipo text not null check (tipo in ('archivo', 'carpeta')),
  -- Id del archivo o de la carpeta en el origen.
  item_id text not null,
  nombre text not null,
  ruta text not null default '',
  estado text not null default 'activa' check (estado in ('activa', 'detenida', 'retirada')),
  -- Dónde quedó en el destino (se fija con la primera copia).
  destino_carpeta_id text,
  destino_carpeta_ruta text not null default '',
  nota text not null default '',
  publicado timestamptz not null default now(),
  publicado_por text,
  publicado_por_id text,
  revisado timestamptz,
  unique (origen_proyecto, destino_proyecto, item_id)
);

create index if not exists publicar_publicaciones_origen on public.publicar_publicaciones (origen_proyecto);
create index if not exists publicar_publicaciones_destino on public.publicar_publicaciones (destino_proyecto);

-- Cada archivo que sigue una publicación (uno si se publicó un archivo; los de
-- la carpeta y sus subcarpetas si se publicó una carpeta) y la última versión
-- copiada. "en_curso_hasta" evita que dos personas copien el mismo archivo a
-- la vez; "copiando_*" guarda qué versión del origen va en la subida abierta.
create table if not exists public.publicar_archivos (
  id uuid primary key default gen_random_uuid(),
  publicacion_id uuid not null references public.publicar_publicaciones (id),
  origen_file_id text not null,
  nombre text not null,
  -- Subcarpeta dentro de la carpeta publicada ("Estructura/Detalles"); vacía en la raíz.
  subcarpeta text not null default '',
  origen_version_id text,
  origen_revision integer,
  destino_file_id text,
  destino_version_id text,
  destino_revision integer,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'al-dia', 'diferencia', 'retirado', 'error')),
  mensaje text not null default '',
  en_curso_hasta timestamptz,
  copiando_upload_id text,
  copiando_version_id text,
  copiando_revision integer,
  -- La versión que se vio en el destino cuando resultó distinta (para reemplazar solo esa).
  diferencia_version_id text,
  actualizado timestamptz not null default now(),
  unique (publicacion_id, origen_file_id)
);

create index if not exists publicar_archivos_publicacion on public.publicar_archivos (publicacion_id);

-- Actividad: solo se agregan filas, nunca se cambian ni se borran.
create table if not exists public.publicar_actividad (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  origen_proyecto text not null,
  destino_proyecto text not null,
  origen_nombre text not null default '',
  destino_nombre text not null default '',
  publicacion_id uuid,
  -- recepcion · recepcion-desactivada · publicar · copiar · actualizar ·
  -- diferencia · reemplazar · retirado · detener · reanudar · error
  accion text not null,
  usuario text,
  usuario_id text,
  nombre text not null default '',
  version_origen integer,
  version_destino integer,
  nota text not null default '',
  resultado text not null default 'ok' check (resultado in ('ok', 'aviso', 'error'))
);

create index if not exists publicar_actividad_origen on public.publicar_actividad (origen_proyecto, creado desc);
create index if not exists publicar_actividad_destino on public.publicar_actividad (destino_proyecto, creado desc);

alter table public.publicar_recepciones enable row level security;
alter table public.publicar_publicaciones enable row level security;
alter table public.publicar_archivos enable row level security;
alter table public.publicar_actividad enable row level security;

revoke all on public.publicar_recepciones from anon, authenticated;
revoke all on public.publicar_publicaciones from anon, authenticated;
revoke all on public.publicar_archivos from anon, authenticated;
revoke all on public.publicar_actividad from anon, authenticated;

-- Sin "delete": las definiciones se desactivan y la actividad no se toca.
revoke delete, truncate on table public.publicar_recepciones from public, anon, authenticated, service_role;
revoke delete, truncate on table public.publicar_publicaciones from public, anon, authenticated, service_role;
revoke delete, truncate on table public.publicar_archivos from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.publicar_actividad from public, anon, authenticated, service_role;
grant select, insert, update on public.publicar_recepciones to service_role;
grant select, insert, update on public.publicar_publicaciones to service_role;
grant select, insert, update on public.publicar_archivos to service_role;
grant select, insert on public.publicar_actividad to service_role;
