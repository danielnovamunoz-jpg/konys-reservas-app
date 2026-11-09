// -----------------------------------------------------------------------------
// Gestión de horarios de atención: jornadas por día, hora de inicio y cierre,
// duración de cada reserva y activación. La base de datos impide que dos
// jornadas activas del mismo día se crucen.
// -----------------------------------------------------------------------------
import { obtenerHorarios, actualizarHorario, crearHorarios, eliminarHorario } from '../api.js';
import { DIAS_SEMANA, DIAS_CORTOS } from '../config.js';
import { esc, icono, hoyISO, diaSemana, aMinutos, deMinutos, hhmm, hora12, rangoHoras, duracionTexto } from '../utils.js';
import { abrirModal, confirmar, notificar, conCarga } from '../ui.js';
import { interruptor, errorCampo } from './comun.js';

export const titulo = 'Horarios';
export const subtitulo = 'Jornadas de atención y duración de cada reserva.';

const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const st = { horarios: [] };
let refrescar = null;
export const alCambiar = (tabla) => { if (tabla === 'horarios') refrescar?.(); };

/** Inicios de turno que genera una jornada. */
function turnos(inicio, fin, duracion) {
  const a = aMinutos(inicio);
  const b = aMinutos(fin);
  const lista = [];
  if (!duracion || b <= a) return lista;
  for (let t = a; t + duracion <= b; t += duracion) lista.push(deMinutos(t));
  return lista;
}

export async function render(cont, ctx) {
  ctx.acciones.innerHTML = `<button class="btn btn--primary" type="button" data-nuevo>${icono('plus')}Nuevo horario</button>`;
  ctx.acciones.querySelector('[data-nuevo]').addEventListener('click', () => abrirFormulario());

  cont.innerHTML = `
    <div class="alert alert--info">${icono('info')}
      <span>Los clientes solo pueden reservar dentro de las jornadas <strong>activas</strong>. Cada jornada se divide en turnos según la duración de la reserva; por ejemplo, de 5:00 a 11:00 p. m. con 60 minutos genera 6 turnos.</span>
    </div>
    <section class="semana" data-semana aria-label="Horarios de la semana">
      ${ORDEN.map(() => '<div class="dia"><div class="dia__body"><div class="skeleton" style="height:90px"></div></div></div>').join('')}
    </section>`;

  const semana = cont.querySelector('[data-semana]');
  semana.addEventListener('click', (e) => {
    const editar = e.target.closest('[data-editar]');
    const borrar = e.target.closest('[data-borrar]');
    const agregar = e.target.closest('[data-agregar]');
    if (editar) abrirFormulario(st.horarios.find((h) => h.id === editar.dataset.editar));
    if (borrar) borrarHorario(st.horarios.find((h) => h.id === borrar.dataset.borrar), borrar);
    if (agregar) abrirFormulario(null, Number(agregar.dataset.agregar));
  });
  semana.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-activo]');
    if (sw) cambiarActivo(st.horarios.find((h) => h.id === sw.dataset.activo), sw);
  });

  refrescar = () => cargar(cont);
  await cargar(cont);
  return () => { refrescar = null; };
}

async function cargar(cont) {
  try {
    st.horarios = await obtenerHorarios();
    if (cont.isConnected) pintar(cont);
  } catch (err) {
    cont.querySelector('[data-semana]').innerHTML = `<div class="alert alert--error" style="grid-column:1/-1">${icono('alert')}<span>${esc(err.message)}</span></div>`;
  }
}

