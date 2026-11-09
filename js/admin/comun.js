// -----------------------------------------------------------------------------
// Utilidades compartidas por las vistas del panel administrativo.
// -----------------------------------------------------------------------------
import { subirFoto } from '../api.js';
import { ESTADOS_RESERVA } from '../config.js';
import { esc, icono } from '../utils.js';

export const badgeEstado = (estado) => {
  const e = ESTADOS_RESERVA[estado] ?? { nombre: estado, tono: 'muted' };
  return `<span class="badge badge--${e.tono}">${esc(e.nombre)}</span>`;
};

export const interruptor = ({ nombre, marcado, etiqueta = '', datos = '', deshabilitado = false }) => `
  <label class="switch">
    <input type="checkbox" ${nombre ? `name="${nombre}"` : ''} ${marcado ? 'checked' : ''} ${datos} ${deshabilitado ? 'disabled' : ''}>
    <span class="switch__track" aria-hidden="true"></span>
    ${etiqueta ? `<span class="switch__label">${esc(etiqueta)}</span>` : ''}
  </label>`;

export const filaVacia = (columnas, contenido) =>
  `<tr class="table-empty"><td colspan="${columnas}">${contenido}</td></tr>`;

/** Controles de paginación. Llama a `alCambiar(pagina)` al hacer clic. */
export function paginacion(contenedor, { total, pagina, porPagina, alCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total ? (pagina - 1) * porPagina + 1 : 0;
  const hasta = Math.min(total, pagina * porPagina);
  const numeros = [];
  for (let i = 1; i <= paginas; i++) {
    if (i === 1 || i === paginas || Math.abs(i - pagina) <= 1) numeros.push(i);
    else if (numeros[numeros.length - 1] !== '…') numeros.push('…');
  }
  contenedor.innerHTML = `
    <span>Mostrando ${desde}–${hasta} de ${total} ${total === 1 ? 'registro' : 'registros'}</span>
    <nav class="pagination" aria-label="Paginación">
      <button type="button" data-pagina="${pagina - 1}" aria-label="Página anterior" ${pagina <= 1 ? 'disabled' : ''}>${icono('chevron-left')}</button>
      ${numeros.map((n) => (n === '…'
        ? '<span aria-hidden="true">…</span>'
        : `<button type="button" data-pagina="${n}" ${n === pagina ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}
      <button type="button" data-pagina="${pagina + 1}" aria-label="Página siguiente" ${pagina >= paginas ? 'disabled' : ''}>${icono('chevron-right')}</button>
    </nav>`;
  contenedor.onclick = (e) => {
    const b = e.target.closest('[data-pagina]');
    if (b && !b.disabled) alCambiar(Number(b.dataset.pagina));
  };
}

/**
 * Campo de fotografía con vista previa. La imagen se sube a Supabase Storage
 * solo al guardar (método `resolver`).
 */
export function campoFoto(contenedor, { actual = null, carpeta, etiqueta = 'Fotografía' }) {
  let archivo = null;
  let quitar = false;
  let urlPrevia = null;

  contenedor.innerHTML = `
    <div class="field">
      <span class="field__label">${esc(etiqueta)} <span class="opcional">Opcional</span></span>
      <div class="foto-field">
        <div class="foto-field__preview" data-preview>${icono('image')}</div>
        <div class="foto-field__actions">
          <span class="btn btn--sm">${icono('upload')}<span data-texto>Subir foto</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Elegir fotografía">
          </span>
          <button type="button" class="btn btn--sm btn--ghost" data-quitar hidden>${icono('trash')}Quitar foto</button>
          <p class="foto-field__hint">JPG, PNG o WebP. Se optimiza automáticamente.</p>
        </div>
      </div>
    </div>`;

  const preview = contenedor.querySelector('[data-preview]');
  const input = contenedor.querySelector('input[type="file"]');
  const botonQuitar = contenedor.querySelector('[data-quitar]');
  const texto = contenedor.querySelector('[data-texto]');

  function pintar(url) {
    preview.querySelector('img')?.remove();
    preview.classList.toggle('has-img', Boolean(url));
    botonQuitar.hidden = !url;
    texto.textContent = url ? 'Cambiar foto' : 'Subir foto';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Vista previa';
      preview.append(img);
    }
  }
  pintar(actual);

  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    archivo = f;
    quitar = false;
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
    urlPrevia = URL.createObjectURL(f);
    pintar(urlPrevia);
  });
  botonQuitar.addEventListener('click', () => {
    archivo = null;
    quitar = true;
    input.value = '';
    pintar(null);
  });

  return {
    /** Sube la foto si cambió y devuelve la URL definitiva (o null). */
    async resolver() {
      if (archivo) return subirFoto(archivo, carpeta);
      if (quitar) return null;
      return actual;
    },
    get cambio() { return Boolean(archivo) || quitar; },
  };
}

/** Lee los valores de un formulario como objeto. */
export const valoresForm = (form) => Object.fromEntries(new FormData(form).entries());

/** Marca un campo con error (o lo limpia con mensaje vacío). */
export function errorCampo(form, nombre, mensaje) {
  const input = form.elements[nombre];
  const salida = form.querySelector(`[data-error="${nombre}"]`);
  if (input?.setAttribute) input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  if (salida) salida.innerHTML = mensaje ? `${icono('alert')}${esc(mensaje)}` : '';
  return !mensaje;
}
