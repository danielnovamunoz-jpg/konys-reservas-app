// -----------------------------------------------------------------------------
// Panel administrativo (/admin)
//   · Autenticación real con Supabase Auth + verificación en la tabla
//     administradores (un usuario cualquiera no obtiene acceso).
//   · Enrutador por hash: #/dashboard, #/mesas, #/horarios, #/reservas…
//   · Cambios en vivo con Realtime y, como respaldo, recarga periódica.
// -----------------------------------------------------------------------------
import { supabaseConfigurado, realtimeHabilitado } from './supabase.js';
import {
  iniciarSesion, cerrarSesion, sesionActual, alCambiarSesion, perfilAdministrador, escucharCambios, reservasDelDia,
} from './api.js';
import { $, $$, esc, icono, hoyISO, fechaMedia, hora12, debounce } from './utils.js';
import { notificar, conCarga } from './ui.js';
import * as dashboard from './admin/dashboard.js';
import * as mesas from './admin/mesas.js';
import * as horarios from './admin/horarios.js';
import * as reservas from './admin/reservas.js';
import * as carta from './admin/carta.js';
import * as perfil from './admin/perfil.js';

const VISTAS = { dashboard, mesas, horarios, reservas, carta, perfil };
const estado = { usuario: null, perfil: null, vista: null, limpiar: null, desuscribir: null, temporizador: null };

configurarLogin();
configurarEstructura();
arrancar();

async function arrancar() {
  if (!supabaseConfigurado) {
    mostrarLogin();
    $('#login-aviso').innerHTML = `
      <div class="config-alert" role="alert">${icono('alert')}
        <div><strong>Falta conectar Supabase.</strong> Copia <code>js/env.example.js</code> como <code>js/env.js</code> con la URL y la clave pública de tu proyecto (ver README).</div>
      </div>`;
    $$('#login-form input, #login-form button').forEach((el) => { el.disabled = true; });
    return;
  }
  try {
    const sesion = await sesionActual();
    if (sesion) await entrar(sesion.user);
    else mostrarLogin();
  } catch (err) {
    mostrarLogin();
    $('#login-error').textContent = err.message;
  }
  alCambiarSesion((evento) => {
    if (evento === 'SIGNED_OUT' && estado.usuario) salirInterfaz();
  });
}

// =============================================================================
// ACCESO
// =============================================================================
function configurarLogin() {
  const form = $('#login-form');
  const pass = $('#login-password');
  const ver = $('#login-ver');
  ver.addEventListener('click', () => {
    const mostrar = pass.type === 'password';
    pass.type = mostrar ? 'text' : 'password';
    ver.setAttribute('aria-pressed', String(mostrar));
    ver.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    ver.innerHTML = icono(mostrar ? 'eye-off' : 'eye');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('#login-error');
    error.textContent = '';
    const email = $('#login-email').value.trim();
    const password = pass.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      error.textContent = 'Escribe un correo electrónico válido.';
      $('#login-email').focus();
      return;
    }
    if (!password) {
      error.textContent = 'Escribe tu contraseña.';
      pass.focus();
      return;
    }
    try {
      await conCarga($('#login-submit'), async () => {
        const sesion = await iniciarSesion(email, password);
        const ok = await entrar(sesion.user);
        if (ok) {
          pass.value = '';
          notificar(`Bienvenido, ${estado.perfil.nombre || 'administrador'}.`);
        }
      }, 'Ingresando…');
    } catch (err) {
      error.textContent = err.message;
    }
  });
}

/** Verifica que el usuario sea administrador y muestra el panel. */
async function entrar(usuario) {
  const registro = await perfilAdministrador(usuario.id);
  if (!registro) {
    await cerrarSesion();
    mostrarLogin();
    $('#login-error').textContent = 'Esta cuenta no tiene permisos de administrador.';
    return false;
  }
  estado.usuario = usuario;
  estado.perfil = registro;
  mostrarPanel();
  return true;
}

function mostrarLogin() {
  $('#vista-carga').hidden = true;
  $('#vista-app').hidden = true;
  $('#vista-login').hidden = false;
  document.title = 'Panel de administración · Konys Pizza';
  setTimeout(() => $('#login-email').focus(), 50);
}

function mostrarPanel() {
  $('#vista-carga').hidden = true;
  $('#vista-login').hidden = true;
  $('#vista-app').hidden = false;
  const nombre = estado.perfil.nombre || estado.usuario.email.split('@')[0];
  $('#usuario-nombre').textContent = nombre;
  $('#usuario-email').textContent = estado.usuario.email;
  $('#usuario-avatar').textContent = nombre.charAt(0).toUpperCase();
  navegar();
  iniciarActualizaciones();
}