function pintar(cont) {
  const hoy = diaSemana(hoyISO());
  cont.querySelector('[data-semana]').innerHTML = ORDEN.map((d) => {
    const jornadas = st.horarios
      .filter((h) => h.dia_semana === d)
      .sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));
    return `
      <article class="dia ${d === hoy ? 'is-today' : ''}" aria-label="${DIAS_SEMANA[d]}">
        <header class="dia__head">
          <span class="dia__nombre">${DIAS_SEMANA[d]}</span>
          ${d === hoy ? '<span class="dia__hoy">Hoy</span>' : ''}
        </header>
        <div class="dia__body">
          ${jornadas.length ? jornadas.map((h) => {
            const n = turnos(h.hora_inicio, h.hora_fin, h.duracion_slot).length;
            return `
              <div class="jornada ${h.activo ? '' : 'is-off'}">
                <span class="jornada__nombre">${esc(h.jornada)}</span>
                <span class="jornada__horas">${esc(rangoHoras(h.hora_inicio, h.hora_fin))}</span>
                <span class="jornada__meta">${esc(duracionTexto(h.duracion_slot))} por reserva · ${n} ${n === 1 ? 'turno' : 'turnos'}</span>
                <div class="jornada__acciones">
                  ${interruptor({ marcado: h.activo, datos: `data-activo="${h.id}" aria-label="Jornada ${esc(h.jornada)} del ${DIAS_SEMANA[d]} activa"` })}
                  <span>
                    <button class="btn btn-icon" type="button" data-editar="${h.id}" title="Editar" aria-label="Editar ${esc(h.jornada)} del ${DIAS_SEMANA[d]}">${icono('edit')}</button>
                    <button class="btn btn-icon is-danger" type="button" data-borrar="${h.id}" title="Eliminar" aria-label="Eliminar ${esc(h.jornada)} del ${DIAS_SEMANA[d]}">${icono('trash')}</button>
                  </span>
                </div>
              </div>`;
          }).join('') : '<p class="dia__vacio">Sin atención</p>'}
        </div>
        <button class="btn btn--sm btn--ghost dia__add" type="button" data-agregar="${d}">${icono('plus')}Agregar</button>
      </article>`;
  }).join('');
}

async function cambiarActivo(h, sw) {
  sw.disabled = true;
  try {
    await actualizarHorario(h.id, { activo: sw.checked });
    h.activo = sw.checked;
    sw.closest('.jornada').classList.toggle('is-off', !h.activo);
    notificar(`${h.jornada} del ${DIAS_SEMANA[h.dia_semana].toLowerCase()} ${h.activo ? 'activada' : 'desactivada'}.`);
  } catch (err) {
    sw.checked = !sw.checked;
    notificar(err.codigo === '23P01' ? 'No se puede activar: se cruza con otra jornada activa de ese día.' : err.message, 'error');
  } finally {
    sw.disabled = false;
  }
}

async function borrarHorario(h, boton) {
  const ok = await confirmar({
    titulo: `¿Eliminar ${h.jornada} del ${DIAS_SEMANA[h.dia_semana].toLowerCase()}?`,
    mensaje: 'Los clientes ya no podrán reservar en esta jornada. Las reservas existentes se conservan. Si solo es temporal, mejor desactívala.',
    aceptar: 'Eliminar',
    peligro: true,
  });
  if (!ok) return;
  try {
    await conCarga(boton, () => eliminarHorario(h.id));
    notificar('Jornada eliminada.');
    refrescar?.();
  } catch (err) {
    notificar(err.message, 'error');
  }
}

