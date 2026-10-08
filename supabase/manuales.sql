-- Servicio de datos de la herramienta "Manuales": la cuenta técnica de Trimble
-- Connect con la que la app lee la carpeta de manuales de "MANAGER PROJECT", y
-- las personas autorizadas a leerlos.
-- Ejecútalo en Supabase → SQL Editor. Es seguro volver a ejecutarlo: no borra datos.

-- La cuenta técnica (una sola fila). Los tokens van cifrados por el servidor.
create table if not exists public.manuales_cuenta (
  id              smallint    primary key default 1 check (id = 1),
  refresh_cifrado text        not null,
  access_cifrado  text,
  access_expira   timestamptz,
  cuenta_id       text,
  cuenta_nombre   text        not null default '',
  cuenta_email    text        not null default '',
  conectada_por   text,
  conectada_en    timestamptz not null default now(),
  renovada_en     timestamptz not null default now(),
  -- Quién está renovando la sesión ahora (los refresh tokens son de un solo uso).
  turno_hasta     timestamptz
);

-- Inicios de conexión pendientes (OAuth): duran 10 minutos.
create table if not exists public.manuales_oauth_estados (
  state        text        primary key,
  verifier     text        not null,
  redirect_uri text        not null,
  creado_por   text,
  expira       timestamptz not null
);

-- Personas autorizadas a leer los manuales, por su correo de Trimble.
create table if not exists public.manuales_autorizados (
  email        text        primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  nombre       text        not null default '',
  agregado_por text,
  agregado_en  timestamptz not null default now()
);

-- Licencia de cada persona: de `inicio` por `licencia_meses` (1 a 12) hasta `vence`
-- (último día con acceso; null = sin vencimiento), y si está suspendida.
alter table public.manuales_autorizados add column if not exists licencia_meses integer check (licencia_meses between 1 and 12);
alter table public.manuales_autorizados add column if not exists inicio date;
alter table public.manuales_autorizados add column if not exists vence date;
alter table public.manuales_autorizados add column if not exists suspendido boolean not null default false;

-- Toma el turno para renovar la sesión de la cuenta técnica (true si lo obtuvo).
create or replace function public.manuales_tomar_turno(p_segundos integer)
returns boolean
language sql
as $$
  with tomado as (
    update public.manuales_cuenta
       set turno_hasta = now() + make_interval(secs => p_segundos)
     where id = 1 and (turno_hasta is null or turno_hasta < now())
    returning 1
  )
  select exists (select 1 from tomado);
$$;

-- RLS activado y sin políticas: solo el servidor (clave de servicio) lee y escribe.
alter table public.manuales_cuenta enable row level security;
alter table public.manuales_oauth_estados enable row level security;
alter table public.manuales_autorizados enable row level security;
revoke all on function public.manuales_tomar_turno(integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.manuales_tomar_turno(integer) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
