// -----------------------------------------------------------------------------
// Carta digital (solo informativa). Los productos se leen de la tabla platos;
// los cambios del administrador se reflejan en vivo (Realtime) o al recargar.
// -----------------------------------------------------------------------------
import { obtenerPlatos } from './api.js';
import { CATEGORIAS } from './config.js';
import { $, $$, esc, icono, formatoCOP } from './utils.js';
import { estadoBloque } from './ui.js';

const st = { platos: [], categoria: 'pizzas' };

export async function iniciarCarta() {
  const tabs = $('#carta-tabs');
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-categoria]');
    if (tab) seleccionar(tab.dataset.categoria, { foco: false });
  });
  // Navegación con flechas entre pestañas (patrón ARIA tabs)
  tabs.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const lista = $$('[data-categoria]', tabs);
    const i = lista.findIndex((t) => t.dataset.categoria === st.categoria);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % lista.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + lista.length) % lista.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = lista.length - 1;
    e.preventDefault();
    seleccionar(lista[j].dataset.categoria, { foco: true });
  });
  await refrescarCarta();
}

export async function refrescarCarta() {
  const panel = $('#carta-panel');
  try {
    st.platos = await obtenerPlatos();
    if (!st.platos.some((p) => p.categoria === st.categoria)) {
      st.categoria = Object.keys(CATEGORIAS).find((c) => st.platos.some((p) => p.categoria === c)) || 'pizzas';
    }
    pintarPestanas();
    pintarPanel();
  } catch (err) {
    console.error(err);
    panel.innerHTML = estadoBloque({
      icono: 'alert',
      titulo: 'No pudimos cargar la carta',
      texto: err.message,
      accion: '<button type="button" class="btn btn--primary" data-reintentar>Reintentar</button>',
    });
    panel.querySelector('[data-reintentar]').addEventListener('click', refrescarCarta);
  } finally {
    panel.removeAttribute('aria-busy');
  }
}

function seleccionar(categoria, { foco }) {
  if (categoria === st.categoria) return;
  st.categoria = categoria;
  pintarPestanas();
  pintarPanel();
  if (foco) $(`#carta-tabs [data-categoria="${categoria}"]`).focus();
}

function pintarPestanas() {
  const conteo = (c) => st.platos.filter((p) => p.categoria === c).length;
  $('#carta-tabs').innerHTML = Object.entries(CATEGORIAS)
    .filter(([clave]) => conteo(clave) > 0)
    .map(([clave, cat]) => `
      <button class="carta-tab" type="button" role="tab" id="tab-${clave}" data-categoria="${clave}"
        aria-selected="${clave === st.categoria}" aria-controls="carta-panel" tabindex="${clave === st.categoria ? 0 : -1}">
        <img src="${cat.portada}" alt="" width="34" height="34" loading="lazy">
        ${esc(cat.nombre)}
        <span class="carta-tab__count">${conteo(clave)}</span>
      </button>`).join('');
  $('#carta-panel').setAttribute('aria-labelledby', `tab-${st.categoria}`);
}

function pintarPanel() {
  const panel = $('#carta-panel');
  const platos = st.platos.filter((p) => p.categoria === st.categoria);
  if (!st.platos.length) {
    panel.innerHTML = estadoBloque({ icono: 'pizza', titulo: 'La carta se está actualizando', texto: 'Muy pronto verás aquí todos nuestros productos.' });
    return;
  }

  // Agrupa por subcategoría respetando el orden definido por el administrador.
  const grupos = [];
  for (const p of platos) {
    const nombre = p.subcategoria?.trim() || '';
    let g = grupos.find((x) => x.nombre === nombre);
    if (!g) grupos.push((g = { nombre, platos: [], orden: p.orden }));
    g.platos.push(p);
    g.orden = Math.min(g.orden, p.orden);
  }
  grupos.sort((a, b) => a.orden - b.orden);

  const cat = CATEGORIAS[st.categoria];
  let indice = 0;
  panel.innerHTML = `
    <p class="carta__intro">${esc(cat?.descripcion ?? '')}</p>
    ${grupos.map((g) => `
      <section class="carta__group" ${g.nombre ? `aria-label="${esc(g.nombre)}"` : ''}>
        ${g.nombre ? `<h3 class="carta__group-title">${esc(g.nombre)}</h3>` : ''}
        <div class="platos-grid">
          ${g.platos.map((p) => tarjeta(p, indice++)).join('')}
        </div>
      </section>`).join('')}`;

  $$('.plato__media img', panel).forEach((img) => img.addEventListener('error', () => {
    img.replaceWith(Object.assign(document.createElement('div'), { className: 'plato__fallback', innerHTML: icono('pizza') }));
  }, { once: true }));
}

function tarjeta(p, i) {
  const agotado = !p.disponible;
  return `
    <article class="plato ${agotado ? 'is-agotado' : ''}" style="--delay:${Math.min(i, 10) * 30}ms">
      <div class="plato__media">
        ${p.foto_url
          ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async" width="560" height="560">`
          : `<div class="plato__fallback">${icono('pizza')}</div>`}
        ${agotado ? '<span class="badge badge--muted">No disponible</span>' : ''}
      </div>
      <div class="plato__body">
        <h4 class="plato__name">${esc(p.nombre)}</h4>
        ${p.descripcion ? `<p class="plato__desc">${esc(p.descripcion)}</p>` : '<span></span>'}
        <div class="plato__foot">
          <p class="plato__price">${p.precio > 0 ? formatoCOP(p.precio) : 'Consultar'}</p>
          <span class="plato__avail ${agotado ? 'is-off' : ''}">${agotado ? 'Agotado' : 'Disponible'}</span>
        </div>
      </div>
    </article>`;
}
