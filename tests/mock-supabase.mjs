// -----------------------------------------------------------------------------
// Servidor local que emula la API de Supabase (REST / Auth / Storage) sobre
// PGlite, usando EXACTAMENTE supabase/schema.sql y supabase/seed.sql.
//
// Sirve también la aplicación (index.html, admin.html…) para probarla de punta
// a punta sin credenciales reales:
//
//     cd tests && npm install && npm run mock     →  http://localhost:5173
//
// Cada petición se ejecuta en una transacción con el rol (anon/authenticated)
// y los claims del JWT, igual que PostgREST, por lo que el RLS es el real.
// Solo implementa el subconjunto de la API que usa la aplicación.
// -----------------------------------------------------------------------------
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createUser } from './supabase-shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STORAGE_DIR = path.join(HERE, '.mock-storage');
const PORT = Number(process.env.PORT || 5173);
const ORIGIN = `http://localhost:${PORT}`;
const JWT_SECRET = 'mock-local-secret-solo-para-pruebas';

// ---------- JWT (HS256) ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
const ANON_KEY = signJwt({ iss: 'mock', role: 'anon', iat: 1700000000, exp: 4102444800 });

// ---------- Base de datos ----------
const db = await createDb();
const usersFile = JSON.parse(await readFile(path.join(HERE, 'mock-users.json'), 'utf8'));
const users = new Map(); // email -> {id, email, password}
for (const u of usersFile.usuarios) {
  const id = await createUser(db, u.email, { admin: u.admin });
  users.set(u.email, { id, email: u.email, password: u.password, created_at: new Date().toISOString() });
}
const refreshTokens = new Map(); // token -> email
await rm(STORAGE_DIR, { recursive: true, force: true });

// ---------- Utilidades HTTP ----------
const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name) {
  if (!IDENT.test(name)) throw httpError(400, 'PGRST100', `Identificador no permitido: ${name}`);
  return `"${name}"`;
}
function httpError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, body: { code, message, details: null, hint: null, ...extra } });
}
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = body === undefined || body === null ? '' : isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...(isBuf || payload === '' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  res.end(payload);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function pgErrorToHttp(err, role) {
  const code = err.code || 'XX000';
  let status = 400;
  if (code === '42501') status = role === 'anon' ? 401 : 403;
  else if (['23505', '23503', '23001', '23P01'].includes(code)) status = 409;
  else if (code === 'PGRST116') status = 406;
  return {
    status,
    body: { code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null },
  };
}

function claimsFrom(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.apikey;
  const payload = verifyJwt(token);
  if (!payload) throw httpError(401, 'PGRST301', 'JWT inválido o expirado');
  return payload;
}

async function withRole(claims, fn) {
  const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query(`set local role ${role}`);
    return fn(tx);
  });
}

// ---------- PostgREST (subconjunto) ----------
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function buildWhere(params, values) {
  const parts = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    const col = ident(key);
    let negate = false;
    let rest = raw;
    if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
    const dot = rest.indexOf('.');
    const op = rest.slice(0, dot);
    const val = rest.slice(dot + 1);
    let expr;
    if (op in OPS) {
      values.push(val);
      expr = `${col} ${OPS[op]} $${values.length}`;
    } else if (op === 'is') {
      const v = { null: 'null', true: 'true', false: 'false' }[val];
      if (!v) throw httpError(400, 'PGRST100', `Valor is. no soportado: ${val}`);
      expr = `${col} is ${v}`;
    } else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      const ph = items.map((it) => { values.push(it); return `$${values.length}`; });
      expr = `${col} in (${ph.join(',')})`;
    } else {
      throw httpError(400, 'PGRST100', `Operador no soportado en el mock: ${op}`);
    }
    parts.push(negate ? `not (${expr})` : expr);
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}
function buildSelect(sel) {
  if (!sel || sel === '*') return '*';
  return sel.split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
    if (c.includes('(')) throw httpError(400, 'PGRST100', 'El mock no soporta recursos embebidos; use la vista v_reservas');
    return c === '*' ? '*' : ident(c);
  }).join(', ');
}
function buildOrder(order) {
  if (!order) return '';
  return 'order by ' + order.split(',').map((o) => {
    const [col, dir = 'asc', nulls] = o.split('.');
    const d = dir === 'desc' ? 'desc' : 'asc';
    const n = nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : '';
    return `${ident(col)} ${d}${n}`;
  }).join(', ');
}
const jsonAgg = (inner) => `select coalesce(json_agg(t), '[]'::json) as data from (${inner}) t`;

