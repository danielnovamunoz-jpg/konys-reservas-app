-- =============================================================================
--  KONYS PIZZA · Sistema de reservas de mesas
--  Esquema de base de datos para Supabase (PostgreSQL 15+)
--
--  Cómo usarlo:
--    Supabase Dashboard → SQL Editor → New query → pegar TODO este archivo → Run.
--    Después ejecutar supabase/seed.sql (horarios y carta inicial).
--
--  El script es idempotente: puede ejecutarse de nuevo sin duplicar objetos.
--
--  Contenido:
--    1. Extensiones y tipos
--    2. Tablas: mesas, horarios, reservas, platos, administradores
--    3. Funciones auxiliares (zona horaria, rol administrador, slots)
--    4. Triggers de integridad
--    5. Funciones RPC públicas (disponibilidad y creación atómica de reservas)
--    6. Funciones RPC administrativas (dashboard)
--    7. Vista administrativa de reservas
--    8. Row Level Security (RLS) y privilegios
--    9. Storage (fotografías) y Realtime
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. EXTENSIONES Y TIPOS
-- -----------------------------------------------------------------------------
create schema if not exists extensions;

-- btree_gist permite combinar "=" (uuid / smallint) con "&&" (rangos) dentro de
-- una restricción EXCLUDE. Es la base de la protección contra reservas dobles.
create extension if not exists btree_gist with schema extensions;

-- Rango de horas del día (ej. [12:30, 14:30)). Se usa para impedir que dos
-- jornadas activas del mismo día se solapen.
do $$
begin
  create type public.rango_hora as range (subtype = time);
exception
  when duplicate_object then null;
end $$;


-- -----------------------------------------------------------------------------
-- 2. TABLAS
-- -----------------------------------------------------------------------------

-- Mesas del restaurante --------------------------------------------------------
create table if not exists public.mesas (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null,
  zona        text        not null,
  capacidad   smallint    not null,
  activa      boolean     not null default true,
  foto_url    text,
  creado_en   timestamptz not null default now(),

  constraint mesas_nombre_chk    check (char_length(btrim(nombre)) between 1 and 40),
  constraint mesas_zona_chk      check (zona in ('salon', 'terraza')),
  constraint mesas_capacidad_chk check (capacidad between 1 and 30),
  constraint mesas_foto_chk      check (foto_url is null or char_length(foto_url) <= 500)
);

-- Dos mesas no pueden llamarse igual (sin distinguir mayúsculas ni espacios).
create unique index if not exists mesas_nombre_unq on public.mesas (lower(btrim(nombre)));

comment on table  public.mesas          is 'Mesas registradas por el administrador.';
comment on column public.mesas.zona     is 'salon | terraza';
comment on column public.mesas.activa   is 'Una mesa inactiva no puede recibir reservas.';


-- Horarios de atención ---------------------------------------------------------
-- Cada fila es una jornada (Almuerzo, Noche…) de un día de la semana.
-- Los horarios reservables (slots) se generan desde hora_inicio, en bloques de
-- duracion_slot minutos, sin exceder hora_fin.
create table if not exists public.horarios (
  id            uuid        primary key default gen_random_uuid(),
  dia_semana    smallint    not null,
  jornada       text        not null,
  hora_inicio   time        not null,
  hora_fin      time        not null,
  duracion_slot smallint    not null default 60,
  activo        boolean     not null default true,
  creado_en     timestamptz not null default now(),

  constraint horarios_dia_chk      check (dia_semana between 0 and 6),   -- 0 = domingo … 6 = sábado
  constraint horarios_jornada_chk  check (char_length(btrim(jornada)) between 2 and 30),
  constraint horarios_rango_chk    check (hora_fin > hora_inicio),
  constraint horarios_duracion_chk check (duracion_slot between 15 and 240),
  constraint horarios_cabe_chk     check (extract(epoch from (hora_fin - hora_inicio)) / 60 >= duracion_slot),

  -- Dos jornadas ACTIVAS del mismo día no pueden solaparse.
  constraint horarios_sin_solape exclude using gist (
    dia_semana with =,
    public.rango_hora(hora_inicio, hora_fin) with &&
  ) where (activo)
);