function abrirFormulario(h = null, diaInicial = null) {
  const editar = Boolean(h);
  const dias = editar ? [h.dia_semana] : diaInicial !== null ? [diaInicial] : [1, 2, 3, 4, 5, 6, 0];
  const jornadasExistentes = [...new Set(['Almuerzo', 'Noche', ...st.horarios.map((x) => x.jornada)])];

  const m = abrirModal({
    titulo: editar ? 'Editar jornada' : 'Nuevo horario',
    subtitulo: editar ? `${DIAS_SEMANA[h.dia_semana]} · ${h.jornada}` : 'Puedes crear la misma jornada para varios días a la vez.',
    contenido: `
      <form class="form-stack" id="form-horario" novalidate>
        <div class="field">
          <span class="field__label">${editar ? 'Día' : 'Días de atención'}</span>
          <div class="dias-picker" role="group" aria-label="Días">
            ${ORDEN.map((d) => `
              <label title="${DIAS_SEMANA[d]}">
                <input type="${editar ? 'radio' : 'checkbox'}" name="dias" value="${d}" ${dias.includes(d) ? 'checked' : ''}>
                <span>${DIAS_CORTOS[d]}</span>
              </label>`).join('')}
          </div>
          <p class="field__error" data-error="dias"></p>
        </div>
        <div class="field">
          <label class="field__label" for="h-jornada">Jornada</label>
          <input class="input" id="h-jornada" name="jornada" list="h-jornadas" maxlength="30" required value="${esc(h?.jornada ?? 'Almuerzo')}" placeholder="Ej. Almuerzo, Noche">
          <datalist id="h-jornadas">${jornadasExistentes.map((j) => `<option value="${esc(j)}">`).join('')}</datalist>
          <p class="field__error" data-error="jornada"></p>
        </div>
        <div class="form-cols form-cols--3">
          <div class="field">
            <label class="field__label" for="h-inicio">Hora de inicio</label>
            <input class="input" id="h-inicio" name="inicio" type="time" step="300" required value="${esc(hhmm(h?.hora_inicio ?? '12:30'))}">
          </div>
          <div class="field">
            <label class="field__label" for="h-fin">Hora de cierre</label>
            <input class="input" id="h-fin" name="fin" type="time" step="300" required value="${esc(hhmm(h?.hora_fin ?? '14:30'))}">
          </div>
          <div class="field">
            <label class="field__label" for="h-duracion">Duración reserva</label>
            <select class="select" id="h-duracion" name="duracion">
              ${[30, 45, 60, 90, 120, 150, 180].map((v) => `<option value="${v}" ${(h?.duracion_slot ?? 60) === v ? 'selected' : ''}>${duracionTexto(v)}</option>`).join('')}
            </select>
          </div>
        </div>
        <p class="field__error" data-error="horas"></p>
        <div class="preview-turnos" data-preview aria-live="polite"></div>
        ${interruptor({ nombre: 'activo', marcado: h?.activo ?? true, etiqueta: 'Jornada activa (disponible para reservas)' })}
      </form>`,
    pie: `
      <button type="button" class="btn btn--ghost" data-cerrar>Cancelar</button>
      <button type="submit" class="btn btn--dark" form="form-horario" data-guardar>${icono('check')}${editar ? 'Guardar cambios' : 'Crear horario'}</button>`,
  });

  const form = m.el.querySelector('#form-horario');
  const duracionActual = h?.duracion_slot;
  if (duracionActual && ![30, 45, 60, 90, 120, 150, 180].includes(duracionActual)) {
    form.duracion.insertAdjacentHTML('afterbegin', `<option value="${duracionActual}" selected>${duracionTexto(duracionActual)}</option>`);
  }

  function preview() {
    const lista = turnos(form.inicio.value, form.fin.value, Number(form.duracion.value));
    form.querySelector('[data-preview]').innerHTML = lista.length
      ? `<span>Turnos que verán los clientes (<strong>${lista.length}</strong>):</span>
         <div class="preview-turnos__list">${lista.map((t) => `<span>${esc(hora12(t))}</span>`).join('')}</div>`
      : '<span>Con estos valores no se genera ningún turno. Revisa las horas y la duración.</span>';
  }
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seleccion = [...form.querySelectorAll('[name="dias"]:checked')].map((i) => Number(i.value));
    const jornada = form.jornada.value.trim().replace(/\s+/g, ' ');
    const inicio = form.inicio.value;
    const fin = form.fin.value;
    const duracion = Number(form.duracion.value);
    const n = turnos(inicio, fin, duracion).length;

    const ok = [
      errorCampo(form, 'dias', seleccion.length ? '' : 'Selecciona al menos un día.'),
      errorCampo(form, 'jornada', jornada.length >= 2 ? '' : 'Escribe el nombre de la jornada (ej. Almuerzo).'),
      errorCampo(form, 'horas', !inicio || !fin ? 'Indica la hora de inicio y de cierre.'
        : aMinutos(fin) <= aMinutos(inicio) ? 'La hora de cierre debe ser posterior a la de inicio.'
          : n === 0 ? 'La duración de la reserva no cabe en la jornada.' : ''),
    ].every(Boolean);
    if (!ok) return;

    const campos = { jornada, hora_inicio: inicio, hora_fin: fin, duracion_slot: duracion, activo: form.activo.checked };
    try {
      await conCarga(m.el.querySelector('[data-guardar]'), () => (editar
        ? actualizarHorario(h.id, { ...campos, dia_semana: seleccion[0] })
        : crearHorarios(seleccion.map((d) => ({ ...campos, dia_semana: d })))), 'Guardando…');
      notificar(editar ? 'Horario actualizado.' : `Horario creado para ${seleccion.length} ${seleccion.length === 1 ? 'día' : 'días'}.`);
      m.cerrar();
      refrescar?.();
    } catch (err) {
      if (err.codigo === '23P01') {
        errorCampo(form, 'horas', 'Se cruza con otra jornada activa en alguno de los días seleccionados. Ajusta las horas o desactiva la otra jornada.');
      } else {
        notificar(err.message, 'error');
      }
    }
  });
}