async function salir() {
  try {
    await cerrarSesion();
  } finally {
    salirInterfaz();
    notificar('Sesión cerrada correctamente.', 'info');
  }
}

function salirInterfaz() {
  estado.limpiar?.();
  estado.desuscribir?.();
  clearInterval(estado.temporizador);
  Object.assign(estado, { usuario: null, perfil: null, vista: null, limpiar: null, desuscribir: null });
  $('#contenido').innerHTML = '';
  mostrarLogin();
}

// =============================================================================
// ESTRUCTURA Y NAVEGACIÓN
// =============================================================================
function configurarEstructura() {
  const app = $('#vista-app');
  const boton = $('#btn-menu');
  const fondo = $('#sidebar-backdrop');
  const abrir = (abierto) => {
    app.classList.toggle('menu-open', abierto);
    fondo.hidden = !abierto;
    boton.setAttribute('aria-expanded', String(abierto));
  };
  boton.addEventListener('click', () => abrir(!app.classList.contains('menu-open')));
  fondo.addEventListener('click', () => abrir(false));
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('.sidebar__link')) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
  $('#btn-salir').addEventListener('click', salir);
  window.addEventListener('hashchange', () => { if (estado.usuario) navegar(); });
}

function rutaActual() {
  const ruta = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return VISTAS[ruta] ? ruta : 'dashboard';
}

async function navegar() {
  const ruta = rutaActual();
  if (location.hash !== `#/${ruta}`) history.replaceState(null, '', `#/${ruta}`);
  const vista = VISTAS[ruta];
  estado.limpiar?.();
  estado.limpiar = null;
  estado.vista = vista;

  $$('.sidebar__link').forEach((a) => {
    if (a.dataset.ruta === ruta) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#titulo-vista').textContent = vista.titulo;
  $('#subtitulo-vista').textContent = vista.subtitulo ?? '';
  $('#acciones-vista').innerHTML = '';
  document.title = `${vista.titulo} · Panel Konys`;

  const contenedor = $('#contenido');
  contenedor.innerHTML = '';
  contenedor.classList.remove('vista-enter');
  void contenedor.offsetWidth; // reinicia la animación de entrada
  contenedor.classList.add('vista-enter');

  try {
    const limpiar = await vista.render(contenedor, {
      acciones: $('#acciones-vista'),
      subtitulo: (texto) => { $('#subtitulo-vista').textContent = texto; },
      usuario: estado.usuario,
      perfil: estado.perfil,
      salir,
    });
    if (estado.vista === vista) estado.limpiar = typeof limpiar === 'function' ? limpiar : null;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = `<div class="alert alert--error">${icono('alert')}<span>${esc(err.message)}</span></div>`;
  }
}

// =============================================================================
// ACTUALIZACIONES EN VIVO
// =============================================================================
function iniciarActualizaciones() {
  const pendientes = new Set();
  const aplicar = debounce(() => {
    const tablas = [...pendientes];
    pendientes.clear();
    tablas.forEach((t) => estado.vista?.alCambiar?.(t));
    if (tablas.includes('reservas')) actualizarContadorHoy();
  }, 400);

  estado.desuscribir?.();
  estado.desuscribir = escucharCambios(['reservas', 'mesas', 'horarios', 'platos'], (tabla, payload) => {
    if (tabla === 'reservas' && payload.eventType === 'INSERT') {
      const r = payload.new;
      notificar(`Nueva reserva: ${r.cliente_nombre} · ${fechaMedia(r.fecha)}, ${hora12(r.hora_inicio)}`, 'info', { duracion: 7000 });
    }
    pendientes.add(tabla);
    aplicar();
  }, 'konys-admin');

  // Respaldo: si Realtime no está disponible, se recargan las reservas cada minuto.
  clearInterval(estado.temporizador);
  estado.temporizador = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!realtimeHabilitado) estado.vista?.alCambiar?.('reservas');
    actualizarContadorHoy();
  }, 60_000);
  actualizarContadorHoy();
}

async function actualizarContadorHoy() {
  try {
    const hoy = await reservasDelDia(hoyISO());
    const n = hoy.filter((r) => r.estado === 'confirmada').length;
    const el = $('#contador-hoy');
    el.hidden = n === 0;
    el.textContent = String(n);
    el.title = `${n} reservas confirmadas para hoy`;
  } catch {
    /* silencioso */
  }
}
