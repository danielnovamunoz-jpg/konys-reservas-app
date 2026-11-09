// -----------------------------------------------------------------------------
// Cliente de Supabase (SDK oficial supabase-js v2, cargado como módulo ES).
// Las credenciales se leen de window.KONYS_ENV (js/env.js), nunca del código.
// -----------------------------------------------------------------------------
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const env = window.KONYS_ENV || {};

const PLACEHOLDER = /TU-PROYECTO|TU-CLAVE/;

/** true cuando js/env.js existe y tiene valores reales. */
export const supabaseConfigurado = Boolean(
  env.SUPABASE_URL && env.SUPABASE_ANON_KEY &&
  !PLACEHOLDER.test(env.SUPABASE_URL) && !PLACEHOLDER.test(env.SUPABASE_ANON_KEY),
);

export const realtimeHabilitado = supabaseConfigurado && env.REALTIME !== false;

export const supabase = supabaseConfigurado
  ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'konys-admin-auth' },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

/** Error que se lanza cuando falta la configuración (para mostrar un aviso claro). */
export class ConfiguracionFaltante extends Error {
  constructor() {
    super('Falta configurar la conexión con Supabase (js/env.js).');
    this.name = 'ConfiguracionFaltante';
  }
}

export function requerirSupabase() {
  if (!supabase) throw new ConfiguracionFaltante();
  return supabase;
}
