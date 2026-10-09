-- Servicio de datos de la herramienta "Manuales": la cuenta técnica de Trimble
-- Connect con la que la app lee la carpeta de manuales de "MANAGER PROJECT",
-- las personas autorizadas a leerlos y la venta en línea de sus licencias
-- (Mercado Pago).
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

-- Venta en línea de licencias (Mercado Pago): si está abierta y los planes
-- a la venta, [{"meses": 1..12, "precio": pesos}] (una sola fila).
create table if not exists public.manuales_venta (
  id              smallint    primary key default 1 check (id = 1),
  habilitada      boolean     not null default false,
  planes          jsonb       not null default '[]'::jsonb,
  actualizado_por text,
  actualizado_en  timestamptz not null default now()
);

-- Compras de licencias: se crean al ir a pagar y se aplican cuando la pasarela
-- (Mercado Pago o Wompi) aprueba el pago (`id` es la referencia del pago).
create table if not exists public.manuales_pagos (
  id             text          primary key,
  email          text          not null check (email = lower(btrim(email))),
  nombre         text          not null default '',
  meses          integer       not null check (meses between 1 and 12),
  monto          numeric(14,2) not null check (monto > 0),
  moneda         text          not null default 'COP',
  estado         text          not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'revisar', 'reembolsada')),
  preferencia_id text,
  pago_id        text          unique,
  estado_mp      text,
  detalle_mp     text,
  creada         timestamptz   not null default now(),
  actualizada    timestamptz   not null default now(),
  pagada         timestamptz,
  vence_anterior date,
  vence_nueva    date,
  nota           text
);
-- La pasarela con la que se pagó (Mercado Pago o Wompi).
alter table public.manuales_pagos add column if not exists pasarela text not null default 'mercadopago' check (pasarela in ('mercadopago', 'wompi'));
-- Pagos registrados a mano por el administrador (pasarela 'manual'): cómo se
-- pagó, su referencia (transferencia, factura...), un soporte y quién lo
-- registró. Las cortesías quedan con valor 0.
alter table public.manuales_pagos add column if not exists medio text;
alter table public.manuales_pagos add column if not exists referencia text;
alter table public.manuales_pagos add column if not exists soporte text;
alter table public.manuales_pagos add column if not exists registrado_por text;
alter table public.manuales_pagos drop constraint if exists manuales_pagos_monto_check;
alter table public.manuales_pagos add constraint manuales_pagos_monto_check check (monto >= 0);
alter table public.manuales_pagos drop constraint if exists manuales_pagos_pasarela_check;
alter table public.manuales_pagos add constraint manuales_pagos_pasarela_check check (pasarela in ('mercadopago', 'wompi', 'manual'));
create index if not exists manuales_pagos_creada on public.manuales_pagos (creada desc);
create index if not exists manuales_pagos_email on public.manuales_pagos (email, creada desc);

-- Aplica un pago a su compra, todo a la vez y una sola vez (los estados vienen
-- en el vocabulario de Mercado Pago, también los de Wompi):
-- aprobado (por el valor de la compra) crea o extiende la licencia de la
-- persona por los meses comprados (desde su vencimiento si sigue vigente, si
-- no desde hoy); reembolsado o contracargado marca la compra para revisión
-- (la licencia no se toca); cualquier otro estado solo se anota.
create or replace function public.manuales_aplicar_pago(
  p_orden text, p_pago_id text, p_estado_mp text, p_detalle_mp text, p_monto numeric, p_moneda text, p_hoy date
)
returns jsonb
language plpgsql
as $$
declare
  o public.manuales_pagos%rowtype;
  a public.manuales_autorizados%rowtype;
  v_existe boolean;
  v_inicio date;
  v_vence date;
