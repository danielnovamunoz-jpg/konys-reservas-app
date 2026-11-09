// -----------------------------------------------------------------------------
// Componentes de interfaz reutilizables: notificaciones, modales accesibles,
// diálogo de confirmación y estado de carga de botones.
// -----------------------------------------------------------------------------
import { esc, icono, html } from './utils.js';

// ---------- Notificaciones (toasts) ----------
let regionToasts;
function region() {
  if (!regionToasts) {
    regionToasts = html('<div class="toasts" role="region" aria-live="polite" aria-label="Notificaciones"></div>');
    document.body.append(regionToasts);
  }
  return regionToasts;
}

/**
 * Muestra una notificación breve.
 * tipo: 'exito' | 'error' | 'info'
 */
export function notificar(mensaje, tipo = 'exito', { duracion = 4200 } = {}) {
  const iconos = { exito: 'check-circle', error: 'alert', info: 'info' };
  const t = html(`
    <div class="toast toast--${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}">
      ${icono(iconos[tipo] || 'info', 'toast__icon')}
      <p class="toast__text">${esc(mensaje)}</p>
      <button class="toast__close" type="button" aria-label="Cerrar notificación">${icono('x')}</button>
    </div>`);
  const cerrar = () => {
    t.classList.add('is-leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400);
  };
  t.querySelector('.toast__close').addEventListener('click', cerrar);
  region().append(t);
  if (duracion) setTimeout(cerrar, duracion);
  return cerrar;
}

// ---------- Modal ----------
const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const pila = [];

/**
 * Abre un modal accesible.
 * opciones: { titulo, subtitulo, contenido (HTML|Element), pie (HTML), clase, alCerrar, cerrable }
 * Devuelve { el, cuerpo, cerrar, setTitulo }.
 */
export function abrirModal({ titulo = '', subtitulo = '', contenido = '', pie = '', clase = '', alCerrar, cerrable = true, etiqueta } = {}) {
  const previo = document.activeElement;
  const id = `modal-${Math.random().toString(36).slice(2, 8)}`;
  const el = html(`
    <div class="modal ${clase}" role="presentation">
      <div class="modal__backdrop" data-cerrar></div>
      <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-t" tabindex="-1">
        <header class="modal__header">
          <button class="modal__back icon-btn" type="button" data-cerrar aria-label="Volver">${icono('arrow-left')}</button>
          <div class="modal__titles">
            <h2 class="modal__title" id="${id}-t">${esc(titulo)}</h2>
            ${subtitulo ? `<p class="modal__subtitle">${esc(subtitulo)}</p>` : ''}
          </div>
          <button class="modal__close icon-btn" type="button" data-cerrar aria-label="Cerrar">${icono('x')}</button>
        </header>
        <div class="modal__body"></div>
        ${pie ? `<footer class="modal__footer">${pie}</footer>` : ''}
      </div>
    </div>`);
  if (etiqueta) el.querySelector('.modal__dialog').setAttribute('aria-label', etiqueta);
  const cuerpo = el.querySelector('.modal__body');
  if (typeof contenido === 'string') cuerpo.innerHTML = contenido;
  else if (contenido) cuerpo.append(contenido);

  let cerrado = false;
  function cerrar(resultado) {
    if (cerrado) return;
    cerrado = true;
    el.classList.add('is-leaving');
    document.removeEventListener('keydown', onKey, true);
    const quitar = () => {
      el.remove();
      pila.splice(pila.indexOf(el), 1);
      if (!pila.length) document.documentElement.classList.remove('has-modal');
      if (previo && document.contains(previo)) previo.focus({ preventScroll: true });
    };
    el.addEventListener('animationend', quitar, { once: true });
    setTimeout(quitar, 320);
    alCerrar?.(resultado);
  }

  function onKey(e) {
    if (pila[pila.length - 1] !== el) return;
    if (e.key === 'Escape' && cerrable) {
      e.preventDefault();
      cerrar();
    } else if (e.key === 'Tab') {
      const nodos = [...el.querySelectorAll(ENFOCABLES)].filter((n) => n.offsetParent !== null);
      if (!nodos.length) return;
      const primero = nodos[0];
      const ultimo = nodos[nodos.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]') && cerrable) cerrar();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  pila.push(el);
  document.documentElement.classList.add('has-modal');
  requestAnimationFrame(() => {
    const autofocus = el.querySelector('[autofocus]');
    (autofocus || el.querySelector('.modal__dialog')).focus({ preventScroll: true });
  });

  return {
    el,
    cuerpo,
    cerrar,
    setTitulo(t, s) {
      el.querySelector('.modal__title').textContent = t;
      const sub = el.querySelector('.modal__subtitle');
      if (sub && s !== undefined) sub.textContent = s;
    },
  };
}

/** Diálogo de confirmación. Resuelve true/false. */
export function confirmar({ titulo, mensaje, aceptar = 'Confirmar', cancelar = 'Cancelar', peligro = false } = {}) {
  return new Promise((resolve) => {
    let respuesta = false;
    const m = abrirModal({
      titulo,
      clase: 'modal--sm modal--confirm',
      contenido: `<p class="confirm__text">${esc(mensaje)}</p>`,
      pie: `
        <button type="button" class="btn btn--ghost" data-accion="no">${esc(cancelar)}</button>
        <button type="button" class="btn ${peligro ? 'btn--danger' : 'btn--primary'}" data-accion="si" autofocus>${esc(aceptar)}</button>`,
      alCerrar: () => resolve(respuesta),
    });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      respuesta = b.dataset.accion === 'si';
      m.cerrar();
    });
  });
}

/** Pone un botón en estado de carga mientras se ejecuta `tarea`. */
export async function conCarga(boton, tarea, textoCarga) {
  if (!boton) return tarea();
  const original = boton.innerHTML;
  boton.disabled = true;
  boton.classList.add('is-loading');
  boton.setAttribute('aria-busy', 'true');
  if (textoCarga) boton.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(textoCarga)}</span>`;
  try {
    return await tarea();
  } finally {
    boton.disabled = false;
    boton.classList.remove('is-loading');
    boton.removeAttribute('aria-busy');
    boton.innerHTML = original;
  }
}

/** Bloque de estado vacío / error reutilizable. */
export function estadoBloque({ icono: ic = 'info', titulo, texto = '', accion = '' }) {
  return `
    <div class="state-block">
      <span class="state-block__icon">${icono(ic)}</span>
      <p class="state-block__title">${esc(titulo)}</p>
      ${texto ? `<p class="state-block__text">${esc(texto)}</p>` : ''}
      ${accion}
    </div>`;
}