comment on table  public.horarios               is 'Jornadas de atención por día de la semana.';
comment on column public.horarios.dia_semana    is '0 = domingo, 1 = lunes … 6 = sábado (igual que extract(dow)).';
comment on column public.horarios.duracion_slot is 'Duración de cada reserva, en minutos.';


-- Reservas ---------------------------------------------------------------------
create table if not exists public.reservas (
  id               uuid        primary key default gen_random_uuid(),
  mesa_id          uuid        not null references public.mesas (id) on update cascade on delete restrict,
  cliente_nombre   text        not null,
  cliente_contacto text,
  num_personas     smallint    not null,
  fecha            date        not null,
  hora_inicio      time        not null,
  hora_fin         time        not null,
  estado           text        not null default 'confirmada',
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint reservas_nombre_chk   check (char_length(btrim(cliente_nombre)) between 2 and 80),
  constraint reservas_contacto_chk check (cliente_contacto is null or cliente_contacto ~ '^\+?[0-9 ()-]{7,20}$'),
  constraint reservas_personas_chk check (num_personas between 1 and 30),
  constraint reservas_horas_chk    check (hora_fin > hora_inicio),
  constraint reservas_estado_chk   check (estado in ('confirmada', 'cancelada', 'completada')),

  -- REGLA DE NEGOCIO 2 y 6: una mesa no puede tener dos reservas que se crucen
  -- en el tiempo. Las canceladas no cuentan, por eso liberan el horario.
  -- Al ser una restricción de la base de datos, es imposible saltársela, incluso
  -- con dos clientes confirmando exactamente al mismo tiempo.
  constraint reservas_sin_solape exclude using gist (
    mesa_id with =,
    tsrange(fecha + hora_inicio, fecha + hora_fin, '[)') with &&
  ) where (estado <> 'cancelada')
);

create index if not exists reservas_fecha_idx  on public.reservas (fecha, hora_inicio);
create index if not exists reservas_mesa_idx   on public.reservas (mesa_id, fecha);
create index if not exists reservas_estado_idx on public.reservas (estado);

comment on table  public.reservas        is 'Reservas de mesa. Se conservan permanentemente (no se eliminan).';
comment on column public.reservas.estado is 'confirmada | cancelada | completada';


-- Platos (carta digital) -------------------------------------------------------
create table if not exists public.platos (
  id             uuid        primary key default gen_random_uuid(),
  nombre         text        not null,
  categoria      text        not null,
  subcategoria   text,
  descripcion    text,
  precio         integer     not null,
  disponible     boolean     not null default true,
  foto_url       text,
  orden          smallint    not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint platos_nombre_chk       check (char_length(btrim(nombre)) between 2 and 80),
  constraint platos_categoria_chk    check (categoria in ('pizzas', 'entradas', 'postres', 'bebidas')),
  constraint platos_subcategoria_chk check (subcategoria is null or char_length(subcategoria) <= 40),
  constraint platos_descripcion_chk  check (descripcion is null or char_length(descripcion) <= 600),
  constraint platos_precio_chk       check (precio between 0 and 5000000),
  constraint platos_foto_chk         check (foto_url is null or char_length(foto_url) <= 500)
);

create index if not exists platos_categoria_idx on public.platos (categoria, orden);

comment on table  public.platos        is 'Productos de la carta. Solo informativa (sin pedidos).';
comment on column public.platos.precio is 'Precio en pesos colombianos (COP), sin decimales.';


-- Administradores --------------------------------------------------------------
-- Solo los usuarios de Supabase Auth registrados aquí pueden administrar.
-- Así, aunque alguien lograra crear una cuenta, no obtendría permisos.
create table if not exists public.administradores (
  user_id   uuid        primary key references auth.users (id) on delete cascade,
  nombre    text,
  creado_en timestamptz not null default now()
);

comment on table public.administradores is 'Usuarios de Supabase Auth con acceso al panel /admin.';


-- -----------------------------------------------------------------------------
-- 3. FUNCIONES AUXILIARES
-- -----------------------------------------------------------------------------

-- Fecha y hora actuales en Bucaramanga (Colombia, UTC-5).
create or replace function public.ahora_local()
returns timestamp
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'America/Bogota');
$$;

