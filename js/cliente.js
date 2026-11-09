// -----------------------------------------------------------------------------
// Página pública: orquesta el encabezado, la navegación, los horarios de
// atención (desde Supabase) y los módulos de reservas y carta.
// -----------------------------------------------------------------------------
import { supabaseConfigurado } from './supabase.js';
import { obtenerHorarios, escucharCambios } from './api.js';
import { DIAS_SEMANA } from './config.js';
import { $, $$, esc, icono, hoyISO, diaSemana, ahoraHHMM, aMinutos, hora12, rangoHoras, debounce, sinMovimiento } from './utils.js';
import { iniciarReservas, actualizarHorarios, refrescarReservas } from './reservas.js';
import { iniciarCarta, refrescarCarta } from './carta.js';

document.documentElement.classList.add('js');

let horarios = [];

iniciarEncabezado();
iniciarNavegacionActiva();
iniciarRevelado();
$('#anio').textContent = String(new Date().getFullYear());

if (!supabaseConfigurado) {
  mostrarAvisoConfiguracion();
} else {
  iniciarDatos();
}

async function iniciarDatos() {
  try {
    horarios = await obtenerHorarios();
    pintarHorarios();
  } catch (err) {
    console.error(err);
    $('#horarios-lista').innerHTML = `<p class="muted">No pudimos cargar los horarios. ${esc(err.message)}</p>`;
  }
  iniciarReservas({ horarios });
  iniciarCarta();

  // Cambios administrativos en vivo (regla 8).
  const pendientes = new Set();
  const aplicar = debounce(async () => {
    const tablas = new Set(pendientes);
    pendientes.clear();
    if (tablas.has('horarios')) {
      try {
        horarios = await obtenerHorarios();
        pintarHorarios();
        actualizarHorarios(horarios);
      } catch (err) { console.error(err); }
    }
    if (tablas.has('mesas') || tablas.has('horarios')) refrescarReservas();
    if (tablas.has('platos')) refrescarCarta();
  }, 500);
  escucharCambios(['horarios', 'mesas', 'platos'], (tabla) => {
    pendientes.add(tabla);
    aplicar();
  }, 'konys-publico');

  // Estado "abierto/cerrado" se recalcula cada minuto.
  setInterval(pintarEstadoHero, 60_000);
}

// =============================================================================
// ENCABEZADO Y NAVEGACIÓN
// =============================================================================
function iniciarEncabezado() {
  const header = $('#site-header');
  const toggle = $('#nav-toggle');
  const nav = $('#site-nav');

  const alDesplazar = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  alDesplazar();
  window.addEventListener('scroll', alDesplazar, { passive: true });

  const abrir = (abierto) => {
    header.classList.toggle('nav-open', abierto);
    toggle.setAttribute('aria-expanded', String(abierto));
    toggle.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  };
  toggle.addEventListener('click', () => abrir(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
  window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) abrir(false); });
}

