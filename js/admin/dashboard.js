// -----------------------------------------------------------------------------
// Dashboard: indicadores calculados en la base de datos (resumen_dashboard),
// agenda del día y reservas recientes.
// -----------------------------------------------------------------------------
import { resumenDashboard, reservasDelDia, reservasRecientes, cambiarEstadoReserva } from '../api.js';
import { ZONAS } from '../config.js';
import { esc, icono, hoyISO, fechaLarga, fechaMedia, hora12, hora12Partes, ahoraHHMM, aMinutos, fechaHora } from '../utils.js';
import { notificar, conCarga, estadoBloque } from '../ui.js';
import { badgeEstado, filaVacia } from './comun.js';

export const titulo = 'Dashboard';

let refrescar = null;
export const alCambiar = () => refrescar?.();

export async function render(cont, ctx) {
  ctx.subtitulo(fechaLarga(hoyISO()));
  ctx.acciones.innerHTML = `<a class="btn btn--primary" href="#/reservas">${icono('clipboard')}Gestionar reservas</a>`;

  cont.innerHTML = `
    <section class="kpis" id="kpis" aria-label="Indicadores generales">
      ${'<div class="kpi"><div class="skeleton" style="height:36px;width:36px"></div><div class="skeleton" style="height:30px;width:50%"></div><div class="skeleton" style="height:12px"></div></div>'.repeat(6)}
    </section>
    <div class="dash-grid">
      <section class="panel" aria-labelledby="agenda-titulo">
        <header class="panel__head">
          <h2 class="panel__title" id="agenda-titulo">${icono('calendar')}Agenda de hoy</h2>
          <a class="btn btn--sm btn--ghost" href="#/reservas">Ver todas</a>
        </header>
        <div id="agenda"><div class="panel__body"><div class="skeleton" style="height:52px"></div></div></div>
      </section>
      <section class="panel" aria-labelledby="recientes-titulo">
        <header class="panel__head">
          <h2 class="panel__title" id="recientes-titulo">${icono('clock')}Reservas recientes</h2>
          <span class="muted" style="font-size:.82rem">Últimas registradas en el sistema</span>
        </header>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Cliente</th><th>Mesa</th><th>Fecha</th><th>Hora</th><th class="num">Pers.</th><th>Estado</th></tr></thead>
            <tbody id="recientes"><tr><td colspan="6"><div class="skeleton" style="height:40px"></div></td></tr></tbody>
          </table>
        </div>
      </section>
    </div>`;

  cont.querySelector('#agenda').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-completar]');
    if (!b) return;
    try {
      await conCarga(b, () => cambiarEstadoReserva(b.dataset.completar, 'completada'));
      notificar('Reserva marcada como completada.');
      cargar(cont);
    } catch (err) {
      notificar(err.message, 'error');
    }
  });

  refrescar = () => cargar(cont);
  await cargar(cont);
  return () => { refrescar = null; };
}

