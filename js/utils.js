// -----------------------------------------------------------------------------
// Utilidades compartidas: formato (COP, fechas, horas), DOM y tiempo.
// -----------------------------------------------------------------------------
import { ZONA_HORARIA, ICONOS } from './config.js';

// ---------- Texto seguro ----------
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapa texto para insertarlo en HTML (evita XSS con datos de la BD). */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Etiqueta <svg> de un ícono del sprite. */
export const icono = (nombre, clase = '') =>
  `<svg class="icon ${clase}" aria-hidden="true" focusable="false"><use href="${ICONOS}#i-${nombre}"></use></svg>`;

// ---------- Moneda ----------
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const formatoCOP = (n) => COP.format(Number(n) || 0).replace(/\s/g, ' ');

// ---------- Fechas (siempre en hora de Bogotá) ----------
const ISO_BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' });
const HORA_BOGOTA = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hour12: false });

/** Fecha de hoy en Bucaramanga, formato YYYY-MM-DD. */
export const hoyISO = () => ISO_BOGOTA.format(new Date());
/** Hora actual en Bucaramanga, formato HH:MM. */
export const ahoraHHMM = () => HORA_BOGOTA.format(new Date());

/** Convierte 'YYYY-MM-DD' a Date (UTC, mediodía) para operar sin saltos de zona. */
export const isoADate = (iso) => new Date(`${iso}T12:00:00Z`);
export const dateAISO = (d) => d.toISOString().slice(0, 10);
export const sumarDias = (iso, n) => {
  const d = isoADate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dateAISO(d);
};
export const diaSemana = (iso) => isoADate(iso).getUTCDay(); // 0 = domingo

const F_LARGA = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const F_MEDIA = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const F_CORTA = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const F_MES = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const F_FECHA_HORA = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const limpiar = (s) => s.replace(/\./g, '');

/** "martes, 10 de noviembre de 2026" */
export const fechaLarga = (iso) => capital(F_LARGA.format(isoADate(iso)));
/** "mar 10 nov" */
export const fechaMedia = (iso) => capital(limpiar(F_MEDIA.format(isoADate(iso))));
/** "10/11/2026" */
export const fechaCorta = (iso) => F_CORTA.format(isoADate(iso));
/** "noviembre de 2026" */
export const mesAnio = (iso) => capital(F_MES.format(isoADate(iso)));
/** Marca de tiempo (timestamptz) → "9 nov, 3:20 p. m." */
export const fechaHora = (ts) => F_FECHA_HORA.format(new Date(ts));

/** Fecha relativa amable: "Hoy", "Mañana" o "mar 10 nov". */
export function fechaAmigable(iso) {
  const hoy = hoyISO();
  if (iso === hoy) return 'Hoy';
  if (iso === sumarDias(hoy, 1)) return 'Mañana';
  return fechaMedia(iso);
}

// ---------- Horas ----------
/** '19:00:00' → minutos desde medianoche */
export const aMinutos = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
/** minutos → 'HH:MM' */
export const deMinutos = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** '19:00:00' → '19:00' */
export const hhmm = (t) => String(t ?? '').slice(0, 5);
/** '19:00:00' → '7:00 p. m.' (formato colombiano de 12 horas) */
export function hora12(t) {
  const min = aMinutos(t);
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, '0');
  const sufijo = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${sufijo}`;
}
/** Partes para botones de horario compactos: { hora: '7:00', sufijo: 'p. m.' } */
export function hora12Partes(t) {
  const [hora, ...rest] = hora12(t).split(' ');
  return { hora, sufijo: rest.join(' ') };
}
/** "12:30 – 2:30 p. m." o "11:00 a. m. – 2:30 p. m." */
export function rangoHoras(inicio, fin) {
  const a = hora12Partes(inicio);
  const b = hora12Partes(fin);
  return a.sufijo === b.sufijo
    ? `${a.hora} – ${b.hora} ${b.sufijo}`
    : `${a.hora} ${a.sufijo} – ${b.hora} ${b.sufijo}`;
}
/** Duración en minutos → "1 h", "1 h 30 min", "45 min" */
export function duracionTexto(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento a partir de HTML (primer nodo). */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normaliza texto para búsquedas (sin tildes, minúsculas). */
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Código corto legible de una reserva a partir de su UUID. */
export const codigoReserva = (id) => `KNY-${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}`;

/** Prefiere movimiento reducido del sistema. */
export const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
