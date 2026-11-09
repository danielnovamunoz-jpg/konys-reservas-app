// -----------------------------------------------------------------------------
// Gestión de mesas: registrar, editar (nombre, zona, capacidad, foto),
// activar / desactivar y borrar (solo si no tiene historial de reservas).
// -----------------------------------------------------------------------------
import { obtenerMesasAdmin, guardarMesa, eliminarMesa, eliminarFoto, contarReservasFuturas } from '../api.js';
import { ZONAS } from '../config.js';
import { $, $$, esc, icono, hoyISO, fechaMedia } from '../utils.js';
import { abrirModal, confirmar, notificar, conCarga, estadoBloque } from '../ui.js';
import { interruptor, filaVacia, campoFoto, errorCampo } from './comun.js';

export const titulo = 'Mesas';
export const subtitulo = 'Registra, edita y activa las mesas que verán los clientes.';

const st = { mesas: [], zona: '' };
let refrescar = null;
export const alCambiar = (tabla) => { if (tabla === 'mesas') refrescar?.(); };

export async function render(cont, ctx) {
  ctx.acciones.innerHTML = `<button class="btn btn--primary" type="button" data-nueva>${icono('plus')}Nueva mesa</button>`;
  ctx.acciones.querySelector('[data-nueva]').addEventListener('click', () => abrirFormulario());

  cont.innerHTML = `
    <section class="panel">
      <header class="panel__head">
        <div class="segmented" role="group" aria-label="Filtrar por zona" data-zonas>
          <button type="button" data-zona="" aria-pressed="true">Todas</button>
          <button type="button" data-zona="salon" aria-pressed="false">${icono('armchair')}Salón</button>
          <button type="button" data-zona="terraza" aria-pressed="false">${icono('sun')}Terraza</button>
        </div>
        <p class="muted" data-resumen style="font-size:.88rem"></p>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Mesa</th><th>Zona</th><th>Capacidad</th><th>Estado</th><th class="acciones">Acciones</th></tr></thead>
          <tbody data-filas><tr><td colspan="5"><div class="skeleton" style="height:48px"></div></td></tr></tbody>
        </table>
      </div>
    </section>`;

  cont.querySelector('[data-zonas]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zona]');
    if (!b) return;
    st.zona = b.dataset.zona;
    $$('[data-zona]', cont).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintar(cont);
  });

  const tbody = cont.querySelector('[data-filas]');
  tbody.addEventListener('click', (e) => {
    const editar = e.target.closest('[data-editar]');
    const borrar = e.target.closest('[data-borrar]');
    if (editar) abrirFormulario(st.mesas.find((m) => m.id === editar.dataset.editar));
    if (borrar) borrarMesa(st.mesas.find((m) => m.id === borrar.dataset.borrar), borrar);
    if (e.target.closest('[data-nueva-vacia]')) abrirFormulario();
  });
  tbody.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-activa]');
    if (sw) cambiarActiva(st.mesas.find((m) => m.id === sw.dataset.activa), sw);
  });

  refrescar = () => cargar(cont);
  await cargar(cont);
  return () => { refrescar = null; };
}