-- Máximo de días de anticipación con que se puede reservar.
create or replace function public.dias_max_anticipacion()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 60;
$$;

-- ¿El usuario autenticado es administrador?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.administradores a where a.user_id = auth.uid()
  );
$$;

-- Horarios reservables (slots) de una fecha, según las jornadas activas.
create or replace function public.slots_del_dia(p_fecha date)
returns table (horario_id uuid, jornada text, hora_inicio time, hora_fin time)
language sql
stable
set search_path = ''
as $$
  select h.id,
         h.jornada,
         s::time,
         (s + pg_catalog.make_interval(mins => h.duracion_slot))::time
  from public.horarios h
  cross join lateral pg_catalog.generate_series(
         p_fecha + h.hora_inicio,
         p_fecha + h.hora_fin - pg_catalog.make_interval(mins => h.duracion_slot),
         pg_catalog.make_interval(mins => h.duracion_slot)
       ) as s
  where h.activo
    and h.dia_semana = extract(dow from p_fecha)::int
  order by 3;
$$;


-- -----------------------------------------------------------------------------
-- 4. TRIGGERS DE INTEGRIDAD
-- -----------------------------------------------------------------------------

-- Mantiene actualizado_en al día.
create or replace function public.tg_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists reservas_actualizado_en on public.reservas;
create trigger reservas_actualizado_en
  before update on public.reservas
  for each row execute function public.tg_actualizado_en();

drop trigger if exists platos_actualizado_en on public.platos;
create trigger platos_actualizado_en
  before update on public.platos
  for each row execute function public.tg_actualizado_en();

-- Reglas 1 y 3 como defensa en profundidad: se aplican a CUALQUIER escritura en
-- reservas (no solo a la función crear_reserva).
create or replace function public.tg_validar_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mesa public.mesas%rowtype;
  v_reactivada boolean := tg_op = 'UPDATE' and old.estado = 'cancelada' and new.estado <> 'cancelada';
  v_cambio_mesa boolean := tg_op = 'UPDATE' and new.mesa_id is distinct from old.mesa_id;
begin
  if new.estado = 'cancelada' then
    return new;
  end if;

  select * into v_mesa from public.mesas m where m.id = new.mesa_id;
  if not found then
    raise exception 'La mesa indicada no existe.'
      using errcode = 'P0001', hint = 'MESA_NO_EXISTE';
  end if;

  if (tg_op = 'INSERT' or v_cambio_mesa or v_reactivada) and not v_mesa.activa then
    raise exception 'La mesa "%" está inactiva y no puede recibir reservas.', v_mesa.nombre
      using errcode = 'P0001', hint = 'MESA_INACTIVA';
  end if;

  if (tg_op = 'INSERT' or v_cambio_mesa or v_reactivada or new.num_personas <> old.num_personas)
     and new.num_personas > v_mesa.capacidad then
    raise exception 'La mesa "%" admite máximo % personas.', v_mesa.nombre, v_mesa.capacidad
      using errcode = 'P0001', hint = 'CAPACIDAD_EXCEDIDA';
  end if;

  return new;
end;
$$;

drop trigger if exists reservas_validar on public.reservas;
create trigger reservas_validar
  before insert or update on public.reservas
  for each row execute function public.tg_validar_reserva();


-- -----------------------------------------------------------------------------
-- 5. RPC PÚBLICAS
--    Se ejecutan con SECURITY DEFINER para consultar la tabla reservas sin
--    exponer datos personales: solo devuelven disponibilidad.
-- -----------------------------------------------------------------------------

