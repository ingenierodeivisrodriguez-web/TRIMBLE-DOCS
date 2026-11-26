-- Servicio de datos de "Inspección 360°": puntos de captura ubicados en el modelo 3D y las
-- fotos 360° de cada punto por fecha. Ejecútalo en Supabase → SQL Editor. Es seguro volver a
-- ejecutarlo: no borra datos.
--
-- Primera etapa (decisión del dueño del 26-11-2026): tablas propias por proyecto de Trimble
-- Connect. La unión con las empresas, licencias, roles y estructura de obra de Control de Obra
-- (decisión D1 del plan) se hace más adelante sin perder estos datos.
--
-- Solo el servidor de la app (clave de servicio) lee y escribe: RLS activado sin políticas.
-- Nada se borra: un punto se desactiva y una captura se anula, siempre con motivo.
-- El archivo oficial de cada foto está en el CDE de Trimble Connect (carpeta "Inspección 360");
-- el bucket "i360-fotos" solo guarda la copia temporal mientras se sube al CDE.

-- ================================================================ bloque 1: puntos y fotos

create table if not exists public.i360_migraciones (
  bloque      integer     primary key,
  descripcion text        not null,
  aplicado    timestamptz not null default now()
);

-- Configuración por proyecto: el código corto del proyecto (MAL) con que empiezan los códigos de
-- los puntos, el nombre de la carpeta raíz en el CDE y quiénes, además de los administradores
-- del proyecto, crean puntos y suben fotos.
create table if not exists public.i360_config (
  project_id       text        primary key check (project_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  codigo_proyecto  text        check (codigo_proyecto ~ '^[A-Z0-9]{2,6}$'),
  carpeta_nombre   text        not null default 'Inspección 360' check (char_length(btrim(carpeta_nombre)) between 1 and 120),
  editores         text[]      not null default '{}',
  version          integer     not null default 1,
  actualizado      timestamptz not null default now(),
  actualizado_por  text
);

-- Un punto fijo donde va el trípode. El código (PROYECTO-TORRE-PISO-UNIDAD-Cnn) nunca se reutiliza.
-- x, y, z: posición del trípode en el visor 3D de Trimble, en metros (marco del visor, con la
-- ubicación del modelo aplicada); z ya incluye la altura del trípode. rumbo_grados: dirección,
-- antihoraria desde el eje X del modelo, que queda en el centro de la foto (null mientras no se
-- calibre).
create table if not exists public.i360_puntos (
  id                 uuid          primary key,
  project_id         text          not null check (project_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  codigo             text          not null check (codigo ~ '^[A-Z0-9]{2,6}-[A-Z0-9]{2,6}-[A-Z0-9]{2,6}-[A-Z0-9]{2,10}-C[0-9]{2}$'),
  torre              text          not null check (torre ~ '^[A-Z0-9]{2,6}$'),
  piso               text          not null check (piso ~ '^[A-Z0-9]{2,6}$'),
  unidad             text          not null check (unidad ~ '^[A-Z0-9]{2,10}$'),
  numero             integer       not null check (numero between 1 and 99),
  espacio            text          not null default '' check (char_length(espacio) <= 120),
  zona               text          not null default '' check (char_length(zona) <= 120),
  referencia_fisica  text          not null default '' check (char_length(referencia_fisica) <= 500),
  model_id           text          not null check (char_length(model_id) between 1 and 64),
  version_id         text,
  x                  numeric(16,4) not null,
  y                  numeric(16,4) not null,
  z                  numeric(16,4) not null,
  altura_m           numeric(4,2)  not null default 1.50 check (altura_m between 0.50 and 2.50),
  rumbo_grados       numeric(6,2)  check (rumbo_grados >= 0 and rumbo_grados < 360),
  estado             text          not null default 'activo' check (estado in ('activo', 'inactivo')),
  motivo             text          not null default '' check (char_length(motivo) <= 1000),
  version            integer       not null default 1,
  creado             timestamptz   not null default now(),
  creado_por         text          not null,
  creado_por_nombre  text          not null default '',
  actualizado        timestamptz   not null default now(),
  actualizado_por    text,
  unique (project_id, codigo),
  unique (project_id, id),
  check (estado = 'activo' or btrim(motivo) <> '')
);
create index if not exists i360_puntos_proyecto on public.i360_puntos (project_id, torre, piso, unidad, numero);

-- Una visita al punto en una fecha: la foto 360 que se tomó allí y lo que anotó el inspector.
create table if not exists public.i360_capturas (
  id                 uuid        primary key,
  project_id         text        not null,
  punto_id           uuid        not null,
  tomada_en          timestamptz not null,
  observaciones      text        not null default '' check (char_length(observaciones) <= 4000),
  estado             text        not null default 'subiendo' check (estado in ('subiendo', 'lista', 'error', 'anulada')),
  motivo             text        not null default '' check (char_length(motivo) <= 1000),
  inspector_id       text        not null,
  inspector_nombre   text        not null default '',
  creado             timestamptz not null default now(),
  actualizado        timestamptz not null default now(),
  actualizado_por    text,
  unique (project_id, id),
  foreign key (project_id, punto_id) references public.i360_puntos (project_id, id),
  check (estado <> 'anulada' or btrim(motivo) <> '')
);
create index if not exists i360_capturas_punto on public.i360_capturas (project_id, punto_id, tomada_en desc);

-- El archivo de una captura. La miniatura (JPEG pequeño en base64) se hace en el navegador al
-- subir, para listar las fechas sin descargar las fotos completas.
create table if not exists public.i360_fotos (
  id               uuid        primary key,
  project_id       text        not null,
  captura_id       uuid        not null,
  tipo             text        not null default '360' check (tipo in ('360', 'convencional')),
  nombre_archivo   text        not null check (char_length(nombre_archivo) between 5 and 200),
  nombre_original  text        not null default '' check (char_length(nombre_original) <= 255),
  tamano           bigint      not null check (tamano > 0 and tamano <= 62914560),
  ancho            integer     check (ancho > 0),
  alto             integer     check (alto > 0),
  miniatura        text        not null default '' check (char_length(miniatura) <= 300000),
  ruta_temporal    text,
  cde_carpeta_id   text,
  cde_file_id      text,
  cde_version_id   text,
  estado           text        not null default 'subiendo' check (estado in ('subiendo', 'en_cde', 'error')),
  error            text        not null default '' check (char_length(error) <= 2000),
  creado           timestamptz not null default now(),
  actualizado      timestamptz not null default now(),
  unique (project_id, id),
  foreign key (project_id, captura_id) references public.i360_capturas (project_id, id),
  check (estado <> 'en_cde' or (cde_file_id is not null and cde_version_id is not null))
);
create index if not exists i360_fotos_captura on public.i360_fotos (project_id, captura_id);

-- ---------------------------------------------------------------- seguridad: solo el servidor

alter table public.i360_migraciones enable row level security;
alter table public.i360_config enable row level security;
alter table public.i360_puntos enable row level security;
alter table public.i360_capturas enable row level security;
alter table public.i360_fotos enable row level security;

revoke all on public.i360_migraciones, public.i360_config, public.i360_puntos, public.i360_capturas, public.i360_fotos from anon, authenticated;
-- Sin "delete" (nada se borra).
grant select, insert, update on public.i360_migraciones, public.i360_config, public.i360_puntos, public.i360_capturas, public.i360_fotos to service_role;

-- Bucket privado para la copia temporal de las fotos mientras se suben al CDE. Solo existe en
-- Supabase: el navegador sube con un enlace firmado de un solo objeto y el servidor la borra
-- cuando la foto ya está en el CDE.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('i360-fotos', 'i360-fotos', false) on conflict (id) do nothing;
    begin
      update storage.buckets
         set public = false, file_size_limit = 62914560, allowed_mime_types = array['image/jpeg']
       where id = 'i360-fotos';
    exception when undefined_column then
      null; -- older Storage without per-bucket limits: the server checks them anyway
    end;
  end if;
end;
$$;

insert into public.i360_migraciones (bloque, descripcion)
values (1, 'Puntos de captura en el modelo y fotos 360 por fecha (tablas propias por proyecto)')
on conflict (bloque) do nothing;
