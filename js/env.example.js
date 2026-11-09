// -----------------------------------------------------------------------------
// Variables de entorno del frontend.
//
// LOCAL:   copie este archivo como js/env.js y complete los valores.
// VERCEL:  NO cree js/env.js; configure SUPABASE_URL y SUPABASE_ANON_KEY en
//          Project Settings → Environment Variables. El build
//          (scripts/build.mjs) genera dist/js/env.js automáticamente.
//
// Dónde encontrarlos: Supabase Dashboard → Project Settings → API
//   · Project URL                → SUPABASE_URL
//   · anon public / publishable  → SUPABASE_ANON_KEY
//
// La clave "anon" es pública por diseño: la seguridad la garantizan las
// políticas RLS de supabase/schema.sql. NUNCA ponga aquí la clave
// "service_role" / "secret": daría acceso total a la base de datos.
// -----------------------------------------------------------------------------
window.KONYS_ENV = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-CLAVE-ANON-PUBLICA',
  // Actualizaciones en vivo (Supabase Realtime) de carta, mesas y reservas.
  REALTIME: true,
};
