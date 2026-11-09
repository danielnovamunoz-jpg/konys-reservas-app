// -----------------------------------------------------------------------------
// Capa de acceso a datos. TODAS las consultas a Supabase pasan por aquí, así
// las vistas no conocen detalles de la API y los errores llegan traducidos.
// -----------------------------------------------------------------------------
import { requerirSupabase, supabase, realtimeHabilitado } from './supabase.js';
import { BUCKET_MEDIA } from './config.js';

// ---------- Errores ----------
const MENSAJES_POR_CODIGO = {
  '23P01': 'Ese horario se cruza con otra reserva o jornada existente.',
  '23505': 'Ya existe un registro con ese nombre.',
  '23503': 'No se puede eliminar porque tiene reservas asociadas en su historial.',
  '23001': 'No se puede eliminar porque tiene reservas asociadas en su historial.',
  '23514': 'Alguno de los datos no es válido. Revisa el formulario.',
  '22P02': 'Alguno de los datos tiene un formato no válido.',
  '42501': 'No tienes permisos para realizar esta acción.',
  PGRST116: 'No se encontró el registro solicitado.',
  PGRST301: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

export class ErrorApi extends Error {
  constructor(mensaje, { codigo = null, motivo = null, original = null } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = codigo; // código de PostgreSQL / PostgREST
    this.motivo = motivo; // HINT de nuestras funciones (p. ej. HORARIO_OCUPADO)
    this.original = original;
  }
}

function traducir(error) {
  if (!error) return null;
  if (error instanceof ErrorApi) return error;
  const codigo = error.code ?? null;
  // Excepciones propias (RAISE … USING hint = 'CODIGO') ya traen mensaje en español.
  if (codigo === 'P0001') {
    return new ErrorApi(error.message, { codigo, motivo: error.hint, original: error });
  }
  if (MENSAJES_POR_CODIGO[codigo]) {
    return new ErrorApi(MENSAJES_POR_CODIGO[codigo], { codigo, original: error });
  }
  const texto = String(error.message || '');
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(texto)) {
    return new ErrorApi('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.', { codigo: 'RED', original: error });
  }
  if (/Invalid login credentials/i.test(texto)) {
    return new ErrorApi('Correo o contraseña incorrectos.', { codigo: 'CREDENCIALES', original: error });
  }
  return new ErrorApi(texto || 'Ocurrió un error inesperado. Intenta de nuevo.', { codigo, original: error });
}

/** Ejecuta una consulta de supabase-js y devuelve `data` o lanza ErrorApi. */
async function ejecutar(promesa) {
  let respuesta;
  try {
    respuesta = await promesa;
  } catch (err) {
    throw traducir(err);
  }
  if (respuesta.error) throw traducir(respuesta.error);
  return respuesta;
}
const datos = async (promesa) => (await ejecutar(promesa)).data;

// =============================================================================
// PÚBLICO
// =============================================================================
export const obtenerMesas = () =>
  datos(requerirSupabase().from('mesas').select('id,nombre,zona,capacidad,activa,foto_url').order('nombre'));

export const obtenerHorarios = () =>
  datos(requerirSupabase().from('horarios').select('*').order('dia_semana').order('hora_inicio'));

export const obtenerPlatos = () =>
  datos(requerirSupabase().from('platos').select('*').order('categoria').order('orden').order('nombre'));

/** Resumen de horarios libres por mesa en una fecha. */
export const obtenerDisponibilidad = (fecha) =>
  datos(requerirSupabase().rpc('disponibilidad_mesas', { p_fecha: fecha }));

/** Horarios de una mesa en una fecha con su estado (libre / ocupado / pasado). */
export const obtenerSlotsMesa = (mesaId, fecha) =>
  datos(requerirSupabase().rpc('slots_mesa', { p_mesa_id: mesaId, p_fecha: fecha }));

