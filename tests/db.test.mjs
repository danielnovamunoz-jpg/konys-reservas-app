// -----------------------------------------------------------------------------
// Pruebas de la base de datos (reglas de negocio, RPC y seguridad RLS).
// Ejecutar:  cd tests && npm install && npm test
// -----------------------------------------------------------------------------
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, applySchemaAgain, asRole, createUser } from './supabase-shim.mjs';

let db;
let adminId;
let userId;
let hoy;        // fecha actual en Bogotá (YYYY-MM-DD)
let manana;     // mañana en Bogotá
let mesas;      // { 'Mesa 1': {id, capacidad}, ... }

const ANON = { role: 'anon' };
const admin = () => ({ role: 'authenticated', sub: adminId, email: 'admin@konys.test' });
const usuario = () => ({ role: 'authenticated', sub: userId, email: 'cliente@konys.test' });

const rpcCrear = (tx, { mesa, fecha, hora, nombre = 'Ana Pérez', personas = 2, contacto = null }) =>
  tx.query(
    `select public.crear_reserva($1, $2::date, $3::time, $4, $5, $6) as r`,
    [mesas[mesa].id, fecha, hora, nombre, personas, contacto],
  ).then((res) => res.rows[0].r);

/** Espera que la promesa falle y devuelve el error de PostgreSQL. */
async function rechaza(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('Se esperaba un error y la operación fue aceptada');
}

before(async () => {
  db = await createDb();
  adminId = await createUser(db, 'admin@konys.test', { admin: true });
  userId = await createUser(db, 'cliente@konys.test');
  const f = await db.query(`select public.ahora_local()::date::text as hoy, (public.ahora_local()::date + 1)::text as manana`);
  ({ hoy, manana } = f.rows[0]);
  const m = await db.query(`select id, nombre, capacidad from public.mesas`);
  mesas = Object.fromEntries(m.rows.map((r) => [r.nombre, r]));
});

// --- Estructura y datos iniciales ---------------------------------------------
test('schema.sql y seed.sql son idempotentes (se pueden ejecutar dos veces)', async () => {
  await applySchemaAgain(db);
  const { rows } = await db.query(`
    select (select count(*) from public.horarios)::int as horarios,
           (select count(*) from public.platos)::int   as platos,
           (select count(*) from public.mesas)::int    as mesas`);
  assert.deepEqual(rows[0], { horarios: 14, platos: 51, mesas: 11 });
});

test('la zona horaria de Bogotá se resuelve correctamente', async () => {
  const { rows } = await db.query(
    `select extract(epoch from (now() at time zone 'UTC') - public.ahora_local())/3600 as diff`);
  assert.equal(Number(rows[0].diff), 5);
});

test('slots_del_dia genera 2 horarios de almuerzo y 6 de noche (60 min)', async () => {
  const { rows } = await db.query(`select jornada, hora_inicio::text from public.slots_del_dia($1::date)`, [manana]);
  assert.deepEqual(rows.map((r) => r.hora_inicio), [
    '12:30:00', '13:30:00', '17:00:00', '18:00:00', '19:00:00', '20:00:00', '21:00:00', '22:00:00',
  ]);
  assert.equal(rows.filter((r) => r.jornada === 'Almuerzo').length, 2);
});

// --- Creación de reservas (cliente anónimo) -----------------------------------
test('un cliente anónimo crea una reserva válida mediante la RPC', async () => {
  const r = await asRole(db, ANON, (tx) =>
    rpcCrear(tx, { mesa: 'Mesa 3', fecha: manana, hora: '19:00', nombre: '  Juan   Pérez ', personas: 4, contacto: '+57 300 123 4567' }));
  assert.equal(r.estado, 'confirmada');
  assert.equal(r.cliente_nombre, 'Juan Pérez');
  assert.equal(r.mesa_nombre, 'Mesa 3');
  assert.equal(r.mesa_zona, 'salon');
  assert.equal(r.hora_inicio, '19:00:00');
  assert.equal(r.hora_fin, '20:00:00');
  assert.equal(r.jornada, 'Noche');
});