begin
  select * into o from public.manuales_pagos where id = p_orden for update;
  if not found then
    return jsonb_build_object('resultado', 'no-existe');
  end if;

  if p_estado_mp in ('refunded', 'charged_back') then
    if o.estado <> 'aprobada' or o.pago_id is distinct from p_pago_id then
      return jsonb_build_object('resultado', 'sin-cambios');
    end if;
    update public.manuales_pagos
       set estado = 'reembolsada', estado_mp = p_estado_mp, detalle_mp = p_detalle_mp, actualizada = now()
     where id = p_orden;
    return jsonb_build_object('resultado', 'reembolsada', 'email', o.email);
  end if;

  if p_estado_mp <> 'approved' then
    if o.estado <> 'pendiente' then
      return jsonb_build_object('resultado', 'sin-cambios');
    end if;
    update public.manuales_pagos
       set estado_mp = p_estado_mp, detalle_mp = p_detalle_mp, actualizada = now()
     where id = p_orden;
    return jsonb_build_object('resultado', 'pendiente', 'email', o.email);
  end if;

  if o.pago_id = p_pago_id then
    return jsonb_build_object('resultado', 'ya-aplicada', 'email', o.email, 'vence', o.vence_nueva);
  end if;
  if o.estado <> 'pendiente' then
    update public.manuales_pagos
       set nota = concat_ws(' ', o.nota, 'Otro pago aprobado (' || p_pago_id || ') para esta compra: revísalo en ' || case o.pasarela when 'wompi' then 'Wompi' else 'Mercado Pago' end || '.'), actualizada = now()
     where id = p_orden;
    return jsonb_build_object('resultado', 'duplicado', 'email', o.email);
  end if;
  if p_monto < o.monto or upper(p_moneda) <> upper(o.moneda) then
    update public.manuales_pagos
       set estado = 'revisar', pago_id = p_pago_id, estado_mp = p_estado_mp, detalle_mp = p_detalle_mp, pagada = now(), actualizada = now(),
           nota = 'Se pagaron ' || p_monto || ' ' || p_moneda || ' y la compra era de ' || o.monto || ' ' || o.moneda || ': no se aplicó la licencia.'
     where id = p_orden;
    return jsonb_build_object('resultado', 'revisar', 'email', o.email);
  end if;

  select * into a from public.manuales_autorizados where email = o.email for update;
  v_existe := found;
  if v_existe and a.vence is null then
    update public.manuales_pagos
       set estado = 'aprobada', pago_id = p_pago_id, estado_mp = p_estado_mp, detalle_mp = p_detalle_mp, pagada = now(), actualizada = now(),
           nota = 'La persona ya tenía acceso sin vencimiento: no se cambió su licencia.'
     where id = p_orden;
    return jsonb_build_object('resultado', 'aplicada', 'email', o.email, 'vence', null);
  end if;

  v_inicio := case when v_existe and a.vence >= p_hoy then a.vence else p_hoy end;
  v_vence := (v_inicio + make_interval(months => o.meses))::date;
  if v_existe then
    update public.manuales_autorizados
       set licencia_meses = o.meses, inicio = v_inicio, vence = v_vence, nombre = case when nombre = '' then o.nombre else nombre end
     where email = o.email;
  else
    insert into public.manuales_autorizados (email, nombre, agregado_por, agregado_en, licencia_meses, inicio, vence, suspendido)
    values (o.email, o.nombre, 'Compra en ' || case o.pasarela when 'wompi' then 'Wompi' else 'Mercado Pago' end, now(), o.meses, v_inicio, v_vence, false);
  end if;
  update public.manuales_pagos
     set estado = 'aprobada', pago_id = p_pago_id, estado_mp = p_estado_mp, detalle_mp = p_detalle_mp, pagada = now(), actualizada = now(),
         vence_anterior = case when v_existe then a.vence end, vence_nueva = v_vence
   where id = p_orden;
  return jsonb_build_object('resultado', 'aplicada', 'email', o.email, 'vence', v_vence);
end;
$$;

-- RLS activado y sin políticas: solo el servidor (clave de servicio) lee y escribe.
alter table public.manuales_cuenta enable row level security;
alter table public.manuales_oauth_estados enable row level security;
alter table public.manuales_autorizados enable row level security;
alter table public.manuales_venta enable row level security;
alter table public.manuales_pagos enable row level security;
revoke all on function public.manuales_tomar_turno(integer) from public;
revoke all on function public.manuales_aplicar_pago(text, text, text, text, numeric, text, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.manuales_tomar_turno(integer) to service_role;
    grant execute on function public.manuales_aplicar_pago(text, text, text, text, numeric, text, date) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