/** Registra la reserva de forma atómica en la base de datos. */
export const crearReserva = ({ mesaId, fecha, horaInicio, nombre, personas, contacto }) =>
  datos(requerirSupabase().rpc('crear_reserva', {
    p_mesa_id: mesaId,
    p_fecha: fecha,
    p_hora_inicio: horaInicio,
    p_cliente_nombre: nombre,
    p_num_personas: personas,
    p_cliente_contacto: contacto || null,
  }));

// =============================================================================
// AUTENTICACIÓN (Supabase Auth)
// =============================================================================
export async function iniciarSesion(email, password) {
  const { data } = await ejecutar(requerirSupabase().auth.signInWithPassword({ email, password }));
  return data.session;
}

export async function cerrarSesion() {
  await requerirSupabase().auth.signOut();
}

export async function sesionActual() {
  const { data } = await ejecutar(requerirSupabase().auth.getSession());
  return data.session;
}

export const alCambiarSesion = (cb) => requerirSupabase().auth.onAuthStateChange((evento, sesion) => cb(evento, sesion));

export async function cambiarContrasena(password) {
  await ejecutar(requerirSupabase().auth.updateUser({ password }));
}

/** Devuelve el registro de administrador del usuario autenticado, o null. */
export async function perfilAdministrador(userId) {
  const filas = await datos(requerirSupabase().from('administradores').select('user_id,nombre,creado_en').eq('user_id', userId));
  return filas[0] ?? null;
}

// =============================================================================
// ADMINISTRACIÓN
// =============================================================================
export const resumenDashboard = () => datos(requerirSupabase().rpc('resumen_dashboard'));

// ---------- Mesas ----------
export const obtenerMesasAdmin = () =>
  datos(requerirSupabase().from('mesas').select('*').order('nombre'));

export function guardarMesa(mesa) {
  const { id, ...campos } = mesa;
  const tabla = requerirSupabase().from('mesas');
  return datos(id
    ? tabla.update(campos).eq('id', id).select().single()
    : tabla.insert(campos).select().single());
}

export const eliminarMesa = (id) => datos(requerirSupabase().from('mesas').delete().eq('id', id));

/** Reservas confirmadas futuras de una mesa (para advertir antes de desactivarla). */
export async function contarReservasFuturas(mesaId, desde) {
  const { count } = await ejecutar(
    requerirSupabase().from('reservas').select('id', { count: 'exact', head: true })
      .eq('mesa_id', mesaId).eq('estado', 'confirmada').gte('fecha', desde));
  return count ?? 0;
}

// ---------- Horarios ----------
export const actualizarHorario = (id, campos) =>
  datos(requerirSupabase().from('horarios').update(campos).eq('id', id).select().single());

/** Inserta una o varias jornadas (una por día seleccionado) en una sola operación. */
export const crearHorarios = (filas) => datos(requerirSupabase().from('horarios').insert(filas).select());
export const eliminarHorario = (id) => datos(requerirSupabase().from('horarios').delete().eq('id', id));

// ---------- Reservas ----------
/**
 * Lista paginada de reservas con filtros.
 * filtros: { fecha, desde, hasta, mesaId, estado, orden: 'asc'|'desc' }
 */
export async function obtenerReservas({ fecha, desde, hasta, mesaId, estado, orden = 'asc', pagina = 1, porPagina = 10 } = {}) {
  let q = requerirSupabase().from('v_reservas').select('*', { count: 'exact' });
  if (fecha) q = q.eq('fecha', fecha);
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);
  if (mesaId) q = q.eq('mesa_id', mesaId);
  if (estado) q = q.eq('estado', estado);
  const asc = orden !== 'desc';
  q = q.order('fecha', { ascending: asc }).order('hora_inicio', { ascending: asc }).order('mesa_nombre');
  const inicio = (pagina - 1) * porPagina;
  q = q.range(inicio, inicio + porPagina - 1);
  const { data, count } = await ejecutar(q);
  return { filas: data, total: count ?? data.length };
}

export const reservasRecientes = (limite = 6) =>
  datos(requerirSupabase().from('v_reservas').select('*').order('creado_en', { ascending: false }).limit(limite));

