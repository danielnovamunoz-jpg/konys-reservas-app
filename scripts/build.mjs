// -----------------------------------------------------------------------------
// Build para Vercel (sin frameworks ni dependencias).
//   1. Copia los archivos públicos a dist/.
//   2. Genera dist/js/env.js con las variables de entorno SUPABASE_URL y
//      SUPABASE_ANON_KEY (configuradas en Vercel → Settings → Environment Variables).
//
// Uso local:  node scripts/build.mjs   (lee también un archivo .env si existe)
// -----------------------------------------------------------------------------
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const PUBLICOS = ['index.html', 'admin.html', 'css', 'js', 'assets'];

// .env local opcional (formato CLAVE=valor)
if (existsSync(path.join(ROOT, '.env'))) {
  const lineas = (await readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/);
  for (const linea of lineas) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const url = process.env.SUPABASE_URL?.trim();
const clave = process.env.SUPABASE_ANON_KEY?.trim();
const realtime = process.env.SUPABASE_REALTIME !== 'false';

if (!url || !clave) {
  console.error('\n✖ Faltan las variables SUPABASE_URL y/o SUPABASE_ANON_KEY.\n  Configúralas en Vercel → Project Settings → Environment Variables.\n');
  process.exit(1);
}
if (!/^https:\/\/.+/.test(url)) {
  console.error('\n✖ SUPABASE_URL debe empezar por https://\n');
  process.exit(1);
}

// Protección: impedir publicar por error una clave secreta.
function rolDelJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
  } catch {
    return null;
  }
}
if (clave.startsWith('sb_secret_') || rolDelJwt(clave) === 'service_role') {
  console.error('\n✖ SUPABASE_ANON_KEY contiene una clave SECRETA (service_role). Usa la clave pública "anon" / "publishable".\n');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const p of PUBLICOS) {
  await cp(path.join(ROOT, p), path.join(OUT, p), {
    recursive: true,
    filter: (origen) => !/[\\/]js[\\/]env\.js$/.test(origen),
  });
}
await writeFile(
  path.join(OUT, 'js', 'env.js'),
  `// Generado automáticamente por scripts/build.mjs — no editar.\nwindow.KONYS_ENV = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: clave, REALTIME: realtime })};\n`,
);

console.log(`✔ Build listo en dist/ (Supabase: ${new URL(url).host}, Realtime: ${realtime ? 'sí' : 'no'})`);