async function cargar(cont) {
  try {
    st.mesas = (await obtenerMesasAdmin()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    if (cont.isConnected) pintar(cont);
  } catch (err) {
    cont.querySelector('[data-filas]').innerHTML = filaVacia(5, `<div class="panel__body"><div class="alert alert--error">${icono('alert')}<span>${esc(err.message)}</span></div></div>`);
  }
}

function pintar(cont) {
  const filas = st.mesas.filter((m) => !st.zona || m.zona === st.zona);
  const activas = st.mesas.filter((m) => m.activa);
  const capacidad = activas.reduce((s, m) => s + m.capacidad, 0);
  cont.querySelector('[data-resumen]').textContent =
    `${st.mesas.length} mesas · ${activas.length} activas · capacidad activa de ${capacidad} personas`;

  cont.querySelector('[data-filas]').innerHTML = filas.length
    ? filas.map((m) => {
        const zona = ZONAS[m.zona] ?? { nombre: m.zona, icono: 'utensils' };
        const iniciales = (m.nombre.match(/\d+/)?.[0] ?? m.nombre.slice(0, 2)).toUpperCase();
        return `
          <tr class="${m.activa ? '' : 'is-muted'}">
            <td class="col-main" data-label="Mesa">
              <div class="cell-flex">
                ${m.foto_url ? `<img class="thumb" src="${esc(m.foto_url)}" alt="" loading="lazy">` : `<span class="thumb thumb--placeholder" aria-hidden="true">${esc(iniciales)}</span>`}
                <div><span class="cell-main">${esc(m.nombre)}</span><span class="cell-sub">Registrada el ${esc(fechaMedia(m.creado_en.slice(0, 10)).toLowerCase())}</span></div>
              </div>
            </td>
            <td data-label="Zona"><span class="cell-flex" style="gap:6px">${icono(zona.icono)}${esc(zona.nombre)}</span></td>
            <td data-label="Capacidad">${m.capacidad} ${m.capacidad === 1 ? 'persona' : 'personas'}</td>
            <td data-label="Estado">${interruptor({ marcado: m.activa, etiqueta: m.activa ? 'Activa' : 'Inactiva', datos: `data-activa="${m.id}" aria-label="Mesa ${esc(m.nombre)} activa"` })}</td>
            <td class="acciones">
              <button class="btn btn--sm" type="button" data-editar="${m.id}">${icono('edit')}Editar</button>
              <button class="btn btn--sm btn-icon is-danger" type="button" data-borrar="${m.id}" title="Borrar mesa" aria-label="Borrar ${esc(m.nombre)}">${icono('trash')}</button>
            </td>
          </tr>`;
      }).join('')
    : filaVacia(5, estadoBloque({
        icono: 'utensils',
        titulo: st.mesas.length ? 'No hay mesas en esta zona' : 'Aún no hay mesas registradas',
        texto: st.mesas.length ? '' : 'Registra la primera mesa para que los clientes puedan reservar.',
        accion: st.mesas.length ? '' : '<button class="btn btn--primary" type="button" data-nueva-vacia>Registrar mesa</button>',
      }));
}

async function cambiarActiva(mesa, sw) {
  const activar = sw.checked;
  if (!activar) {
    let futuras = 0;
    try { futuras = await contarReservasFuturas(mesa.id, hoyISO()); } catch { /* se continúa */ }
    if (futuras > 0) {
      const ok = await confirmar({
        titulo: `¿Desactivar ${mesa.nombre}?`,
        mensaje: `Tiene ${futuras} ${futuras === 1 ? 'reserva confirmada próxima' : 'reservas confirmadas próximas'}. Seguirán vigentes, pero la mesa no aceptará nuevas reservas.`,
        aceptar: 'Desactivar',
        peligro: true,
      });
      if (!ok) { sw.checked = true; return; }
    }
  }
  sw.disabled = true;
  try {
    await guardarMesa({ id: mesa.id, activa: activar });
    mesa.activa = activar;
    notificar(`${mesa.nombre} ${activar ? 'activada' : 'desactivada'}.`);
    const fila = sw.closest('tr');
    fila.classList.toggle('is-muted', !activar);
    sw.closest('.switch').querySelector('.switch__label').textContent = activar ? 'Activa' : 'Inactiva';
  } catch (err) {
    sw.checked = !activar;
    notificar(err.message, 'error');
  } finally {
    sw.disabled = false;
  }
}

async function borrarMesa(mesa, boton) {
  const ok = await confirmar({
    titulo: `¿Borrar ${mesa.nombre}?`,
    mensaje: 'Esta acción no se puede deshacer. Si la mesa tiene reservas en su historial, no se podrá borrar: en ese caso desactívala.',
    aceptar: 'Borrar mesa',
    peligro: true,
  });
  if (!ok) return;
  try {
    await conCarga(boton, () => eliminarMesa(mesa.id));
    await eliminarFoto(mesa.foto_url);
    notificar(`${mesa.nombre} fue borrada.`);
    refrescar?.();
  } catch (err) {
    const historial = ['23001', '23503'].includes(err.codigo);
    notificar(historial ? `${mesa.nombre} tiene reservas en su historial. Desactívala en lugar de borrarla.` : err.message, 'error', { duracion: 6000 });
  }
}

function abrirFormulario(mesa = null) {
  const editar = Boolean(mesa);
  const m = abrirModal({
    titulo: editar ? `Editar ${mesa.nombre}` : 'Nueva mesa',
    subtitulo: editar ? 'Los cambios se reflejan de inmediato en la página pública.' : 'La mesa aparecerá en la sección de reservas.',
    contenido: `
      <form class="form-stack" id="form-mesa" novalidate>
        <div class="form-cols">
          <div class="field">
            <label class="field__label" for="m-nombre">Nombre o número</label>
            <input class="input" id="m-nombre" name="nombre" maxlength="40" required placeholder="Ej. Mesa 8" value="${esc(mesa?.nombre ?? '')}" autofocus>
            <p class="field__error" data-error="nombre"></p>
          </div>
          <div class="field">
            <label class="field__label" for="m-capacidad">Capacidad (personas)</label>
            <input class="input" id="m-capacidad" name="capacidad" type="number" inputmode="numeric" min="1" max="30" required value="${esc(mesa?.capacidad ?? 4)}">
            <p class="field__error" data-error="capacidad"></p>
          </div>
        </div>
        <div class="field">
          <span class="field__label">Zona</span>
          <div class="segmented" role="radiogroup" aria-label="Zona">
            ${Object.entries(ZONAS).map(([clave, z]) => `
              <label><input type="radio" name="zona" value="${clave}" ${(mesa?.zona ?? 'salon') === clave ? 'checked' : ''}>${icono(z.icono)}${esc(z.nombre)}</label>`).join('')}
          </div>
        </div>
        ${interruptor({ nombre: 'activa', marcado: mesa?.activa ?? true, etiqueta: 'Mesa activa (recibe reservas)' })}
        <div data-foto></div>
      </form>`,
    pie: `
      <button type="button" class="btn btn--ghost" data-cerrar>Cancelar</button>
      <button type="submit" class="btn btn--dark" form="form-mesa" data-guardar>${icono('check')}${editar ? 'Guardar cambios' : 'Registrar mesa'}</button>`,
  });

  const form = m.el.querySelector('#form-mesa');
  const foto = campoFoto(form.querySelector('[data-foto]'), { actual: mesa?.foto_url ?? null, carpeta: 'mesas', etiqueta: 'Fotografía de la mesa' });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim().replace(/\s+/g, ' ');
    const capacidad = Number(form.capacidad.value);
    const valido = [
      errorCampo(form, 'nombre', !nombre ? 'Escribe el nombre o número de la mesa.' : ''),
      errorCampo(form, 'capacidad', !Number.isInteger(capacidad) || capacidad < 1 || capacidad > 30 ? 'La capacidad debe estar entre 1 y 30 personas.' : ''),
    ].every(Boolean);
    if (!valido) return form.querySelector('[aria-invalid="true"]')?.focus();

    try {
      await conCarga(m.el.querySelector('[data-guardar]'), async () => {
        const fotoUrl = await foto.resolver();
        await guardarMesa({
          ...(editar ? { id: mesa.id } : {}),
          nombre,
          capacidad,
          zona: form.zona.value,
          activa: form.activa.checked,
          foto_url: fotoUrl,
        });
        if (editar && foto.cambio && mesa.foto_url && mesa.foto_url !== fotoUrl) await eliminarFoto(mesa.foto_url);
      }, 'Guardando…');
      notificar(editar ? 'Mesa actualizada.' : `${nombre} registrada.`);
      m.cerrar();
      refrescar?.();
    } catch (err) {
      if (err.codigo === '23505') errorCampo(form, 'nombre', 'Ya existe una mesa con ese nombre.');
      else notificar(err.message, 'error');
    }
  });
}