-- Resumen de disponibilidad de todas las mesas activas para una fecha.
--   slots_totales: horarios del día según las jornadas activas
--   slots_futuros: los que aún no han pasado
--   slots_libres:  futuros y sin reserva
-- (se elimina antes de crearla para poder cambiar sus columnas en el futuro)
drop function if exists public.disponibilidad_mesas(date);
create function public.disponibilidad_mesas(p_fecha date)
returns table (mesa_id uuid, slots_totales integer, slots_futuros integer, slots_libres integer)
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (
    select s.hora_inicio, s.hora_fin from public.slots_del_dia(p_fecha) s
  )
  select m.id,
         count(s.hora_inicio)::int,
         (count(s.hora_inicio) filter (where (p_fecha + s.hora_inicio) > public.ahora_local()))::int,
         (count(s.hora_inicio) filter (
            where (p_fecha + s.hora_inicio) > public.ahora_local()
              and not exists (
                select 1 from public.reservas r
                where r.mesa_id = m.id
                  and r.estado <> 'cancelada'
                  and r.fecha = p_fecha
                  and r.hora_inicio < s.hora_fin
                  and r.hora_fin > s.hora_inicio
              )
         ))::int
  from public.mesas m
  left join slots s on true
  where m.activa
  group by m.id;
$$;

-- Horarios de una mesa en una fecha, indicando cuáles están libres.
--   motivo: null (libre) | 'ocupado' | 'pasado'
create or replace function public.slots_mesa(p_mesa_id uuid, p_fecha date)
returns table (jornada text, hora_inicio time, hora_fin time, disponible boolean, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select s.jornada,
           s.hora_inicio,
           s.hora_fin,
           (p_fecha + s.hora_inicio) <= public.ahora_local() as pasado,
           exists (
             select 1 from public.reservas r
             where r.mesa_id = p_mesa_id
               and r.estado <> 'cancelada'
               and r.fecha = p_fecha
               and r.hora_inicio < s.hora_fin
               and r.hora_fin > s.hora_inicio
           ) as ocupado
    from public.slots_del_dia(p_fecha) s
    where exists (select 1 from public.mesas m where m.id = p_mesa_id and m.activa)
  )
  select b.jornada,
         b.hora_inicio,
         b.hora_fin,
         not (b.pasado or b.ocupado),
         case when b.pasado then 'pasado' when b.ocupado then 'ocupado' end
  from base b
  order by b.hora_inicio;
$$;

