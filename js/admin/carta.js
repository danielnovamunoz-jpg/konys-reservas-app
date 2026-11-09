// -----------------------------------------------------------------------------
// Gestión de la carta: crear, editar, eliminar productos, asignar categoría,
// precio, descripción, fotografía y disponibilidad. La carta pública se
// actualiza en vivo con estos cambios.
// -----------------------------------------------------------------------------
import { obtenerPlatos, guardarPlato, eliminarPlato, eliminarFoto } from '../api.js';
import { CATEGORIAS } from '../config.js';
import { $$, esc, icono, formatoCOP, normalizar, debounce } from '../utils.js';
import { abrirModal, confirmar, notificar, conCarga, estadoBloque } from '../ui.js';
import { interruptor, filaVacia, campoFoto, errorCampo } from './comun.js';

export const titulo = 'Carta';
export const subtitulo = 'Productos, precios y disponibilidad de la carta pública.';

const st = { platos: [], categoria: '', busqueda: '' };
let refrescar = null;
export const alCambiar = (tabla) => { if (tabla === 'platos') refrescar?.(); };

export async function render(cont, ctx) {
  ctx.acciones.innerHTML = `<button class="btn btn--primary" type="button" data-nuevo>${icono('plus')}Nuevo producto</button>`;
  ctx.acciones.querySelector('[data-nuevo]').addEventListener('click', () => abrirFormulario());

  cont.innerHTML = `
    <section class="panel">
      <div class="panel__head">
        <div class="chips" role="group" aria-label="Categoría" data-categorias></div>
        <div class="input-icon" style="min-width:min(260px,100%)">
          ${icono('search')}
          <input class="input" type="search" placeholder="Buscar producto…" aria-label="Buscar producto" data-buscar value="${esc(st.busqueda)}">
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th>Disponible</th><th class="acciones">Acciones</th></tr></thead>
          <tbody data-filas><tr><td colspan="5"><div class="skeleton" style="height:48px"></div></td></tr></tbody>
        </table>
      </div>
      <footer class="panel__foot" data-pie></footer>
    </section>`;

  cont.querySelector('[data-categorias]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-categoria]');
    if (!b) return;
    st.categoria = b.dataset.categoria;
    pintar(cont);
  });
  cont.querySelector('[data-buscar]').addEventListener('input', debounce((e) => {
    st.busqueda = e.target.value;
    pintar(cont);
  }, 200));

  const tbody = cont.querySelector('[data-filas]');
  tbody.addEventListener('click', (e) => {
    const editar = e.target.closest('[data-editar]');
    const borrar = e.target.closest('[data-borrar]');
    if (editar) abrirFormulario(st.platos.find((p) => p.id === editar.dataset.editar));
    if (borrar) borrarPlato(st.platos.find((p) => p.id === borrar.dataset.borrar), borrar);
  });
  tbody.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-disponible]');
    if (sw) cambiarDisponible(st.platos.find((p) => p.id === sw.dataset.disponible), sw);
  });

  refrescar = () => cargar(cont);
  await cargar(cont);
  return () => { refrescar = null; };
}

async function cargar(cont) {
  try {
    st.platos = await obtenerPlatos();
    if (cont.isConnected) pintar(cont);
  } catch (err) {
    cont.querySelector('[data-filas]').innerHTML = filaVacia(5, `<div class="panel__body"><div class="alert alert--error">${icono('alert')}<span>${esc(err.message)}</span></div></div>`);
  }
}