export const reservasDelDia = (fecha) =>
  datos(requerirSupabase().from('v_reservas').select('*').eq('fecha', fecha).neq('estado', 'cancelada').order('hora_inicio').order('mesa_nombre'));

export const cambiarEstadoReserva = (id, estado) =>
  datos(requerirSupabase().from('reservas').update({ estado }).eq('id', id).select().single());

// ---------- Carta ----------
export function guardarPlato(plato) {
  const { id, ...campos } = plato;
  const tabla = requerirSupabase().from('platos');
  return datos(id
    ? tabla.update(campos).eq('id', id).select().single()
    : tabla.insert(campos).select().single());
}
export const eliminarPlato = (id) => datos(requerirSupabase().from('platos').delete().eq('id', id));

// ---------- Fotografías (Supabase Storage) ----------
/**
 * Sube una imagen al bucket público y devuelve su URL.
 * La imagen se reduce y convierte a WebP en el navegador antes de subirla.
 */
export async function subirFoto(archivo, carpeta) {
  const { blob, tipo, extension } = await optimizarImagen(archivo);
  const ruta = `${carpeta}/${crypto.randomUUID()}.${extension}`;
  const storage = requerirSupabase().storage.from(BUCKET_MEDIA);
  await ejecutar(storage.upload(ruta, await blob.arrayBuffer(), { contentType: tipo, upsert: false, cacheControl: '31536000' }));
  return storage.getPublicUrl(ruta).data.publicUrl;
}

/** Elimina una foto del bucket si la URL pertenece a él (ignora assets locales). */
export async function eliminarFoto(url) {
  if (!url) return;
  const marca = `/storage/v1/object/public/${BUCKET_MEDIA}/`;
  const i = url.indexOf(marca);
  if (i === -1) return;
  const ruta = decodeURIComponent(url.slice(i + marca.length));
  try {
    await requerirSupabase().storage.from(BUCKET_MEDIA).remove([ruta]);
  } catch {
    /* Si falla, la foto queda huérfana pero no afecta al usuario. */
  }
}

async function optimizarImagen(archivo, maximo = 1400) {
  const tiposValidos = ['image/jpeg', 'image/png', 'image/webp'];
  if (!tiposValidos.includes(archivo.type)) {
    throw new ErrorApi('Formato no permitido. Usa una imagen JPG, PNG o WebP.');
  }
  if (archivo.size > 15 * 1024 * 1024) {
    throw new ErrorApi('La imagen es demasiado grande (máximo 15 MB).');
  }
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, maximo / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', 0.82));
    if (blob && blob.type === 'image/webp' && blob.size <= 5 * 1024 * 1024) {
      return { blob, tipo: 'image/webp', extension: 'webp' };
    }
  } catch {
    /* Navegador sin soporte: se sube el original. */
  }
  if (archivo.size > 5 * 1024 * 1024) throw new ErrorApi('La imagen supera 5 MB. Reduce su tamaño e intenta de nuevo.');
  const extension = archivo.type.split('/')[1].replace('jpeg', 'jpg');
  return { blob: archivo, tipo: archivo.type, extension };
}

// =============================================================================
// TIEMPO REAL
// =============================================================================
/**
 * Escucha cambios en tablas y llama a `alCambiar(tabla, payload)`.
 * Devuelve una función para cancelar la suscripción. Si Realtime no está
 * habilitado, no hace nada (la app sigue funcionando con recargas periódicas).
 */
export function escucharCambios(tablas, alCambiar, nombreCanal = 'konys-cambios') {
  if (!realtimeHabilitado || !supabase) return () => {};
  let canal = supabase.channel(`${nombreCanal}-${Math.random().toString(36).slice(2, 8)}`);
  for (const tabla of tablas) {
    canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, (payload) => alCambiar(tabla, payload));
  }
  canal.subscribe();
  return () => supabase.removeChannel(canal);
}