test('REGLA 2: no se puede reservar la misma mesa y horario dos veces', async () => {
  const err = await rechaza(asRole(db, ANON, (tx) =>
    rpcCrear(tx, { mesa: 'Mesa 3', fecha: manana, hora: '19:00', nombre: 'Otra persona' })));
  assert.equal(err.hint, 'HORARIO_OCUPADO');
});

test('REGLA 2: la misma hora en OTRA mesa sí está permitida', async () => {
  const r = await asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 4', fecha: manana, hora: '19:00' }));
  assert.equal(r.mesa_nombre, 'Mesa 4');
});

test('REGLA 2 (carrera): aunque se salte la RPC, la restricción EXCLUDE impide el cruce', async () => {
  // Simula el peor caso: dos inserciones directas que se cruzan 30 minutos.
  await db.query(`insert into public.reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
                  values ($1, 'Carrera A', 2, $2::date, '21:00', '22:00')`, [mesas['Mesa 5'].id, manana]);
  const err = await rechaza(db.query(
    `insert into public.reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
     values ($1, 'Carrera B', 2, $2::date, '21:30', '22:30')`, [mesas['Mesa 5'].id, manana]));
  assert.equal(err.code, '23P01'); // exclusion_violation
});

test('REGLA 3: el número de personas no puede superar la capacidad', async () => {
  const err = await rechaza(asRole(db, ANON, (tx) =>
    rpcCrear(tx, { mesa: 'Mesa 1', fecha: manana, hora: '12:30', personas: 3 })));
  assert.equal(err.hint, 'CAPACIDAD_EXCEDIDA');
  const err2 = await rechaza(asRole(db, ANON, (tx) =>
    rpcCrear(tx, { mesa: 'Mesa 1', fecha: manana, hora: '12:30', personas: 0 })));
  assert.equal(err2.hint, 'PERSONAS_INVALIDAS');
});

test('REGLA 3 (defensa en profundidad): el trigger valida la capacidad en inserciones directas', async () => {
  const err = await rechaza(db.query(
    `insert into public.reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
     values ($1, 'Grupo grande', 9, $2::date, '12:30', '13:30')`, [mesas['Mesa 7'].id, manana]));
  assert.equal(err.hint, 'CAPACIDAD_EXCEDIDA');
});

test('REGLA 1: una mesa inactiva no recibe reservas', async () => {
  await db.query(`update public.mesas set activa = false where nombre = 'Terraza 4'`);
  const err = await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Terraza 4', fecha: manana, hora: '17:00' })));
  assert.equal(err.hint, 'MESA_INACTIVA');
  const slots = await asRole(db, ANON, (tx) =>
    tx.query(`select * from public.slots_mesa($1, $2::date)`, [mesas['Terraza 4'].id, manana]));
  assert.equal(slots.rows.length, 0, 'una mesa inactiva no ofrece horarios');
  await db.query(`update public.mesas set activa = true where nombre = 'Terraza 4'`);
});

test('REGLA 4: no se puede reservar fuera de las jornadas configuradas', async () => {
  for (const hora of ['15:00', '12:45', '23:00', '10:00']) {
    const err = await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: manana, hora })));
    assert.equal(err.hint, 'FUERA_DE_HORARIO', `hora ${hora}`);
  }
});

test('REGLA 4: un día sin jornadas activas no ofrece horarios', async () => {
  const dow = (await db.query(`select extract(dow from $1::date)::int as d`, [manana])).rows[0].d;
  await db.query(`update public.horarios set activo = false where dia_semana = $1`, [dow]);
  const err = await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: manana, hora: '17:00' })));
  assert.equal(err.hint, 'FUERA_DE_HORARIO');
  await db.query(`update public.horarios set activo = true where dia_semana = $1`, [dow]);
});