async function handleRest(req, res, url, tablePath) {
  const claims = claimsFrom(req);
  const prefer = String(req.headers.prefer || '');
  const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;

  // RPC
  if (tablePath.startsWith('rpc/')) {
    const fn = tablePath.slice(4);
    ident(fn);
    const args = req.method === 'GET' ? Object.fromEntries(params) : await readJson(req);
    return withRole(claims, async (tx) => {
      const meta = await tx.query(
        `select p.proretset from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn]);
      if (!meta.rows.length) throw httpError(404, 'PGRST202', `No existe la función public.${fn}`);
      const values = [];
      const named = Object.entries(args).map(([k, v]) => {
        values.push(v === null || typeof v !== 'object' ? v : JSON.stringify(v));
        return `${ident(k)} => $${values.length}`;
      }).join(', ');
      if (meta.rows[0].proretset) {
        const r = await tx.query(jsonAgg(`select * from public.${ident(fn)}(${named})`), values);
        return send(res, 200, r.rows[0].data);
      }
      const r = await tx.query(`select to_json(public.${ident(fn)}(${named})) as data`, values);
      return send(res, 200, r.rows[0].data);
    });
  }

  const table = `public.${ident(tablePath)}`;
  const values = [];
  const where = buildWhere(params, values);
  const sel = buildSelect(sp.get('select'));

  return withRole(claims, async (tx) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const limit = sp.get('limit') ? `limit ${Number(sp.get('limit'))}` : '';
      const offset = sp.get('offset') ? `offset ${Number(sp.get('offset'))}` : '';
      const headers = {};
      let total = null;
      if (prefer.includes('count=exact')) {
        const c = await tx.query(`select count(*)::int as n from ${table} ${where}`, values);
        total = c.rows[0].n;
      }
      if (req.method === 'HEAD') {
        headers['Content-Range'] = `*/${total ?? '*'}`;
        res.writeHead(200, headers);
        return res.end();
      }
      const r = await tx.query(jsonAgg(`select ${sel} from ${table} ${where} ${buildOrder(sp.get('order'))} ${limit} ${offset}`), values);
      const rows = r.rows[0].data;
      const from = Number(sp.get('offset') || 0);
      headers['Content-Range'] = rows.length ? `${from}-${from + rows.length - 1}/${total ?? '*'}` : `*/${total ?? '*'}`;
      if (wantsObject) {
        if (rows.length !== 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', { details: `The result contains ${rows.length} rows` });
        return send(res, 200, rows[0], headers);
      }
      return send(res, 200, rows, headers);
    }

    const returning = prefer.includes('return=representation') ? sel : null;
    let sql;
    if (req.method === 'POST') {
      const body = await readJson(req);
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const insValues = [];
      const tuples = rows.map((r) => '(' + cols.map((c) => {
        if (!(c in r)) return 'default';
        insValues.push(r[c]);
        return `$${insValues.length}`;
      }).join(', ') + ')');
      sql = `insert into ${table} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')}`;
      values.length = 0;
      values.push(...insValues);
    } else if (req.method === 'PATCH') {
      const body = await readJson(req);
      const sets = Object.entries(body).map(([k, v]) => {
        values.push(v);
        return `${ident(k)} = $${values.length}`;
      });
      // Re-numerar: los filtros ya ocupan $1..$n, los valores SET van después.
      sql = `update ${table} set ${sets.join(', ')} ${where}`;
      if (!where) throw httpError(400, '21000', 'UPDATE requires a WHERE clause');
    } else if (req.method === 'DELETE') {
      if (!where) throw httpError(400, '21000', 'DELETE requires a WHERE clause');
      sql = `delete from ${table} ${where}`;
    } else {
      throw httpError(405, 'PGRST000', 'Método no soportado');
    }

    if (returning) {
      const r = await tx.query(`with t as (${sql} returning ${returning}) select coalesce(json_agg(t), '[]'::json) as data from t`, values);
      const rows = r.rows[0].data;
      if (wantsObject) {
        if (rows.length !== 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
        return send(res, req.method === 'POST' ? 201 : 200, rows[0]);
      }
      return send(res, req.method === 'POST' ? 201 : 200, rows);
    }
    await tx.query(sql, values);
    return send(res, req.method === 'POST' ? 201 : 204, null);
  });
}

// ---------- Auth (GoTrue, subconjunto) ----------
function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.created_at, app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}, identities: [], created_at: u.created_at, updated_at: new Date().toISOString(),
  };
}
function newSession(u) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
  const refresh_token = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh_token, u.email);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(u) };
}
async function handleAuth(req, res, url, sub) {
  if (sub === 'token' && req.method === 'POST') {
    const body = await readJson(req);
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const u = users.get(String(body.email || '').toLowerCase().trim());
      if (!u || u.password !== body.password) {
        return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
      }
      return send(res, 200, newSession(u));
    }
    if (grant === 'refresh_token') {
      const email = refreshTokens.get(body.refresh_token);
      if (!email) return send(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      return send(res, 200, newSession(users.get(email)));
    }
  }
  const claims = verifyJwt((req.headers.authorization || '').slice(7));
  const u = claims?.email ? users.get(claims.email) : null;
  if (sub === 'user' && req.method === 'GET') {
    if (!u) return send(res, 401, { code: 'bad_jwt', msg: 'invalid JWT' });
    return send(res, 200, userJson(u));
  }
  if (sub === 'user' && req.method === 'PUT') {
    if (!u) return send(res, 401, { code: 'bad_jwt', msg: 'invalid JWT' });
    const body = await readJson(req);
    if (body.password) {
      if (String(body.password).length < 6) return send(res, 422, { code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      u.password = body.password;
    }
    return send(res, 200, userJson(u));
  }
  if (sub === 'logout') return send(res, 204, null);
  return send(res, 404, { msg: 'not found' });
}

// ---------- Storage (subconjunto) ----------
async function handleStorage(req, res, rest) {
  // Lectura pública
  if (req.method === 'GET' && rest.startsWith('object/public/')) {
    const file = path.join(STORAGE_DIR, rest.slice('object/public/'.length));
    if (!file.startsWith(STORAGE_DIR)) return send(res, 400, { message: 'ruta inválida' });
    try {
      const buf = await readFile(file);
      const type = (await readFile(file + '.type', 'utf8').catch(() => 'application/octet-stream'));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(buf);
    } catch { return send(res, 404, { message: 'Object not found' }); }
  }
  const claims = claimsFrom(req);
  if (req.method === 'POST' && rest.startsWith('object/')) {
    const [bucket, ...p] = rest.slice('object/'.length).split('/');
    const name = decodeURIComponent(p.join('/'));
    const buf = await readBody(req);
    const type = String(req.headers['content-type'] || 'application/octet-stream');
    try {
      await withRole(claims, async (tx) => {
        const b = await tx.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [bucket]);
        if (!b.rows.length) throw httpError(404, 'NoSuchBucket', 'Bucket not found');
        if (buf.length > b.rows[0].file_size_limit) throw httpError(413, 'EntityTooLarge', 'The object exceeded the maximum allowed size');
        if (!b.rows[0].allowed_mime_types.includes(type.split(';')[0])) throw httpError(415, 'InvalidMimeType', `mime type ${type} is not supported`);
        await tx.query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)`, [bucket, name, claims.sub ?? null]);
      });
    } catch (err) {
      if (err.code === '42501') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      throw err;
    }
    const file = path.join(STORAGE_DIR, bucket, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
    await writeFile(file + '.type', type);
    return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
  }
  if (req.method === 'DELETE' && rest.startsWith('object/')) {
    const bucket = rest.slice('object/'.length).split('/')[0];
    const { prefixes = [] } = await readJson(req);
    const deleted = await withRole(claims, async (tx) => {
      const r = await tx.query(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, prefixes]);
      return r.rows.map((x) => x.name);
    });
    for (const n of deleted) await rm(path.join(STORAGE_DIR, bucket, n), { force: true });
    return send(res, 200, deleted.map((name) => ({ name, bucket_id: bucket })));
  }
  return send(res, 404, { message: 'not found' });
}

// ---------- Archivos estáticos ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
async function handleStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/js/env.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    return res.end(`// Generado por tests/mock-supabase.mjs (servidor local de pruebas)\nwindow.KONYS_ENV = ${JSON.stringify({ SUPABASE_URL: ORIGIN, SUPABASE_ANON_KEY: ANON_KEY, REALTIME: false, MOCK: true })};\n`);
  }
  if (p === '/') p = '/index.html';
  if (p === '/admin' || p === '/admin/') p = '/admin.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || /[\\/](tests|supabase|node_modules|\.git)[\\/]/.test(file.slice(ROOT.length))) {
    return send(res, 404, { message: 'not found' });
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('no file');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(await readFile(file));
  } catch {
    return send(res, 404, { message: 'not found' });
  }
}

// ---------- Router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const t0 = Date.now();
  try {
    if (url.pathname.startsWith('/rest/v1/')) await handleRest(req, res, url, url.pathname.slice('/rest/v1/'.length));
    else if (url.pathname.startsWith('/auth/v1/')) await handleAuth(req, res, url, url.pathname.slice('/auth/v1/'.length));
    else if (url.pathname.startsWith('/storage/v1/')) await handleStorage(req, res, url.pathname.slice('/storage/v1/'.length));
    else if (url.pathname.startsWith('/realtime/')) send(res, 404, { message: 'Realtime no disponible en el mock' });
    else await handleStatic(req, res, url);
  } catch (err) {
    if (err.status) send(res, err.status, err.body);
    else {
      let role = 'anon';
      try { role = claimsFrom(req).role; } catch { /* sin token */ }
      const { status, body } = pgErrorToHttp(err, role);
      send(res, status, body);
    }
  }
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/storage/')) {
    console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} (${Date.now() - t0} ms)`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Konys · servidor local de pruebas (Supabase emulado)\n  App:    ${ORIGIN}\n  Admin:  ${ORIGIN}/admin\n  Cuentas de prueba: tests/mock-users.json\n`);
});