function pintar(cont) {
  const conteo = (c) => st.platos.filter((p) => !c || p.categoria === c).length;
  cont.querySelector('[data-categorias]').innerHTML = [['', { nombre: 'Todas' }], ...Object.entries(CATEGORIAS)]
    .map(([k, c]) => `<button type="button" class="chip-btn" data-categoria="${k}" aria-pressed="${st.categoria === k}">${esc(c.nombre)}<span class="count">${conteo(k)}</span></button>`)
    .join('');

  const q = normalizar(st.busqueda);
  const ordenCat = Object.keys(CATEGORIAS);
  const filas = st.platos
    .filter((p) => (!st.categoria || p.categoria === st.categoria)
      && (!q || normalizar(`${p.nombre} ${p.subcategoria ?? ''} ${p.descripcion ?? ''}`).includes(q)))
    .sort((a, b) => ordenCat.indexOf(a.categoria) - ordenCat.indexOf(b.categoria) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));

  cont.querySelector('[data-filas]').innerHTML = filas.length
    ? filas.map((p) => `
      <tr class="${p.disponible ? '' : 'is-muted'}">
        <td class="col-main" data-label="Producto">
          <div class="cell-flex">
            ${p.foto_url ? `<img class="thumb" src="${esc(p.foto_url)}" alt="" loading="lazy">` : `<span class="thumb thumb--placeholder">${icono('pizza')}</span>`}
            <div style="min-width:0"><span class="cell-main">${esc(p.nombre)}</span><span class="cell-sub">${esc(p.subcategoria || 'Sin subcategoría')}</span></div>
          </div>
        </td>
        <td data-label="Categoría">${esc(CATEGORIAS[p.categoria]?.nombre ?? p.categoria)}</td>
        <td data-label="Precio" class="num nowrap"><strong>${p.precio > 0 ? formatoCOP(p.precio) : 'Consultar'}</strong></td>
        <td data-label="Disponible">${interruptor({ marcado: p.disponible, etiqueta: p.disponible ? 'Sí' : 'No', datos: `data-disponible="${p.id}" aria-label="${esc(p.nombre)} disponible"` })}</td>
        <td class="acciones">
          <button class="btn btn--sm" type="button" data-editar="${p.id}">${icono('edit')}Editar</button>
          <button class="btn btn--sm btn-icon is-danger" type="button" data-borrar="${p.id}" title="Eliminar producto" aria-label="Eliminar ${esc(p.nombre)}">${icono('trash')}</button>
        </td>
      </tr>`).join('')
    : filaVacia(5, estadoBloque({ icono: 'search', titulo: 'No se encontraron productos', texto: st.platos.length ? 'Ajusta la búsqueda o la categoría.' : 'Crea el primer producto de la carta.' }));

  const disponibles = st.platos.filter((p) => p.disponible).length;
  cont.querySelector('[data-pie]').innerHTML = `<span>${filas.length} de ${st.platos.length} productos · ${disponibles} disponibles en la carta pública</span>`;
}

async function cambiarDisponible(p, sw) {
  sw.disabled = true;
  try {
    await guardarPlato({ id: p.id, disponible: sw.checked });
    p.disponible = sw.checked;
    sw.closest('tr').classList.toggle('is-muted', !p.disponible);
    sw.closest('.switch').querySelector('.switch__label').textContent = p.disponible ? 'Sí' : 'No';
    notificar(`${p.nombre}: ${p.disponible ? 'disponible' : 'no disponible'} en la carta.`);
  } catch (err) {
    sw.checked = !sw.checked;
    notificar(err.message, 'error');
  } finally {
    sw.disabled = false;
  }
}

async function borrarPlato(p, boton) {
  const ok = await confirmar({
    titulo: `¿Eliminar "${p.nombre}"?`,
    mensaje: 'El producto desaparecerá de la carta pública. Esta acción no se puede deshacer. Si solo está agotado, desactiva su disponibilidad.',
    aceptar: 'Eliminar',
    peligro: true,
  });
  if (!ok) return;
  try {
    await conCarga(boton, () => eliminarPlato(p.id));
    await eliminarFoto(p.foto_url);
    notificar('Producto eliminado.');
    refrescar?.();
  } catch (err) {
    notificar(err.message, 'error');
  }
}

