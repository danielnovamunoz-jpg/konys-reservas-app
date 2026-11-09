// -----------------------------------------------------------------------------
// Perfil del administrador: datos de la cuenta, cambio de contraseña (Supabase
// Auth) y cierre de sesión.
// -----------------------------------------------------------------------------
import { cambiarContrasena } from '../api.js';
import { esc, icono, fechaHora } from '../utils.js';
import { notificar, conCarga } from '../ui.js';
import { errorCampo } from './comun.js';

export const titulo = 'Perfil';
export const subtitulo = 'Tu cuenta de administrador.';

export function render(cont, { usuario, perfil, salir }) {
  const nombre = perfil.nombre || usuario.email.split('@')[0];
  cont.innerHTML = `
    <div class="perfil-grid">
      <section class="panel perfil-card" aria-label="Datos de la cuenta">
        <span class="avatar" aria-hidden="true">${esc(nombre.charAt(0).toUpperCase())}</span>
        <h2 class="perfil-card__name">${esc(nombre)}</h2>
        <span class="badge badge--info">Administrador</span>
        <dl class="perfil-datos">
          <div><dt>Correo</dt><dd>${esc(usuario.email)}</dd></div>
          <div><dt>Administrador desde</dt><dd>${esc(fechaHora(perfil.creado_en))}</dd></div>
          ${usuario.last_sign_in_at ? `<div><dt>Último ingreso</dt><dd>${esc(fechaHora(usuario.last_sign_in_at))}</dd></div>` : ''}
        </dl>
        <button class="btn btn--ghost btn--block" type="button" data-salir style="margin-top:12px">${icono('log-out')}Cerrar sesión</button>
      </section>

      <div style="display:grid;gap:24px">
        <section class="panel" aria-labelledby="clave-titulo">
          <header class="panel__head"><h2 class="panel__title" id="clave-titulo">${icono('lock')}Cambiar contraseña</h2></header>
          <form class="panel__body form-stack" data-clave novalidate>
            <div class="form-cols">
              <div class="field">
                <label class="field__label" for="c-nueva">Nueva contraseña</label>
                <input class="input" id="c-nueva" name="nueva" type="password" autocomplete="new-password" minlength="8" required>
                <p class="field__error" data-error="nueva"></p>
              </div>
              <div class="field">
                <label class="field__label" for="c-confirmar">Confirmar contraseña</label>
                <input class="input" id="c-confirmar" name="confirmar" type="password" autocomplete="new-password" minlength="8" required>
                <p class="field__error" data-error="confirmar"></p>
              </div>
            </div>
            <p class="field__hint">Mínimo 8 caracteres. Usa una combinación de letras, números y símbolos.</p>
            <div><button class="btn btn--dark" type="submit" data-guardar>${icono('check')}Actualizar contraseña</button></div>
          </form>
        </section>

        <section class="panel" aria-labelledby="admins-titulo">
          <header class="panel__head"><h2 class="panel__title" id="admins-titulo">${icono('users')}Agregar otro administrador</h2></header>
          <div class="panel__body form-stack">
            <p class="muted" style="font-size:.92rem">Por seguridad, los administradores se gestionan desde Supabase y no desde esta página:</p>
            <ol style="padding-left:20px;display:grid;gap:6px;font-size:.92rem;color:var(--gray-700)">
              <li>En Supabase: <strong>Authentication → Users → Add user</strong> (correo y contraseña).</li>
              <li>En <strong>SQL Editor</strong>, ejecuta:</li>
            </ol>
            <pre class="code">insert into public.administradores (user_id, nombre)
select id, 'Nombre del administrador'
from auth.users where email = 'correo@ejemplo.com';</pre>
          </div>
        </section>
      </div>
    </div>`;

  cont.querySelector('[data-salir]').addEventListener('click', salir);

  const form = cont.querySelector('[data-clave]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nueva = form.nueva.value;
    const conf = form.confirmar.value;
    const ok = [
      errorCampo(form, 'nueva', nueva.length < 8 ? 'Debe tener al menos 8 caracteres.' : ''),
      errorCampo(form, 'confirmar', nueva !== conf ? 'Las contraseñas no coinciden.' : ''),
    ].every(Boolean);
    if (!ok) return;
    try {
      await conCarga(form.querySelector('[data-guardar]'), () => cambiarContrasena(nueva), 'Actualizando…');
      form.reset();
      notificar('Contraseña actualizada correctamente.');
    } catch (err) {
      notificar(err.message, 'error');
    }
  });
}