function iniciarNavegacionActiva() {
  const enlaces = $$('.site-nav__link');
  const porId = new Map(enlaces.map((a) => [a.getAttribute('href').slice(1), a]));
  const secciones = [...porId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const visibles = new Map();
  const obs = new IntersectionObserver((entradas) => {
    for (const e of entradas) visibles.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    let activo = null;
    let mejor = 0;
    for (const [id, r] of visibles) if (r > mejor) { mejor = r; activo = id; }
    enlaces.forEach((a) => a.removeAttribute('aria-current'));
    if (activo && porId.has(activo)) porId.get(activo).setAttribute('aria-current', 'true');
  }, { threshold: [0, 0.15, 0.35, 0.6], rootMargin: '-64px 0px -35% 0px' });
  secciones.forEach((s) => obs.observe(s));
}

function iniciarRevelado() {
  const elementos = $$('.reveal');
  if (sinMovimiento() || !('IntersectionObserver' in window)) {
    elementos.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  // Escalonado suave entre hermanos
  elementos.forEach((el) => {
    const hermanos = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--reveal-delay', `${Math.min(hermanos.indexOf(el), 6) * 70}ms`);
  });
  const obs = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        obs.unobserve(e.target);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  elementos.forEach((el) => obs.observe(el));
}

// =============================================================================
// HORARIOS DE ATENCIÓN (desde la tabla horarios)
// =============================================================================
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // lunes primero

/** Rangos activos por día: { 0: [{inicio, fin, jornada}], … } */
function rangosPorDia() {
  const mapa = Object.fromEntries(ORDEN_DIAS.map((d) => [d, []]));
  for (const h of horarios) {
    if (h.activo) mapa[h.dia_semana].push({ inicio: h.hora_inicio, fin: h.hora_fin, jornada: h.jornada });
  }
  for (const d of ORDEN_DIAS) mapa[d].sort((a, b) => aMinutos(a.inicio) - aMinutos(b.inicio));
  return mapa;
}

function agruparDias(mapa) {
  const grupos = [];
  for (const d of ORDEN_DIAS) {
    const firma = mapa[d].map((r) => `${r.inicio}-${r.fin}`).join('|');
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.firma === firma) ultimo.dias.push(d);
    else grupos.push({ firma, dias: [d], rangos: mapa[d] });
  }
  return grupos;
}

function nombreGrupo(dias) {
  if (dias.length === 7) return 'Todos los días';
  if (dias.length === 1) return DIAS_SEMANA[dias[0]];
  if (dias.length === 2) return `${DIAS_SEMANA[dias[0]]} y ${DIAS_SEMANA[dias[1]].toLowerCase()}`;
  return `${DIAS_SEMANA[dias[0]]} a ${DIAS_SEMANA[dias[dias.length - 1]].toLowerCase()}`;
}

function pintarHorarios() {
  const mapa = rangosPorDia();
  const grupos = agruparDias(mapa);
  const hoy = diaSemana(hoyISO());

  $('#horarios-lista').innerHTML = grupos.map((g) => `
    <div class="horario-card__row ${g.dias.includes(hoy) ? 'is-today' : ''}">
      <dt>${esc(nombreGrupo(g.dias))}</dt>
      <dd>${g.rangos.length
        ? g.rangos.map((r) => `<span>${esc(r.jornada)} · ${rangoHoras(r.inicio, r.fin)}</span>`).join('')
        : '<span>Sin atención</span>'}</dd>
    </div>`).join('');

  const deHoy = mapa[hoy];
  const textoHoy = deHoy.length ? deHoy.map((r) => rangoHoras(r.inicio, r.fin)).join(' y ') : 'Hoy no hay atención';
  const todosIguales = grupos.length === 1;
  $('#footer-horario').textContent = todosIguales && deHoy.length ? `Todos los días · ${textoHoy}` : `Hoy · ${textoHoy}`;

  pintarEstadoHero();
}

function pintarEstadoHero() {
  if (!horarios.length) return;
  const mapa = rangosPorDia();
  const hoy = diaSemana(hoyISO());
  const ahora = aMinutos(ahoraHHMM());
  const deHoy = mapa[hoy];
  const contenedor = $('#hero-estado');
  let abierto = false;
  let titulo;
  let detalle;

  const actual = deHoy.find((r) => ahora >= aMinutos(r.inicio) && ahora < aMinutos(r.fin));
  if (actual) {
    abierto = true;
    titulo = 'Abierto ahora';
    detalle = `hasta las ${hora12(actual.fin)}`;
  } else {
    const siguienteHoy = deHoy.find((r) => aMinutos(r.inicio) > ahora);
    titulo = 'Cerrado ahora';
    if (siguienteHoy) {
      detalle = `abrimos hoy a las ${hora12(siguienteHoy.inicio)}`;
    } else {
      for (let i = 1; i <= 7; i++) {
        const d = (hoy + i) % 7;
        if (mapa[d].length) {
          detalle = `abrimos ${i === 1 ? 'mañana' : `el ${DIAS_SEMANA[d].toLowerCase()}`} a las ${hora12(mapa[d][0].inicio)}`;
          break;
        }
      }
    }
  }
  contenedor.innerHTML = `
    <span class="status-dot ${abierto ? 'is-open' : 'is-closed'}" aria-hidden="true"></span>
    <span><strong>${esc(titulo)}</strong> <span class="hero__fact-detail">${esc(detalle || '')}</span></span>`;
}

// =============================================================================
// SIN CONFIGURACIÓN
// =============================================================================
function mostrarAvisoConfiguracion() {
  const aviso = `
    <div class="config-alert" role="alert">
      ${icono('alert')}
      <div>
        <strong>Falta conectar la base de datos.</strong>
        Copia <code>js/env.example.js</code> como <code>js/env.js</code> y escribe la URL y la clave pública (anon) de tu proyecto de Supabase.
        Consulta el archivo README.md para el paso a paso.
      </div>
    </div>`;
  $('#mesas-grid').innerHTML = aviso;
  $('#mesas-grid').removeAttribute('aria-busy');
  $('#carta-panel').innerHTML = aviso;
  $('#carta-panel').removeAttribute('aria-busy');
  $('#reservas-contexto').textContent = 'Disponibilidad no disponible sin conexión a Supabase.';
  $('#horarios-lista').innerHTML = '<p class="muted">Lunes a domingo · 12:30 – 2:30 p. m. y 5:00 – 11:00 p. m.</p>';
}