test('fechas pasadas o demasiado lejanas son rechazadas', async () => {
  const ayer = (await db.query(`select (public.ahora_local()::date - 1)::text as d`)).rows[0].d;
  const lejos = (await db.query(`select (public.ahora_local()::date + 61)::text as d`)).rows[0].d;
  assert.equal((await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: ayer, hora: '17:00' })))).hint, 'FECHA_PASADA');
  assert.equal((await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: lejos, hora: '17:00' })))).hint, 'FECHA_FUERA_DE_RANGO');
});

test('nombre y contacto inválidos son rechazados', async () => {
  assert.equal((await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: manana, hora: '17:00', nombre: ' a ' })))).hint, 'NOMBRE_INVALIDO');
  assert.equal((await rechaza(asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 2', fecha: manana, hora: '17:00', contacto: 'llámame' })))).hint, 'CONTACTO_INVALIDO');
});

test('REGLA 5: slots_mesa marca como ocupado el horario reservado', async () => {
  const { rows } = await asRole(db, ANON, (tx) =>
    tx.query(`select hora_inicio::text, disponible, motivo from public.slots_mesa($1, $2::date)`, [mesas['Mesa 3'].id, manana]));
  const s19 = rows.find((r) => r.hora_inicio === '19:00:00');
  const s20 = rows.find((r) => r.hora_inicio === '20:00:00');
  assert.deepEqual({ disponible: s19.disponible, motivo: s19.motivo }, { disponible: false, motivo: 'ocupado' });
  assert.equal(s20.disponible, true);
});

test('disponibilidad_mesas resume horarios libres por mesa', async () => {
  const { rows } = await asRole(db, ANON, (tx) =>
    tx.query(`select mesa_id, slots_totales, slots_futuros, slots_libres from public.disponibilidad_mesas($1::date)`, [manana]));
  const m3 = rows.find((r) => r.mesa_id === mesas['Mesa 3'].id);
  assert.deepEqual({ t: m3.slots_totales, f: m3.slots_futuros, l: m3.slots_libres }, { t: 8, f: 8, l: 7 });
  assert.equal(rows.length, 11, 'solo mesas activas');
});

// --- Seguridad (RLS y privilegios) ---------------------------------------------
test('SEGURIDAD: el público no puede leer la tabla reservas (datos personales)', async () => {
  const err = await rechaza(asRole(db, ANON, (tx) => tx.query(`select * from public.reservas`)));
  assert.equal(err.code, '42501');
  const err2 = await rechaza(asRole(db, ANON, (tx) => tx.query(`select * from public.v_reservas`)));
  assert.equal(err2.code, '42501');
});

test('SEGURIDAD: el público no puede insertar reservas sin pasar por la RPC', async () => {
  const err = await rechaza(asRole(db, ANON, (tx) => tx.query(
    `insert into public.reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
     values ($1, 'Intruso', 2, $2::date, '12:30', '13:30')`, [mesas['Mesa 2'].id, manana])));
  assert.equal(err.code, '42501');
});

test('SEGURIDAD: el público puede leer mesas, horarios y platos, pero no modificarlos', async () => {
  const n = await asRole(db, ANON, (tx) => tx.query(
    `select (select count(*) from public.mesas)::int m, (select count(*) from public.horarios)::int h, (select count(*) from public.platos)::int p`));
  assert.deepEqual(n.rows[0], { m: 11, h: 14, p: 51 });
  for (const sql of [
    `update public.mesas set capacidad = 20`,
    `delete from public.platos`,
    `insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin) values (1, 'Hack', '01:00', '02:00')`,
  ]) {
    const err = await rechaza(asRole(db, ANON, (tx) => tx.query(sql)));
    assert.equal(err.code, '42501', sql);
  }
});

test('SEGURIDAD: el público no puede ejecutar funciones administrativas', async () => {
  const err = await rechaza(asRole(db, ANON, (tx) => tx.query(`select public.resumen_dashboard()`)));
  assert.equal(err.code, '42501');
});

test('SEGURIDAD: un usuario autenticado que NO es administrador no obtiene permisos', async () => {
  const r = await asRole(db, usuario(), (tx) => tx.query(`select count(*)::int as n from public.reservas`));
  assert.equal(r.rows[0].n, 0, 'RLS oculta todas las reservas');
  const upd = await asRole(db, usuario(), (tx) => tx.query(`update public.mesas set capacidad = 20 returning id`));
  assert.equal(upd.rows.length, 0, 'RLS impide modificar mesas');
  const err = await rechaza(asRole(db, usuario(), (tx) => tx.query(
    `insert into public.platos (nombre, categoria, precio) values ('Hack', 'pizzas', 1)`)));
  assert.equal(err.code, '42501');
  const err2 = await rechaza(asRole(db, usuario(), (tx) => tx.query(`select public.resumen_dashboard()`)));
  assert.equal(err2.code, '42501');
  const err3 = await rechaza(asRole(db, usuario(), (tx) => tx.query(
    `insert into storage.objects (bucket_id, name) values ('konys-media', 'x.png')`)));
  assert.equal(err3.code, '42501');
});

// --- Administración ------------------------------------------------------------
test('ADMIN: consulta reservas con datos de la mesa (vista v_reservas)', async () => {
  const { rows } = await asRole(db, admin(), (tx) =>
    tx.query(`select cliente_nombre, mesa_nombre, mesa_zona from public.v_reservas where fecha = $1::date order by hora_inicio, mesa_nombre`, [manana]));
  assert.ok(rows.some((r) => r.cliente_nombre === 'Juan Pérez' && r.mesa_nombre === 'Mesa 3'));
});

test('REGLA 6: cancelar una reserva libera el horario', async () => {
  const id = (await db.query(`select id from public.reservas where cliente_nombre = 'Juan Pérez'`)).rows[0].id;
  await asRole(db, admin(), (tx) => tx.query(`update public.reservas set estado = 'cancelada' where id = $1`, [id]));
  const { rows } = await asRole(db, ANON, (tx) =>
    tx.query(`select disponible from public.slots_mesa($1, $2::date) where hora_inicio = '19:00'`, [mesas['Mesa 3'].id, manana]));
  assert.equal(rows[0].disponible, true);
  const nueva = await asRole(db, ANON, (tx) => rpcCrear(tx, { mesa: 'Mesa 3', fecha: manana, hora: '19:00', nombre: 'Laura Díaz' }));
  assert.equal(nueva.estado, 'confirmada');
  // Reabrir la reserva cancelada ya no es posible: el horario está tomado.
  const err = await rechaza(asRole(db, admin(), (tx) => tx.query(`update public.reservas set estado = 'confirmada' where id = $1`, [id])));
  assert.equal(err.code, '23P01');
});

test('ADMIN: marca una reserva como completada', async () => {
  const r = await asRole(db, admin(), (tx) => tx.query(
    `update public.reservas set estado = 'completada' where cliente_nombre = 'Laura Díaz' returning estado, actualizado_en > creado_en as tocado`));
  assert.equal(r.rows[0].estado, 'completada');
});

test('REGLA 7: nadie puede eliminar reservas (historial permanente)', async () => {
  const err = await rechaza(asRole(db, admin(), (tx) => tx.query(`delete from public.reservas`)));
  assert.equal(err.code, '42501');
});

test('ADMIN: CRUD de mesas; una mesa con historial no se puede borrar', async () => {
  const nueva = await asRole(db, admin(), (tx) => tx.query(
    `insert into public.mesas (nombre, zona, capacidad) values ('Barra 1', 'salon', 2) returning id`));
  const id = nueva.rows[0].id;
  const dup = await rechaza(asRole(db, admin(), (tx) => tx.query(
    `insert into public.mesas (nombre, zona, capacidad) values (' barra 1 ', 'terraza', 2)`)));
  assert.equal(dup.code, '23505', 'nombre duplicado');
  await asRole(db, admin(), (tx) => tx.query(`update public.mesas set zona = 'terraza', capacidad = 3 where id = $1`, [id]));
  const del = await asRole(db, admin(), (tx) => tx.query(`delete from public.mesas where id = $1 returning id`, [id]));
  assert.equal(del.rows.length, 1);
  const err = await rechaza(asRole(db, admin(), (tx) => tx.query(`delete from public.mesas where nombre = 'Mesa 3'`)));
  assert.ok(['23001', '23503'].includes(err.code), 'llave foránea (RESTRICT) protege el historial');
  const errZona = await rechaza(asRole(db, admin(), (tx) => tx.query(
    `insert into public.mesas (nombre, zona, capacidad) values ('Patio', 'patio', 2)`)));
  assert.equal(errZona.code, '23514');
});

test('ADMIN: los horarios activos del mismo día no pueden solaparse', async () => {
  const err = await rechaza(asRole(db, admin(), (tx) => tx.query(
    `insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin, duracion_slot)
     values (1, 'Tarde', '14:00', '18:00', 60)`)));
  assert.equal(err.code, '23P01');
  // Inactivo sí se permite (no afecta la disponibilidad)
  await asRole(db, admin(), (tx) => tx.query(
    `insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin, duracion_slot, activo)
     values (1, 'Tarde', '14:00', '18:00', 60, false)`));
  const errDur = await rechaza(asRole(db, admin(), (tx) => tx.query(
    `insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin, duracion_slot) values (2, 'Brunch', '08:00', '08:30', 60)`)));
  assert.equal(errDur.code, '23514', 'la duración debe caber en la jornada');
});

test('ADMIN: CRUD de platos', async () => {
  const p = await asRole(db, admin(), (tx) => tx.query(
    `insert into public.platos (nombre, categoria, descripcion, precio) values ('Prueba', 'postres', 'x', 5000) returning id`));
  const id = p.rows[0].id;
  await asRole(db, admin(), (tx) => tx.query(`update public.platos set precio = 6000, disponible = false where id = $1`, [id]));
  const visto = await asRole(db, ANON, (tx) => tx.query(`select precio, disponible from public.platos where id = $1`, [id]));
  assert.deepEqual(visto.rows[0], { precio: 6000, disponible: false });
  await asRole(db, admin(), (tx) => tx.query(`delete from public.platos where id = $1`, [id]));
  const err = await rechaza(asRole(db, admin(), (tx) => tx.query(
    `insert into public.platos (nombre, categoria, precio) values ('Sushi', 'japonesa', 1)`)));
  assert.equal(err.code, '23514');
});

test('ADMIN: resumen_dashboard devuelve indicadores reales', async () => {
  const { rows } = await asRole(db, admin(), (tx) => tx.query(`select public.resumen_dashboard() as r`));
  const r = rows[0].r;
  const real = (await db.query(`select count(*)::int as n from public.reservas`)).rows[0].n;
  assert.equal(r.total_reservas, real);
  assert.equal(r.mesas_registradas, 11);
  assert.equal(r.mesas_activas, 11);
  assert.equal(r.fecha_hoy, hoy);
  assert.ok(r.reservas_confirmadas >= 2);
  assert.equal(r.reservas_canceladas, 1);
  assert.equal(r.reservas_completadas, 1);
});

test('ADMIN: puede subir archivos al bucket konys-media; otros buckets no', async () => {
  await asRole(db, admin(), (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('konys-media', 'mesas/a.webp')`));
  const b = await db.query(`select public, file_size_limit from storage.buckets where id = 'konys-media'`);
  assert.deepEqual(b.rows[0], { public: true, file_size_limit: 5242880 });
});
