-- Tabla donde la extensión "Validación" guarda la configuración de nomenclatura
-- (una fila por proyecto de Trimble Connect). Ejecútala una sola vez en
-- Supabase → SQL Editor. Es seguro volver a ejecutarla.
create table if not exists public.validacion_config (
  project_id text primary key,
  config     jsonb       not null,
  updated_at timestamptz not null default now()
);

-- RLS activado y sin políticas: solo el servidor (clave de servicio) puede
-- leer o escribir. La clave anónima/pública del navegador no tiene acceso.
alter table public.validacion_config enable row level security;