function abrirFormulario(p = null) {
  const editar = Boolean(p);
  const subcategorias = (cat) => [...new Set(st.platos.filter((x) => x.categoria === cat && x.subcategoria).map((x) => x.subcategoria))];
  const categoriaInicial = p?.categoria ?? (st.categoria || 'pizzas');

  const m = abrirModal({
    titulo: editar ? 'Editar producto' : 'Nuevo producto',
    subtitulo: editar ? p.nombre : 'Aparecerá de inmediato en la carta pública.',
    contenido: `
      <form class="form-stack" id="form-plato" novalidate>
        <div class="field">
          <label class="field__label" for="p-nombre">Nombre</label>
          <input class="input" id="p-nombre" name="nombre" maxlength="80" required value="${esc(p?.nombre ?? '')}" placeholder="Ej. Hawaiana" autofocus>
          <p class="field__error" data-error="nombre"></p>
        </div>
        <div class="form-cols">
          <div class="field">
            <label class="field__label" for="p-categoria">Categoría</label>
            <select class="select" id="p-categoria" name="categoria">
              ${Object.entries(CATEGORIAS).map(([k, c]) => `<option value="${k}" ${categoriaInicial === k ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="p-sub">Subcategoría <span class="opcional">Opcional</span></label>
            <input class="input" id="p-sub" name="subcategoria" list="p-subs" maxlength="40" value="${esc(p?.subcategoria ?? '')}" placeholder="Ej. Konys clásicas">
            <datalist id="p-subs"></datalist>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="p-desc">Descripción <span class="char-count" data-contador></span></label>
          <textarea class="textarea" id="p-desc" name="descripcion" maxlength="600" rows="3" placeholder="Ingredientes y detalles del producto">${esc(p?.descripcion ?? '')}</textarea>
        </div>
        <div class="form-cols">
          <div class="field">
            <label class="field__label" for="p-precio">Precio (COP) <span class="precio-preview" data-precio></span></label>
            <input class="input" id="p-precio" name="precio" type="number" inputmode="numeric" min="0" step="100" required value="${esc(p?.precio ?? '')}" placeholder="27900">
            <p class="field__error" data-error="precio"></p>
          </div>
          <div class="field">
            <label class="field__label" for="p-orden">Orden en la carta</label>
            <input class="input" id="p-orden" name="orden" type="number" inputmode="numeric" min="0" max="999" value="${esc(p?.orden ?? 0)}">
            <p class="field__hint">Menor número = aparece primero.</p>
          </div>
        </div>
        ${interruptor({ nombre: 'disponible', marcado: p?.disponible ?? true, etiqueta: 'Disponible en la carta' })}
        <div data-foto></div>
      </form>`,
    pie: `
      <button type="button" class="btn btn--ghost" data-cerrar>Cancelar</button>
      <button type="submit" class="btn btn--dark" form="form-plato" data-guardar>${icono('check')}${editar ? 'Guardar cambios' : 'Crear producto'}</button>`,
  });

  const form = m.el.querySelector('#form-plato');
  const foto = campoFoto(form.querySelector('[data-foto]'), { actual: p?.foto_url ?? null, carpeta: 'platos', etiqueta: 'Fotografía del producto' });
  const actualizarSubs = () => {
    form.querySelector('#p-subs').innerHTML = subcategorias(form.categoria.value).map((s) => `<option value="${esc(s)}">`).join('');
  };
  const actualizarContador = () => { form.querySelector('[data-contador]').textContent = `${form.descripcion.value.length}/600`; };
  const actualizarPrecio = () => {
    const v = Number(form.precio.value);
    form.querySelector('[data-precio]').textContent = form.precio.value !== '' && v >= 0 ? formatoCOP(v) : '';
  };
  form.categoria.addEventListener('change', actualizarSubs);
  form.descripcion.addEventListener('input', actualizarContador);
  form.precio.addEventListener('input', actualizarPrecio);
  actualizarSubs();
  actualizarContador();
  actualizarPrecio();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim().replace(/\s+/g, ' ');
    const precio = Number(form.precio.value);
    const ok = [
      errorCampo(form, 'nombre', nombre.length < 2 ? 'Escribe el nombre del producto (mínimo 2 caracteres).' : ''),
      errorCampo(form, 'precio', form.precio.value === '' || !Number.isInteger(precio) || precio < 0 || precio > 5000000 ? 'Escribe un precio válido en pesos, sin puntos ni decimales.' : ''),
    ].every(Boolean);
    if (!ok) return form.querySelector('[aria-invalid="true"]')?.focus();

    try {
      await conCarga(m.el.querySelector('[data-guardar]'), async () => {
        const fotoUrl = await foto.resolver();
        await guardarPlato({
          ...(editar ? { id: p.id } : {}),
          nombre,
          categoria: form.categoria.value,
          subcategoria: form.subcategoria.value.trim() || null,
          descripcion: form.descripcion.value.trim() || null,
          precio,
          orden: Number(form.orden.value) || 0,
          disponible: form.disponible.checked,
          foto_url: fotoUrl,
        });
        if (editar && foto.cambio && p.foto_url && p.foto_url !== fotoUrl) await eliminarFoto(p.foto_url);
      }, 'Guardando…');
      notificar(editar ? 'Producto actualizado.' : `${nombre} agregado a la carta.`);
      m.cerrar();
      refrescar?.();
    } catch (err) {
      notificar(err.message, 'error');
    }
  });
}
