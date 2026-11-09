// -----------------------------------------------------------------------------
// Reservas (módulo del cliente)
//   · Visualización de mesas con su estado para la fecha elegida.
//   · Modal de reserva: fecha → hora → datos → confirmación.
//   · La creación se hace con la RPC atómica crear_reserva() de Supabase, que
//     vuelve a verificar la disponibilidad justo antes de registrar.
// -----------------------------------------------------------------------------
import { obtenerMesas, obtenerDisponibilidad, obtenerSlotsMesa, crearReserva } from './api.js';
import { ZONAS, DIAS_MAX_ANTICIPACION, NEGOCIO } from './config.js';
import {
  $, $$, esc, icono, hoyISO, sumarDias, diaSemana, isoADate, fechaLarga, fechaMedia, fechaAmigable, mesAnio,
  ahoraHHMM, aMinutos, hora12, hora12Partes, rangoHoras, duracionTexto, codigoReserva,
} from './utils.js';
import { abrirModal, conCarga, estadoBloque } from './ui.js';

const st = {
  mesas: [],
  disp: new Map(),
  horarios: [],
  fecha: null,
  zona: '',
  solicitud: 0,
  modal: null, // reserva abierta (para refrescarla)
};

const REGEX_CONTACTO = /^\+?[0-9 ()-]{7,20}$/;

// =============================================================================
// API DEL MÓDULO
// =============================================================================
export function iniciarReservas({ horarios }) {
  st.horarios = horarios || [];
  configurarBarra();
  establecerFecha(fechaInicial(), { cargar: false });
  cargar();

  $('#mesas-grid').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-mesa]');
    if (!boton) return;
    const mesa = st.mesas.find((m) => m.id === boton.dataset.mesa);
    if (mesa) abrirReserva(mesa);
  });

  // Disponibilidad casi en tiempo real: recarga periódica y al volver a la pestaña.
  setInterval(() => { if (document.visibilityState === 'visible') refrescarReservas(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refrescarReservas(); });
}

export function actualizarHorarios(horarios) {
  st.horarios = horarios;
}

export function refrescarReservas() {
  cargar();
  st.modal?.refrescar();
}

// =============================================================================
// HORARIOS (cálculo local para el calendario y la fecha inicial)
// =============================================================================
const horariosDelDia = (dow) => st.horarios.filter((h) => h.activo && h.dia_semana === dow);

/** Minuto de inicio del último horario reservable del día (o -1). */
function ultimoInicio(dow) {
  let max = -1;
  for (const h of horariosDelDia(dow)) {
    const ini = aMinutos(h.hora_inicio);
    const n = Math.floor((aMinutos(h.hora_fin) - ini) / h.duracion_slot);
    if (n > 0) max = Math.max(max, ini + (n - 1) * h.duracion_slot);
  }
  return max;
}

/** ¿Se puede reservar algo en esa fecha (según jornadas y hora actual)? */
function fechaReservable(iso) {
  const hoy = hoyISO();
  if (!iso || iso < hoy || iso > sumarDias(hoy, DIAS_MAX_ANTICIPACION)) return false;
  const ultimo = ultimoInicio(diaSemana(iso));
  if (ultimo < 0) return false;
  return iso > hoy || ultimo > aMinutos(ahoraHHMM());
}

function fechaInicial() {
  const hoy = hoyISO();
  for (let i = 0; i <= DIAS_MAX_ANTICIPACION; i++) {
    const iso = sumarDias(hoy, i);
    if (fechaReservable(iso)) return iso;
  }
  return hoy;
}

// =============================================================================
// LISTADO DE MESAS
// =============================================================================
function configurarBarra() {
  const hoy = hoyISO();
  const input = $('#fecha-otra');
  input.min = hoy;
  input.max = sumarDias(hoy, DIAS_MAX_ANTICIPACION);
  input.addEventListener('change', () => { if (input.value) establecerFecha(input.value); });

  $('#fecha-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-fecha]');
    if (!chip) return;
    establecerFecha(chip.dataset.fecha === 'hoy' ? hoyISO() : sumarDias(hoyISO(), 1));
  });

  $('#zona-filtro').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zona]');
    if (!b) return;
    st.zona = b.dataset.zona;
    $$('#zona-filtro [data-zona]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintarMesas();
  });
}

