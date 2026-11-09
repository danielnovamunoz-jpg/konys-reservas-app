// -----------------------------------------------------------------------------
// Gestión de reservas: tabla con filtros (fecha, mesa, estado), paginación y
// cambio de estado. Cancelar una reserva libera el horario automáticamente
// (la restricción de la base de datos ignora las canceladas).
// -----------------------------------------------------------------------------
import { obtenerReservas, obtenerMesasAdmin, cambiarEstadoReserva } from '../api.js';
import { ZONAS, ESTADOS_RESERVA } from '../config.js';
import { $$, esc, icono, hoyISO, fechaMedia, rangoHoras, fechaHora, codigoReserva } from '../utils.js';
import { confirmar, notificar, estadoBloque } from '../ui.js';
import { filaVacia, paginacion } from './comun.js';

export const titulo = 'Reservas';
export const subtitulo = 'Consulta las reservas y actualiza su estado.';

const POR_PAGINA = 10;
const PERIODOS = {
  proximas: { nombre: 'Próximas', filtros: () => ({ desde: hoyISO(), orden: 'asc' }) },
  hoy: { nombre: 'Hoy', filtros: () => ({ fecha: hoyISO(), orden: 'asc' }) },
  anteriores: { nombre: 'Anteriores', filtros: () => ({ hasta: sumarDia(hoyISO(), -1), orden: 'desc' }) },
  todas: { nombre: 'Todas', filtros: () => ({ orden: 'desc' }) },
};
function sumarDia(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const st = { periodo: 'proximas', fecha: '', mesaId: '', estado: '', pagina: 1, mesas: [], filas: [], ultimaCarga: 0 };
let refrescar = null;
export const alCambiar = (tabla) => { if (tabla === 'reservas' || tabla === 'mesas') refrescar?.(); };

export async function render(cont) {
  st.pagina = 1;
  cont.innerHTML = `
    <section class="panel">
      <form class="panel__body toolbar" data-filtros novalidate>
        <div class="field">
          <label class="field__label" for="f-fecha">Fecha</label>
          <input class="input" type="date" id="f-fecha" name="fecha" value="${esc(st.fecha)}">
        </div>
        <div class="field">
          <label class="field__label" for="f-mesa">Mesa</label>
          <select class="select" id="f-mesa" name="mesa"><option value="">Todas las mesas</option></select>
        </div>
        <div class="field">
          <label class="field__label" for="f-estado">Estado</label>
          <select class="select" id="f-estado" name="estado">
            <option value="">Todos los estados</option>
            ${Object.entries(ESTADOS_RESERVA).map(([k, v]) => `<option value="${k}" ${st.estado === k ? 'selected' : ''}>${v.nombre}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn--dark" type="submit">${icono('filter')}Filtrar</button>
        <button class="btn btn--ghost" type="button" data-limpiar>Limpiar</button>
      </form>
      <div class="panel__head" style="border-top:1px solid var(--gray-100)">
        <div class="chips" role="group" aria-label="Periodo" data-periodos>
          ${Object.entries(PERIODOS).map(([k, p]) => `<button type="button" class="chip-btn" data-periodo="${k}" aria-pressed="${!st.fecha && st.periodo === k}">${p.nombre}</button>`).join('')}
        </div>
        <p class="muted" style="font-size:.85rem" data-descripcion></p>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Cliente</th><th>Mesa</th><th>Fecha</th><th>Hora</th><th class="num">Pers.</th><th>Estado</th></tr></thead>
          <tbody data-filas><tr><td colspan="6"><div class="skeleton" style="height:48px"></div></td></tr></tbody>
        </table>
      </div>
      <footer class="panel__foot" data-paginacion></footer>
    </section>`;

  const form = cont.querySelector('[data-filtros]');
  const aplicar = () => {
    st.fecha = form.fecha.value;
    st.mesaId = form.mesa.value;
    st.estado = form.estado.value;
    st.pagina = 1;
    marcarPeriodos(cont);
    cargar(cont);
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); aplicar(); });
  form.fecha.addEventListener('change', aplicar);
  form.mesa.addEventListener('change', aplicar);
  form.estado.addEventListener('change', aplicar);
  cont.querySelector('[data-limpiar]').addEventListener('click', () => {
    form.reset();
    form.fecha.value = '';
    st.periodo = 'proximas';
    aplicar();
  });
  cont.querySelector('[data-periodos]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-periodo]');
    if (!b) return;
    st.periodo = b.dataset.periodo;
    st.fecha = '';
    form.fecha.value = '';
    st.pagina = 1;
    marcarPeriodos(cont);
    cargar(cont);
  });
  cont.querySelector('[data-filas]').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-estado]');
    if (sel) cambiarEstado(sel, cont);
  });

  try {
    st.mesas = (await obtenerMesasAdmin()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    form.mesa.insertAdjacentHTML('beforeend', st.mesas.map((m) => `<option value="${m.id}" ${st.mesaId === m.id ? 'selected' : ''}>${esc(m.nombre)}</option>`).join(''));
  } catch { /* el filtro de mesa queda vacío */ }

  refrescar = () => cargar(cont, { silencioso: true });
  await cargar(cont);
  return () => { refrescar = null; };
}

function marcarPeriodos(cont) {
  $$('[data-periodo]', cont).forEach((b) => b.setAttribute('aria-pressed', String(!st.fecha && b.dataset.periodo === st.periodo)));
}

function filtrosActuales() {
  const base = st.fecha ? { fecha: st.fecha, orden: 'asc' } : PERIODOS[st.periodo].filtros();
  return { ...base, mesaId: st.mesaId || undefined, estado: st.estado || undefined };
}

async function cargar(cont, { silencioso = false } = {}) {
  const tbody = cont.querySelector('[data-filas]');
  const filtros = filtrosActuales();
  const id = ++st.ultimaCarga;
  if (!silencioso) tbody.style.opacity = '0.55';
  try {
    const { filas, total } = await obtenerReservas({ ...filtros, pagina: st.pagina, porPagina: POR_PAGINA });
    if (id !== st.ultimaCarga || !cont.isConnected) return;
    // Si la página quedó vacía tras un cambio, retrocede una.
    if (!filas.length && st.pagina > 1) {
      st.pagina -= 1;
      return cargar(cont, { silencioso });
    }
    const previas = new Set(st.filas.map((f) => f.id));
    st.filas = filas;
    tbody.innerHTML = filas.length ? filas.map((r) => fila(r, silencioso && previas.size && !previas.has(r.id))).join('') : filaVacia(6, estadoBloque({
      icono: 'clipboard',
      titulo: 'No hay reservas con estos filtros',
      texto: 'Prueba con otra fecha, mesa o estado.',
    }));
    const desc = st.fecha ? `Reservas del ${fechaMedia(st.fecha).toLowerCase()}` : {
      proximas: 'Desde hoy en adelante, de la más cercana a la más lejana',
      hoy: `Reservas de hoy, ${fechaMedia(hoyISO()).toLowerCase()}`,
      anteriores: 'Historial de días anteriores, de la más reciente a la más antigua',
      todas: 'Todo el historial, de la más reciente a la más antigua',
    }[st.periodo];
    cont.querySelector('[data-descripcion]').textContent = desc;
    paginacion(cont.querySelector('[data-paginacion]'), {
      total, pagina: st.pagina, porPagina: POR_PAGINA,
      alCambiar: (p) => { st.pagina = p; cargar(cont); },
    });
  } catch (err) {
    if (id !== st.ultimaCarga) return;
    tbody.innerHTML = filaVacia(6, `<div class="panel__body"><div class="alert alert--error">${icono('alert')}<span>${esc(err.message)}</span></div></div>`);
  } finally {
    tbody.style.opacity = '';
  }
}

function fila(r, nueva) {
  const zona = ZONAS[r.mesa_zona]?.nombre ?? r.mesa_zona;
  return `
    <tr class="${r.estado === 'cancelada' ? 'is-muted' : ''} ${nueva ? 'is-nueva' : ''}">
      <td class="col-main" data-label="Cliente">
        <span class="cell-main">${esc(r.cliente_nombre)}</span>
        <span class="cell-sub">${r.cliente_contacto
          ? `<a class="link" href="https://wa.me/${esc(r.cliente_contacto.replace(/\D/g, '').replace(/^(?!57)(3\d{9})$/, '57$1'))}" target="_blank" rel="noopener">${esc(r.cliente_contacto)}</a>`
          : 'Sin contacto'} · ${esc(codigoReserva(r.id))}</span>
      </td>
      <td data-label="Mesa" class="nowrap">${esc(r.mesa_nombre)}<span class="cell-sub">${esc(zona)}</span></td>
      <td data-label="Fecha" class="nowrap">${esc(fechaMedia(r.fecha))}<span class="cell-sub">Reservó ${esc(fechaHora(r.creado_en))}</span></td>
      <td data-label="Hora" class="nowrap">${esc(rangoHoras(r.hora_inicio, r.hora_fin))}</td>
      <td data-label="Personas" class="num">${r.num_personas}</td>
      <td data-label="Estado">
        <select class="select estado-select estado-select--${r.estado}" data-estado="${r.id}" data-actual="${r.estado}" aria-label="Estado de la reserva de ${esc(r.cliente_nombre)}">
          ${Object.entries(ESTADOS_RESERVA).map(([k, v]) => `<option value="${k}" ${k === r.estado ? 'selected' : ''}>${v.nombre}</option>`).join('')}
        </select>
      </td>
    </tr>`;
}

async function cambiarEstado(sel, cont) {
  const r = st.filas.find((f) => f.id === sel.dataset.estado);
  const anterior = sel.dataset.actual;
  const nuevo = sel.value;
  if (nuevo === 'cancelada') {
    const ok = await confirmar({
      titulo: '¿Cancelar esta reserva?',
      mensaje: `Se cancelará la reserva de ${r.cliente_nombre} (${r.mesa_nombre} · ${fechaMedia(r.fecha)}, ${rangoHoras(r.hora_inicio, r.hora_fin)}) y el horario quedará libre para otros clientes.`,
      aceptar: 'Cancelar reserva',
      cancelar: 'Volver',
      peligro: true,
    });
    if (!ok) { sel.value = anterior; return; }
  }
  sel.disabled = true;
  try {
    await cambiarEstadoReserva(r.id, nuevo);
    sel.dataset.actual = nuevo;
    sel.className = `select estado-select estado-select--${nuevo}`;
    sel.closest('tr').classList.toggle('is-muted', nuevo === 'cancelada');
    r.estado = nuevo;
    notificar(`Reserva de ${r.cliente_nombre} marcada como ${ESTADOS_RESERVA[nuevo].nombre.toLowerCase()}.`);
  } catch (err) {
    sel.value = anterior;
    const msg = err.codigo === '23P01'
      ? 'No se puede reactivar: ese horario ya fue tomado por otra reserva.'
      : err.message;
    notificar(msg, 'error', { duracion: 6000 });
  } finally {
    sel.disabled = false;
    if (st.estado) cargar(cont, { silencioso: true });
  }
}