async function cargar(cont) {
  const hoy = hoyISO();
  const [r1, r2, r3] = await Promise.allSettled([resumenDashboard(), reservasDelDia(hoy), reservasRecientes(6)]);
  if (!cont.isConnected) return;

  // ---------- Indicadores ----------
  const kpis = cont.querySelector('#kpis');
  if (r1.status === 'fulfilled') {
    const d = r1.value;
    const tarjeta = (i, { valor, etiqueta, sub, ic, destacado = false }) => `
      <article class="kpi ${destacado ? 'kpi--destacado' : ''}" style="--delay:${i * 50}ms">
        <span class="kpi__icon">${icono(ic)}</span>
        <span class="kpi__value">${esc(valor)}</span>
        <span class="kpi__label">${esc(etiqueta)}</span>
        <span class="kpi__sub">${esc(sub)}</span>
      </article>`;
    kpis.innerHTML = [
      { valor: d.reservas_hoy, etiqueta: 'Reservas del día', sub: `${d.personas_hoy} ${d.personas_hoy === 1 ? 'persona esperada' : 'personas esperadas'}`, ic: 'calendar', destacado: true },
      { valor: d.reservas_confirmadas, etiqueta: 'Reservas confirmadas', sub: `${d.confirmadas_proximas} próximas por atender`, ic: 'check-circle' },
      { valor: d.total_reservas, etiqueta: 'Total de reservas', sub: `${d.reservas_completadas} completadas · ${d.reservas_canceladas} canceladas`, ic: 'clipboard' },
      { valor: d.mesas_disponibles, etiqueta: 'Mesas disponibles', sub: 'Con horarios libres hoy', ic: 'utensils' },
      { valor: d.mesas_activas, etiqueta: 'Mesas activas', sub: `De ${d.mesas_registradas} registradas`, ic: 'check' },
      { valor: d.mesas_registradas, etiqueta: 'Mesas registradas', sub: `${d.mesas_registradas - d.mesas_activas} inactivas`, ic: 'armchair' },
    ].map((k, i) => tarjeta(i, k)).join('');
  } else {
    kpis.innerHTML = `<div class="alert alert--error" style="grid-column:1/-1">${icono('alert')}<span>No se pudieron calcular los indicadores: ${esc(r1.reason.message)}</span></div>`;
  }

  // ---------- Agenda del día ----------
  const agenda = cont.querySelector('#agenda');
  if (r2.status === 'fulfilled') {
    const filas = r2.value;
    const ahora = aMinutos(ahoraHHMM());
    agenda.innerHTML = filas.length
      ? `<ul class="agenda" role="list">${filas.map((r) => {
          const p = hora12Partes(r.hora_inicio);
          const pasada = aMinutos(r.hora_fin) <= ahora;
          return `
            <li class="agenda__item ${pasada ? 'is-pasada' : ''}">
              <span class="agenda__hora">${p.hora}<small>${p.sufijo}</small></span>
              <div>
                <p class="agenda__cliente">${esc(r.cliente_nombre)}</p>
                <p class="agenda__meta">${esc(r.mesa_nombre)} · ${esc(ZONAS[r.mesa_zona]?.nombre ?? r.mesa_zona)} · ${r.num_personas} pers.${r.cliente_contacto ? ` · ${esc(r.cliente_contacto)}` : ''}</p>
              </div>
              ${r.estado === 'confirmada'
                ? `<button class="btn btn--sm btn--ghost" type="button" data-completar="${r.id}" title="Marcar como completada">${icono('check')}Completar</button>`
                : badgeEstado(r.estado)}
            </li>`;
        }).join('')}</ul>`
      : estadoBloque({ icono: 'calendar', titulo: 'Sin reservas para hoy', texto: 'Cuando un cliente reserve para hoy, aparecerá aquí.' });
  } else {
    agenda.innerHTML = `<div class="panel__body"><div class="alert alert--error">${icono('alert')}<span>${esc(r2.reason.message)}</span></div></div>`;
  }

  // ---------- Recientes ----------
  const tbody = cont.querySelector('#recientes');
  if (r3.status === 'fulfilled') {
    tbody.innerHTML = r3.value.length
      ? r3.value.map((r) => `
        <tr>
          <td class="col-main" data-label="Cliente"><span class="cell-main">${esc(r.cliente_nombre)}</span><span class="cell-sub">Registrada ${esc(fechaHora(r.creado_en))}</span></td>
          <td data-label="Mesa">${esc(r.mesa_nombre)}<span class="cell-sub">${esc(ZONAS[r.mesa_zona]?.nombre ?? r.mesa_zona)}</span></td>
          <td data-label="Fecha" class="nowrap">${esc(fechaMedia(r.fecha))}</td>
          <td data-label="Hora" class="nowrap">${esc(hora12(r.hora_inicio))}</td>
          <td data-label="Personas" class="num">${r.num_personas}</td>
          <td data-label="Estado">${badgeEstado(r.estado)}</td>
        </tr>`).join('')
      : filaVacia(6, estadoBloque({ icono: 'clipboard', titulo: 'Aún no hay reservas', texto: 'Las reservas hechas desde la página pública aparecerán aquí.' }));
  } else {
    tbody.innerHTML = filaVacia(6, `<div class="panel__body"><div class="alert alert--error">${icono('alert')}<span>${esc(r3.reason.message)}</span></div></div>`);
  }
}