function establecerFecha(iso, { cargar: recargar = true } = {}) {
  st.fecha = iso;
  const hoy = hoyISO();
  const manana = sumarDias(hoy, 1);
  $$('#fecha-chips [data-fecha]').forEach((c) => {
    const valor = c.dataset.fecha === 'hoy' ? hoy : manana;
    c.setAttribute('aria-pressed', String(valor === iso));
  });
  const otra = iso !== hoy && iso !== manana;
  const picker = $('.chip--picker');
  picker.classList.toggle('is-active', otra);
  $('#fecha-otra-label').textContent = otra ? fechaMedia(iso) : 'Otra fecha';
  $('#fecha-otra').value = iso;
  if (recargar) cargar();
}

async function cargar() {
  const grid = $('#mesas-grid');
  const solicitud = ++st.solicitud;
  const fecha = st.fecha;
  try {
    const [mesas, disponibilidad] = await Promise.all([obtenerMesas(), obtenerDisponibilidad(fecha)]);
    if (solicitud !== st.solicitud) return; // llegó una consulta más reciente
    st.mesas = mesas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    st.disp = new Map(disponibilidad.map((d) => [d.mesa_id, d]));
    pintarMesas();
  } catch (err) {
    if (solicitud !== st.solicitud) return;
    console.error(err);
    grid.innerHTML = estadoBloque({
      icono: 'alert',
      titulo: 'No pudimos cargar las mesas',
      texto: err.message,
      accion: '<button class="btn btn--dark" type="button" data-reintentar>Reintentar</button>',
    });
    grid.querySelector('[data-reintentar]').addEventListener('click', cargar);
    $('#reservas-contexto').textContent = 'Sin conexión con el sistema de reservas.';
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

function estadoMesa(m) {
  if (!m.activa) return { clave: 'inactiva', badge: 'badge--muted', texto: 'Inactiva', detalle: 'No recibe reservas' };
  const d = st.disp.get(m.id);
  if (d && d.slots_libres > 0) {
    return { clave: 'libre', badge: 'badge--success', texto: 'Libre', detalle: `${d.slots_libres} ${d.slots_libres === 1 ? 'horario libre' : 'horarios libres'}` };
  }
  if (d && d.slots_futuros > 0) return { clave: 'ocupada', badge: 'badge--danger', texto: 'Ocupada', detalle: 'Sin horarios libres' };
  if (d && d.slots_totales > 0) return { clave: 'no-disponible', badge: 'badge--danger', texto: 'No disponible', detalle: 'Atención finalizada' };
  return { clave: 'no-disponible', badge: 'badge--danger', texto: 'No disponible', detalle: 'Sin atención este día' };
}

/** "Mesa 3" → "M3", "Terraza 12" → "T12", "Barra" → "BA" */
function abreviatura(nombre) {
  const num = nombre.match(/\d+/);
  const letra = nombre.trim().charAt(0).toUpperCase();
  return num ? `${letra}${num[0]}` : nombre.trim().slice(0, 2).toUpperCase();
}

function pintarMesas() {
  const grid = $('#mesas-grid');
  const visibles = st.mesas
    .filter((m) => !st.zona || m.zona === st.zona)
    .sort((a, b) => Number(b.activa) - Number(a.activa));

  const activas = st.mesas.filter((m) => m.activa);
  const libres = activas.filter((m) => (st.disp.get(m.id)?.slots_libres ?? 0) > 0).length;
  const amiga = fechaAmigable(st.fecha);
  const prefijo = amiga === 'Hoy' ? 'hoy, ' : amiga === 'Mañana' ? 'mañana, ' : '';
  $('#reservas-contexto').innerHTML = `Disponibilidad para <strong>${esc(prefijo + fechaLarga(st.fecha).toLowerCase())}</strong> · ${libres} de ${activas.length} mesas con horarios libres`;

  if (!st.mesas.length) {
    grid.innerHTML = estadoBloque({ icono: 'utensils', titulo: 'Aún no hay mesas registradas', texto: 'Pronto podrás reservar en línea. Mientras tanto, escríbenos por WhatsApp.' });
    return;
  }
  if (!visibles.length) {
    grid.innerHTML = estadoBloque({ icono: 'filter', titulo: 'No hay mesas en esta zona', texto: 'Prueba con otra zona del restaurante.' });
    return;
  }

  grid.innerHTML = visibles.map((m, i) => {
    const zona = ZONAS[m.zona] ?? { nombre: m.zona, icono: 'utensils' };
    const e = estadoMesa(m);
    const inactiva = e.clave === 'inactiva';
    const personas = `${m.capacidad} ${m.capacidad === 1 ? 'persona' : 'personas'}`;
    return `
      <article class="mesa-card ${inactiva ? 'is-inactive' : ''}" style="--delay:${Math.min(i, 12) * 35}ms" aria-label="${esc(m.nombre)}, ${esc(zona.nombre)}, ${personas}, ${esc(e.texto)}">
        <div class="mesa-card__media">
          ${m.foto_url
            ? `<img src="${esc(m.foto_url)}" alt="" loading="lazy" decoding="async">`
            : `<div class="mesa-card__placeholder" aria-hidden="true"><span>${esc(abreviatura(m.nombre))}</span></div>`}
          <span class="mesa-card__zone">${icono(zona.icono)}${esc(zona.nombre)}</span>
        </div>
        <div class="mesa-card__body">
          <h3 class="mesa-card__name">${esc(m.nombre)}</h3>
          <p class="mesa-card__meta">${icono('users')}${esc(zona.nombre)} · ${personas}</p>
          <div class="mesa-card__status">
            <span class="badge ${e.badge}">${esc(e.texto)}</span>
            <span class="mesa-card__slots">${esc(e.detalle)}</span>
          </div>
          <div class="mesa-card__action">
            ${inactiva
              ? '<button class="btn btn--ghost btn--block" type="button" disabled>No disponible</button>'
              : `<button class="btn ${e.clave === 'libre' ? 'btn--dark' : 'btn--ghost'} btn--block" type="button" data-mesa="${m.id}">Ver<span class="btn-text-long">&nbsp;horarios</span></button>`}
          </div>
        </div>
      </article>`;
  }).join('');

  // Si una foto falla, se muestra el marcador de posición.
  $$('.mesa-card__media img', grid).forEach((img) => img.addEventListener('error', () => {
    const nombre = img.closest('.mesa-card').querySelector('.mesa-card__name').textContent;
    img.replaceWith(Object.assign(document.createElement('div'), {
      className: 'mesa-card__placeholder',
      innerHTML: `<span>${esc(abreviatura(nombre))}</span>`,
    }));
  }, { once: true }));
}

// =============================================================================
// MODAL DE RESERVA
// =============================================================================
function abrirReserva(mesa) {
  const zona = ZONAS[mesa.zona] ?? { nombre: mesa.zona };
  const r = {
    mesa,
    fecha: null,
    mes: null,
    slots: [],
    hora: null,
    peticion: 0,
    enviando: false,
    confirmada: false,
  };

  const modal = abrirModal({
    titulo: `Reservar · ${mesa.nombre}`,
    subtitulo: `${zona.nombre} · hasta ${mesa.capacidad} ${mesa.capacidad === 1 ? 'persona' : 'personas'}`,
    clase: 'modal--reserva',
    contenido: plantillaReserva(mesa),
    alCerrar: () => {
      clearInterval(temporizador);
      st.modal = null;
    },
  });
  const raiz = modal.cuerpo;
  const q = (sel) => raiz.querySelector(sel);
  const form = q('[data-form]');
  const inNombre = q('#r-nombre');
  const inContacto = q('#r-contacto');
  const inPersonas = q('#r-personas');

  // ---------- Calendario ----------
  function pintarCalendario() {
    const hoy = hoyISO();
    const max = sumarDias(hoy, DIAS_MAX_ANTICIPACION);
    const [y, m] = r.mes.split('-').map(Number);
    const primero = `${r.mes}-01`;
    const offset = (diaSemana(primero) + 6) % 7; // lunes = 0
    const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const prevDeshabilitado = r.mes <= hoy.slice(0, 7);
    const nextDeshabilitado = r.mes >= max.slice(0, 7);

    let celdas = '';
    for (let i = 0; i < offset; i++) celdas += '<span class="cal__empty" aria-hidden="true"></span>';
    for (let d = 1; d <= diasMes; d++) {
      const iso = `${r.mes}-${String(d).padStart(2, '0')}`;
      const cerrado = horariosDelDia(diaSemana(iso)).length === 0;
      const habilitado = fechaReservable(iso);
      const etiqueta = `${fechaLarga(iso)}${cerrado ? ', sin atención' : !habilitado ? ', no disponible' : ''}`;
      celdas += `<button type="button" class="cal__day ${iso === hoy ? 'is-today' : ''} ${cerrado ? 'is-closed' : ''}"
        data-dia="${iso}" aria-pressed="${iso === r.fecha}" aria-label="${esc(etiqueta)}" ${habilitado ? '' : 'disabled'}>${d}</button>`;
    }

    q('[data-cal]').innerHTML = `
      <div class="cal__head">
        <span class="cal__month" aria-live="polite">${esc(mesAnio(primero))}</span>
        <div class="cal__nav">
          <button type="button" class="icon-btn" data-mes="-1" aria-label="Mes anterior" ${prevDeshabilitado ? 'disabled' : ''}>${icono('chevron-left')}</button>
          <button type="button" class="icon-btn" data-mes="1" aria-label="Mes siguiente" ${nextDeshabilitado ? 'disabled' : ''}>${icono('chevron-right')}</button>
        </div>
      </div>
      <div class="cal__grid" role="group" aria-label="Días de ${esc(mesAnio(primero))}">
        ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="cal__dow" aria-hidden="true">${x}</span>`).join('')}
        ${celdas}
      </div>`;
  }

  q('[data-cal]').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-mes]');
    if (nav) {
      const [y, m] = r.mes.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.mes), 1));
      r.mes = d.toISOString().slice(0, 7);
      pintarCalendario();
      return;
    }
    const dia = e.target.closest('[data-dia]');
    if (dia && !dia.disabled) elegirFecha(dia.dataset.dia);
  });

  function elegirFecha(iso) {
    r.fecha = iso;
    r.mes = iso.slice(0, 7);
    r.hora = null;
    limpiarAlerta();
    pintarCalendario();
    q('[data-fecha-texto]').textContent = fechaMedia(iso);
    q('[data-hora-texto]').textContent = '';
    cargarSlots();
    pintarResumen();
  }

  // ---------- Horarios ----------
  async function cargarSlots({ silencioso = false } = {}) {
    if (!r.fecha) return;
    const contenedor = q('[data-slots]');
    const peticion = ++r.peticion;
    if (!silencioso) {
      contenedor.innerHTML = `<div class="slots-loading" aria-label="Cargando horarios">${'<div class="skeleton"></div>'.repeat(8)}</div>`;
    }
    try {
      const slots = await obtenerSlotsMesa(mesa.id, r.fecha);
      if (peticion !== r.peticion || r.confirmada) return;
      r.slots = slots;
      // Si el horario elegido dejó de estar libre, se avisa y se deselecciona.
      if (r.hora && !slots.some((s) => s.hora_inicio === r.hora && s.disponible)) {
        r.hora = null;
        mostrarAlerta('El horario que elegiste acaba de ser reservado por otra persona. Elige otro.', 'warn');
        pintarResumen();
      }
      pintarSlots();
    } catch (err) {
      if (peticion !== r.peticion) return;
      if (!silencioso) {
        contenedor.innerHTML = `<div class="alert alert--error">${icono('alert')}<span>${esc(err.message)} <button type="button" class="link" data-reintentar>Reintentar</button></span></div>`;
        contenedor.querySelector('[data-reintentar]').addEventListener('click', () => cargarSlots());
      }
    }
  }

  function pintarSlots() {
    const contenedor = q('[data-slots]');
    if (!r.fecha) {
      contenedor.innerHTML = '<p class="slots-empty">Elige una fecha para ver los horarios.</p>';
      return;
    }
    if (!r.slots.length) {
      contenedor.innerHTML = '<p class="slots-empty">El restaurante no atiende reservas en esta fecha. Elige otro día.</p>';
      return;
    }
    const grupos = [];
    for (const s of r.slots) {
      let g = grupos.find((x) => x.jornada === s.jornada);
      if (!g) grupos.push((g = { jornada: s.jornada, slots: [] }));
      g.slots.push(s);
    }
    const libres = r.slots.filter((s) => s.disponible).length;
    const aviso = libres === 0
      ? `<div class="alert alert--warn">${icono('info')}<span>No quedan horarios libres para esta mesa el ${esc(fechaMedia(r.fecha))}. Prueba con otra fecha o con otra mesa.</span></div>`
      : '';
    contenedor.innerHTML = aviso + grupos.map((g) => `
      <div class="slots-group">
        <p class="slots-group__title">${icono('clock')}${esc(g.jornada)}</p>
        <div class="slots" role="group" aria-label="Horarios de ${esc(g.jornada)}">
          ${g.slots.map((s) => {
            const p = hora12Partes(s.hora_inicio);
            const clase = s.motivo === 'ocupado' ? 'is-ocupado' : s.motivo === 'pasado' ? 'is-pasado' : '';
            const estado = s.motivo === 'ocupado' ? ', ocupado' : s.motivo === 'pasado' ? ', ya pasó' : ', libre';
            return `<button type="button" class="slot ${clase}" data-hora="${s.hora_inicio}" aria-pressed="${s.hora_inicio === r.hora}"
              aria-label="${esc(hora12(s.hora_inicio) + estado)}" ${s.disponible ? '' : 'disabled'}>
              <span class="slot__hora">${p.hora}</span>
              <span class="slot__sufijo">${s.motivo === 'ocupado' ? 'Ocupado' : p.sufijo}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`).join('');
  }

  q('[data-slots]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hora]');
    if (!b || b.disabled) return;
    r.hora = b.dataset.hora;
    $$('[data-hora]', raiz).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const slot = r.slots.find((s) => s.hora_inicio === r.hora);
    q('[data-hora-texto]').textContent = rangoHoras(slot.hora_inicio, slot.hora_fin);
    limpiarAlerta();
    pintarResumen();
  });

  // ---------- Datos del cliente ----------
  const cap = mesa.capacidad;
  function personas() {
    const n = Number.parseInt(inPersonas.value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  function ajustarStepper() {
    const n = personas();
    q('[data-paso="-1"]').disabled = n <= 1;
    q('[data-paso="1"]').disabled = n >= cap;
  }
  raiz.querySelector('.stepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-paso]');
    if (!b) return;
    const n = Math.min(cap, Math.max(1, personas() + Number(b.dataset.paso)));
    inPersonas.value = String(n);
    error('personas', '');
    ajustarStepper();
    pintarResumen();
  });
  inPersonas.addEventListener('input', () => { error('personas', ''); ajustarStepper(); pintarResumen(); });
  inPersonas.addEventListener('blur', () => validarPersonas());
  inNombre.addEventListener('input', () => error('nombre', ''));
  inNombre.addEventListener('blur', () => inNombre.value && validarNombre());
  inContacto.addEventListener('input', () => error('contacto', ''));
  inContacto.addEventListener('blur', () => validarContacto());

  function error(campo, mensaje) {
    const input = { nombre: inNombre, contacto: inContacto, personas: inPersonas }[campo];
    q(`#r-${campo}-error`).innerHTML = mensaje ? `${icono('alert')}${esc(mensaje)}` : '';
    input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }
  function validarNombre() {
    const v = inNombre.value.trim().replace(/\s+/g, ' ');
    if (v.length < 2) { error('nombre', 'Escribe tu nombre (mínimo 2 caracteres).'); return false; }
    if (!/[a-záéíóúüñ]/i.test(v)) { error('nombre', 'El nombre debe contener letras.'); return false; }
    error('nombre', '');
    return true;
  }
  function validarContacto() {
    const v = inContacto.value.trim();
    if (v && !REGEX_CONTACTO.test(v)) { error('contacto', 'Escribe un número válido, por ejemplo 300 123 4567.'); return false; }
    error('contacto', '');
    return true;
  }
  function validarPersonas() {
    const n = personas();
    if (n < 1) { error('personas', 'Debe asistir al menos 1 persona.'); return false; }
    if (n > cap) { error('personas', `Esta mesa admite máximo ${cap} personas. Elige una mesa más grande.`); return false; }
    error('personas', '');
    return true;
  }

  // ---------- Resumen ----------
  function pintarResumen() {
    const slot = r.slots.find((s) => s.hora_inicio === r.hora);
    const n = personas();
    const fila = (ic, etiqueta, valor) => `
      <div class="resumen__row">${icono(ic)}<dt>${etiqueta}</dt><dd class="${valor ? '' : 'is-empty'}">${valor ? esc(valor) : 'Sin elegir'}</dd></div>`;
    q('[data-resumen]').innerHTML = [
      fila('utensils', 'Mesa', `${mesa.nombre} · ${zona.nombre}`),
      fila('calendar', 'Fecha', r.fecha ? fechaMedia(r.fecha) : ''),
      fila('clock', 'Hora', slot ? rangoHoras(slot.hora_inicio, slot.hora_fin) : ''),
      fila('info', 'Duración', slot ? duracionTexto(aMinutos(slot.hora_fin) - aMinutos(slot.hora_inicio)) : ''),
      fila('users', 'Personas', n >= 1 && n <= cap ? String(n) : ''),
    ].join('');
  }

  // ---------- Alertas ----------
  function mostrarAlerta(mensaje, tipo = 'error') {
    const ic = tipo === 'error' ? 'alert' : 'info';
    q('[data-alerta]').innerHTML = `<div class="alert alert--${tipo}" role="alert">${icono(ic)}<span>${esc(mensaje)}</span></div>`;
  }
  function limpiarAlerta() {
    q('[data-alerta]').innerHTML = '';
  }

  // ---------- Envío ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (r.enviando) return;
    limpiarAlerta();
    if (!r.fecha || !r.hora) {
      mostrarAlerta(!r.fecha ? 'Elige la fecha de tu reserva.' : 'Elige la hora de tu reserva.');
      (r.fecha ? q('[data-slots]') : q('[data-cal]')).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const ok = [validarNombre(), validarContacto(), validarPersonas()].every(Boolean);
    if (!ok) {
      raiz.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    r.enviando = true;
    const boton = q('[data-confirmar]');
    try {
      const reserva = await conCarga(boton, () => crearReserva({
        mesaId: mesa.id,
        fecha: r.fecha,
        horaInicio: r.hora,
        nombre: inNombre.value.trim().replace(/\s+/g, ' '),
        personas: personas(),
        contacto: inContacto.value.trim(),
      }), 'Confirmando…');
      r.confirmada = true;
      mostrarConfirmacion(reserva);
      cargar(); // actualiza el estado de las mesas en la página
    } catch (err) {
      manejarError(err);
    } finally {
      r.enviando = false;
    }
  });

  function manejarError(err) {
    switch (err.motivo) {
      case 'HORARIO_OCUPADO':
      case 'HORARIO_PASADO':
      case 'FUERA_DE_HORARIO':
        r.hora = null;
        mostrarAlerta(err.message);
        q('[data-hora-texto]').textContent = '';
        cargarSlots();
        pintarResumen();
        cargar();
        break;
      case 'CAPACIDAD_EXCEDIDA':
      case 'PERSONAS_INVALIDAS':
        error('personas', err.message);
        inPersonas.focus();
        break;
      case 'NOMBRE_INVALIDO':
        error('nombre', err.message);
        inNombre.focus();
        break;
      case 'CONTACTO_INVALIDO':
        error('contacto', err.message);
        inContacto.focus();
        break;
      case 'FECHA_PASADA':
      case 'FECHA_FUERA_DE_RANGO':
        r.fecha = null;
        r.hora = null;
        mostrarAlerta(err.message);
        pintarCalendario();
        pintarSlots();
        pintarResumen();
        break;
      case 'MESA_INACTIVA':
      case 'MESA_NO_EXISTE':
        mostrarAlerta(`${err.message} Elige otra mesa.`);
        q('[data-confirmar]').disabled = true;
        cargar();
        break;
      default:
        mostrarAlerta(err.message || 'No pudimos registrar tu reserva. Intenta de nuevo.');
    }
  }

  // ---------- Confirmación ----------
  function mostrarConfirmacion(res) {
    const codigo = codigoReserva(res.id);
    const zonaNombre = ZONAS[res.mesa_zona]?.nombre ?? res.mesa_zona;
    const mensajeWa = `Hola Konys, hice la reserva ${codigo} a nombre de ${res.cliente_nombre}: ${res.mesa_nombre} (${zonaNombre}), ${fechaLarga(res.fecha).toLowerCase()} a las ${hora12(res.hora_inicio)}, ${res.num_personas} ${res.num_personas === 1 ? 'persona' : 'personas'}.`;
    modal.setTitulo('Confirmación', `${res.mesa_nombre} · ${zonaNombre}`);
    raiz.innerHTML = `
      <section class="confirmacion" aria-labelledby="conf-titulo">
        <span class="confirmacion__icon">${icono('check')}</span>
        <h3 class="confirmacion__title" id="conf-titulo" tabindex="-1">¡Reserva confirmada!</h3>
        <p class="confirmacion__text">Te esperamos en Konys, ${esc(res.cliente_nombre.split(' ')[0])}. Guarda este código:</p>
        <span class="confirmacion__codigo">${icono('hash')}${esc(codigo)}</span>
        <dl class="confirmacion__detalle">
          <div><dt>Nombre</dt><dd>${esc(res.cliente_nombre)}</dd></div>
          <div><dt>Mesa</dt><dd>${esc(res.mesa_nombre)}</dd></div>
          <div><dt>Zona</dt><dd>${esc(zonaNombre)}</dd></div>
          <div><dt>Fecha</dt><dd>${esc(fechaLarga(res.fecha))}</dd></div>
          <div><dt>Hora</dt><dd>${esc(rangoHoras(res.hora_inicio, res.hora_fin))}</dd></div>
          <div><dt>Personas</dt><dd>${esc(res.num_personas)}</dd></div>
          ${res.cliente_contacto ? `<div><dt>Contacto</dt><dd>${esc(res.cliente_contacto)}</dd></div>` : ''}
          <div><dt>Estado</dt><dd><span class="badge badge--success">Confirmada</span></dd></div>
        </dl>
        <div class="confirmacion__acciones">
          <button type="button" class="btn btn--dark btn--lg" data-inicio>Volver al inicio</button>
          <a class="btn btn--ghost btn--lg" href="https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(mensajeWa)}" target="_blank" rel="noopener">
            ${icono('message')}Enviar por WhatsApp
          </a>
        </div>
        <p class="confirmacion__ayuda">¿Necesitas cambiar o cancelar? Escríbenos por WhatsApp al ${esc(NEGOCIO.whatsappVisible)} indicando tu código.</p>
      </section>`;
    raiz.scrollTop = 0;
    raiz.querySelector('#conf-titulo').focus({ preventScroll: true });
    raiz.querySelector('[data-inicio]').addEventListener('click', () => {
      modal.cerrar();
      document.getElementById('inicio').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- Arranque ----------
  const inicial = fechaReservable(st.fecha) ? st.fecha : fechaInicial();
  r.mes = inicial.slice(0, 7);
  inPersonas.value = String(Math.min(2, cap));
  ajustarStepper();
  if (fechaReservable(inicial)) elegirFecha(inicial);
  else { pintarCalendario(); pintarSlots(); pintarResumen(); }

  // Refresco silencioso de los horarios mientras el modal está abierto.
  const temporizador = setInterval(() => {
    if (document.visibilityState === 'visible' && !r.enviando && !r.confirmada) cargarSlots({ silencioso: true });
  }, 45_000);
  st.modal = { refrescar: () => !r.enviando && !r.confirmada && cargarSlots({ silencioso: true }) };
}

function plantillaReserva(mesa) {
  const cap = mesa.capacidad;
  return `
    <div class="reserva">
      <div class="reserva__col">
        <section class="paso" aria-labelledby="paso-fecha">
          <h3 class="paso__title" id="paso-fecha"><span class="paso__num">1</span>Elige la fecha<span class="paso__value" data-fecha-texto></span></h3>
          <div class="cal" data-cal></div>
        </section>
        <section class="paso" aria-labelledby="paso-hora">
          <h3 class="paso__title" id="paso-hora"><span class="paso__num">2</span>Elige la hora<span class="paso__value" data-hora-texto></span></h3>
          <div data-slots aria-live="polite"></div>
          <div class="slots-legend" aria-hidden="true">
            <span><i></i>Libre</span><span><i class="is-ocupado"></i>Ocupado</span><span><i class="is-sel"></i>Seleccionado</span>
          </div>
        </section>
      </div>

      <div class="reserva__col">
        <form class="paso" data-form novalidate>
          <h3 class="paso__title"><span class="paso__num">3</span>Tus datos</h3>
          <div class="form-grid">
            <div class="field">
              <label class="field__label" for="r-nombre">Nombre completo</label>
              <input class="input" id="r-nombre" name="nombre" autocomplete="name" maxlength="80" required placeholder="Ej. Juan Pérez" aria-describedby="r-nombre-error">
              <p class="field__error" id="r-nombre-error"></p>
            </div>
            <div class="form-row">
              <div class="field">
                <label class="field__label" for="r-contacto">Teléfono / WhatsApp <span class="opcional">Opcional</span></label>
                <input class="input" id="r-contacto" name="contacto" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="300 123 4567" aria-describedby="r-contacto-error">
              </div>
              <div class="field">
                <label class="field__label" for="r-personas">Personas</label>
                <div class="stepper">
                  <button type="button" data-paso="-1" aria-label="Una persona menos">${icono('minus')}</button>
                  <input id="r-personas" name="personas" type="number" inputmode="numeric" min="1" max="${cap}" step="1" aria-describedby="r-personas-hint r-personas-error">
                  <button type="button" data-paso="1" aria-label="Una persona más">${icono('plus')}</button>
                </div>
              </div>
            </div>
            <p class="field__error" id="r-contacto-error"></p>
            <p class="field__hint" id="r-personas-hint">Esta mesa admite máximo ${cap} ${cap === 1 ? 'persona' : 'personas'}.</p>
            <p class="field__error" id="r-personas-error"></p>
          </div>

          <div class="resumen">
            <p class="resumen__title">Resumen</p>
            <dl class="resumen__list" data-resumen></dl>
          </div>

          <div data-alerta aria-live="assertive"></div>

          <div class="reserva__submit">
            <button class="btn btn--primary btn--lg btn--block" type="submit" data-confirmar>Confirmar reserva</button>
            <p class="reserva__nota">Verificamos la disponibilidad de nuevo antes de confirmar.</p>
          </div>
        </form>
      </div>
    </div>`;
}