-- Crea una reserva de forma ATÓMICA (regla 11).
--   1. Bloquea la fila de la mesa (SELECT … FOR UPDATE): dos clientes que
--      reservan la misma mesa a la vez quedan en fila, uno después del otro.
--   2. Valida mesa activa, capacidad, datos, fecha y horario de atención.
--   3. Verifica de nuevo que el horario siga libre.
--   4. Inserta. Si aun así hubiera un cruce, la restricción EXCLUDE lo rechaza.
-- Devuelve los datos para la pantalla de confirmación (JSON).
create or replace function public.crear_reserva(
  p_mesa_id          uuid,
  p_fecha            date,
  p_hora_inicio      time,
  p_cliente_nombre   text,
  p_num_personas     integer,
  p_cliente_contacto text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mesa     public.mesas%rowtype;
  v_reserva  public.reservas%rowtype;
  v_hora_fin time;
  v_jornada  text;
  v_ahora    timestamp := public.ahora_local();
  v_hoy      date      := public.ahora_local()::date;
  v_nombre   text      := btrim(regexp_replace(coalesce(p_cliente_nombre, ''), '\s+', ' ', 'g'));
  v_contacto text      := nullif(btrim(regexp_replace(coalesce(p_cliente_contacto, ''), '\s+', ' ', 'g')), '');
begin
  -- 1. Mesa (con bloqueo de fila)
  select * into v_mesa from public.mesas m where m.id = p_mesa_id for update;
  if not found then
    raise exception 'La mesa seleccionada no existe.'
      using errcode = 'P0001', hint = 'MESA_NO_EXISTE';
  end if;
  if not v_mesa.activa then
    raise exception 'La mesa "%" no está disponible para reservas.', v_mesa.nombre
      using errcode = 'P0001', hint = 'MESA_INACTIVA';
  end if;

  -- 2. Datos del cliente
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then
    raise exception 'Escribe un nombre válido (entre 2 y 80 caracteres).'
      using errcode = 'P0001', hint = 'NOMBRE_INVALIDO';
  end if;
  if p_num_personas is null or p_num_personas < 1 then
    raise exception 'Indica cuántas personas asistirán.'
      using errcode = 'P0001', hint = 'PERSONAS_INVALIDAS';
  end if;
  if p_num_personas > v_mesa.capacidad then
    raise exception 'La mesa "%" admite máximo % personas.', v_mesa.nombre, v_mesa.capacidad
      using errcode = 'P0001', hint = 'CAPACIDAD_EXCEDIDA';
  end if;
  if v_contacto is not null and v_contacto !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception 'El número de contacto no es válido.'
      using errcode = 'P0001', hint = 'CONTACTO_INVALIDO';
  end if;

  -- 3. Fecha
  if p_fecha is null or p_fecha < v_hoy then
    raise exception 'La fecha seleccionada ya pasó.'
      using errcode = 'P0001', hint = 'FECHA_PASADA';
  end if;
  if p_fecha > v_hoy + public.dias_max_anticipacion() then
    raise exception 'Solo se puede reservar con máximo % días de anticipación.', public.dias_max_anticipacion()
      using errcode = 'P0001', hint = 'FECHA_FUERA_DE_RANGO';
  end if;

  -- 4. Horario dentro de las jornadas configuradas (regla 4)
  select s.hora_fin, s.jornada into v_hora_fin, v_jornada
  from public.slots_del_dia(p_fecha) s
  where s.hora_inicio = p_hora_inicio
  limit 1;
  if not found then
    raise exception 'El horario seleccionado está fuera de las jornadas de atención.'
      using errcode = 'P0001', hint = 'FUERA_DE_HORARIO';
  end if;
  if (p_fecha + p_hora_inicio) <= v_ahora then
    raise exception 'El horario seleccionado ya pasó.'
      using errcode = 'P0001', hint = 'HORARIO_PASADO';
  end if;

  -- 5. Re-verificación de disponibilidad justo antes de confirmar (regla 11)
  if exists (
    select 1 from public.reservas r
    where r.mesa_id = p_mesa_id
      and r.estado <> 'cancelada'
      and r.fecha = p_fecha
      and r.hora_inicio < v_hora_fin
      and r.hora_fin > p_hora_inicio
  ) then
    raise exception 'Lo sentimos, ese horario acaba de ser reservado. Elige otro.'
      using errcode = 'P0001', hint = 'HORARIO_OCUPADO';
  end if;

  -- 6. Registro
  begin
    insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas,
                                 fecha, hora_inicio, hora_fin, estado)
    values (p_mesa_id, v_nombre, v_contacto, p_num_personas,
            p_fecha, p_hora_inicio, v_hora_fin, 'confirmada')
    returning * into v_reserva;
  exception
    when exclusion_violation then
      raise exception 'Lo sentimos, ese horario acaba de ser reservado. Elige otro.'
        using errcode = 'P0001', hint = 'HORARIO_OCUPADO';
  end;

  return jsonb_build_object(
    'id',               v_reserva.id,
    'cliente_nombre',   v_reserva.cliente_nombre,
    'cliente_contacto', v_reserva.cliente_contacto,
    'num_personas',     v_reserva.num_personas,
    'fecha',            v_reserva.fecha,
    'hora_inicio',      v_reserva.hora_inicio,
    'hora_fin',         v_reserva.hora_fin,
    'estado',           v_reserva.estado,
    'creado_en',        v_reserva.creado_en,
    'jornada',          v_jornada,
    'mesa_nombre',      v_mesa.nombre,
    'mesa_zona',        v_mesa.zona,
    'mesa_capacidad',   v_mesa.capacidad
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. RPC ADMINISTRATIVAS
-- -----------------------------------------------------------------------------

-- Indicadores del dashboard, calculados con datos reales.
create or replace function public.resumen_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoy date := public.ahora_local()::date;
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'fecha_hoy',            v_hoy,
    'total_reservas',       (select count(*) from public.reservas),
    'reservas_hoy',         (select count(*) from public.reservas r where r.fecha = v_hoy and r.estado <> 'cancelada'),
    'personas_hoy',         (select coalesce(sum(r.num_personas), 0) from public.reservas r where r.fecha = v_hoy and r.estado <> 'cancelada'),
    'reservas_confirmadas', (select count(*) from public.reservas r where r.estado = 'confirmada'),
    'confirmadas_proximas', (select count(*) from public.reservas r where r.estado = 'confirmada' and (r.fecha + r.hora_inicio) >= public.ahora_local()),
    'reservas_canceladas',  (select count(*) from public.reservas r where r.estado = 'cancelada'),
    'reservas_completadas', (select count(*) from public.reservas r where r.estado = 'completada'),
    'mesas_registradas',    (select count(*) from public.mesas),
    'mesas_activas',        (select count(*) from public.mesas m where m.activa),
    'mesas_disponibles',    (select count(*) from public.disponibilidad_mesas(v_hoy) d where d.slots_libres > 0),
    'platos_registrados',   (select count(*) from public.platos),
    'platos_disponibles',   (select count(*) from public.platos p where p.disponible)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 7. VISTA ADMINISTRATIVA DE RESERVAS
--    security_invoker = true → respeta el RLS de reservas (solo administradores).
-- -----------------------------------------------------------------------------
create or replace view public.v_reservas
with (security_invoker = true) as
select r.id,
       r.mesa_id,
       m.nombre    as mesa_nombre,
       m.zona      as mesa_zona,
       m.capacidad as mesa_capacidad,
       r.cliente_nombre,
       r.cliente_contacto,
       r.num_personas,
       r.fecha,
       r.hora_inicio,
       r.hora_fin,
       r.estado,
       r.creado_en,
       r.actualizado_en
from public.reservas r
join public.mesas m on m.id = r.mesa_id;


-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY Y PRIVILEGIOS
-- -----------------------------------------------------------------------------
alter table public.mesas           enable row level security;
alter table public.horarios        enable row level security;
alter table public.reservas        enable row level security;
alter table public.platos          enable row level security;
alter table public.administradores enable row level security;

-- MESAS: lectura pública; escritura solo administradores. Una mesa con
-- reservas en su historial NO puede borrarse (la llave foránea lo impide con
-- ON DELETE RESTRICT); en ese caso se desactiva.
drop policy if exists mesas_lectura_publica on public.mesas;
drop policy if exists mesas_admin_insertar  on public.mesas;
drop policy if exists mesas_admin_editar    on public.mesas;
drop policy if exists mesas_admin_eliminar  on public.mesas;
create policy mesas_lectura_publica on public.mesas for select to anon, authenticated using (true);
create policy mesas_admin_insertar  on public.mesas for insert to authenticated with check (public.es_admin());
create policy mesas_admin_editar    on public.mesas for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy mesas_admin_eliminar  on public.mesas for delete to authenticated using (public.es_admin());

-- HORARIOS: lectura pública; escritura solo administradores.
drop policy if exists horarios_lectura_publica on public.horarios;
drop policy if exists horarios_admin_insertar  on public.horarios;
drop policy if exists horarios_admin_editar    on public.horarios;
drop policy if exists horarios_admin_eliminar  on public.horarios;
create policy horarios_lectura_publica on public.horarios for select to anon, authenticated using (true);
create policy horarios_admin_insertar  on public.horarios for insert to authenticated with check (public.es_admin());
create policy horarios_admin_editar    on public.horarios for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy horarios_admin_eliminar  on public.horarios for delete to authenticated using (public.es_admin());

-- RESERVAS: el público NO puede leer ni escribir la tabla directamente.
-- Solo crea reservas mediante la función crear_reserva(). Los administradores
-- consultan y cambian estados. Nadie elimina reservas (historial permanente).
drop policy if exists reservas_admin_leer   on public.reservas;
drop policy if exists reservas_admin_editar on public.reservas;
create policy reservas_admin_leer   on public.reservas for select to authenticated using (public.es_admin());
create policy reservas_admin_editar on public.reservas for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- PLATOS: lectura pública; escritura solo administradores.
drop policy if exists platos_lectura_publica on public.platos;
drop policy if exists platos_admin_insertar  on public.platos;
drop policy if exists platos_admin_editar    on public.platos;
drop policy if exists platos_admin_eliminar  on public.platos;
create policy platos_lectura_publica on public.platos for select to anon, authenticated using (true);
create policy platos_admin_insertar  on public.platos for insert to authenticated with check (public.es_admin());
create policy platos_admin_editar    on public.platos for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy platos_admin_eliminar  on public.platos for delete to authenticated using (public.es_admin());

-- ADMINISTRADORES: cada usuario solo puede ver su propia fila. Se gestionan
-- únicamente desde el SQL Editor (ver README).
drop policy if exists administradores_leer_propio on public.administradores;
create policy administradores_leer_propio on public.administradores for select to authenticated using (user_id = auth.uid());

-- Privilegios explícitos (defensa en profundidad sobre los permisos por defecto).
revoke all on public.mesas, public.horarios, public.reservas, public.platos, public.administradores, public.v_reservas from anon;
revoke all on public.mesas, public.horarios, public.reservas, public.platos, public.administradores, public.v_reservas from authenticated;

grant select                 on public.mesas, public.horarios, public.platos to anon;
grant select, insert, update, delete on public.mesas   to authenticated;
grant select, insert, update, delete on public.horarios to authenticated;
grant select, insert, update, delete on public.platos   to authenticated;
grant select, update         on public.reservas        to authenticated;
grant select                 on public.v_reservas      to authenticated;
grant select                 on public.administradores to authenticated;

-- Funciones: por defecto PostgreSQL permite ejecutarlas a todos (PUBLIC).
revoke all on function public.ahora_local()                    from public;
revoke all on function public.dias_max_anticipacion()          from public;
revoke all on function public.es_admin()                       from public;
revoke all on function public.slots_del_dia(date)              from public;
revoke all on function public.disponibilidad_mesas(date)       from public;
revoke all on function public.slots_mesa(uuid, date)           from public;
revoke all on function public.crear_reserva(uuid, date, time, text, integer, text) from public;
revoke all on function public.resumen_dashboard()              from public;
revoke all on function public.tg_actualizado_en()              from public;
revoke all on function public.tg_validar_reserva()             from public;

grant execute on function public.ahora_local()              to anon, authenticated;
grant execute on function public.dias_max_anticipacion()    to anon, authenticated;
grant execute on function public.slots_del_dia(date)        to anon, authenticated;
grant execute on function public.disponibilidad_mesas(date) to anon, authenticated;
grant execute on function public.slots_mesa(uuid, date)     to anon, authenticated;
grant execute on function public.crear_reserva(uuid, date, time, text, integer, text) to anon, authenticated;
grant execute on function public.es_admin()                 to authenticated;
grant execute on function public.resumen_dashboard()        to authenticated;

-- En Supabase, los roles anon/authenticated reciben permisos por defecto sobre
-- funciones nuevas; los revocamos de forma explícita donde no corresponden.
revoke execute on function public.es_admin()           from anon;
revoke execute on function public.resumen_dashboard()  from anon;
revoke execute on function public.tg_actualizado_en()  from anon, authenticated;
revoke execute on function public.tg_validar_reserva() from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. STORAGE (fotografías de mesas y platos) Y REALTIME
-- -----------------------------------------------------------------------------
-- Bucket público de solo lectura: cualquiera ve las fotos por URL, pero solo
-- los administradores pueden subir, reemplazar o borrar archivos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('konys-media', 'konys-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists konys_media_admin_leer     on storage.objects;
drop policy if exists konys_media_admin_subir    on storage.objects;
drop policy if exists konys_media_admin_editar   on storage.objects;
drop policy if exists konys_media_admin_eliminar on storage.objects;
create policy konys_media_admin_leer     on storage.objects for select to authenticated
  using (bucket_id = 'konys-media' and public.es_admin());
create policy konys_media_admin_subir    on storage.objects for insert to authenticated
  with check (bucket_id = 'konys-media' and public.es_admin());
create policy konys_media_admin_editar   on storage.objects for update to authenticated
  using (bucket_id = 'konys-media' and public.es_admin())
  with check (bucket_id = 'konys-media' and public.es_admin());
create policy konys_media_admin_eliminar on storage.objects for delete to authenticated
  using (bucket_id = 'konys-media' and public.es_admin());

-- Realtime: la carta, las mesas y los horarios se actualizan en vivo en la
-- página pública; las reservas nuevas aparecen en vivo en el panel (RLS aplica).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['mesas', 'horarios', 'platos', 'reservas'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception
        when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
