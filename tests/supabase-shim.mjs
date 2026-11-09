// -----------------------------------------------------------------------------
// Emulación mínima del entorno de Supabase sobre PGlite (PostgreSQL en WASM).
//
// Crea lo que Supabase ya trae de fábrica y que schema.sql da por hecho:
//   · roles anon / authenticated / service_role
//   · esquema auth con auth.users y auth.uid() / auth.role() / auth.jwt()
//   · esquema storage con buckets y objects (con RLS)
// y luego ejecuta supabase/schema.sql y supabase/seed.sql SIN modificarlos.
//
// Solo se usa para pruebas locales; en producción se usa Supabase real.
// -----------------------------------------------------------------------------
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUPABASE_BOOTSTRAP = /* sql */ `
  do $$ begin
    create role anon nologin noinherit;
  exception when duplicate_object then null; end $$;
  do $$ begin
    create role authenticated nologin noinherit;
  exception when duplicate_object then null; end $$;
  do $$ begin
    create role service_role nologin noinherit bypassrls;
  exception when duplicate_object then null; end $$;

  grant usage on schema public to anon, authenticated, service_role;

  create schema if not exists auth;
  grant usage on schema auth to anon, authenticated, service_role;

  create table if not exists auth.users (
    id         uuid primary key default gen_random_uuid(),
    email      text unique not null,
    created_at timestamptz not null default now()
  );

  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create or replace function auth.role() returns text language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
  $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema if not exists storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table if not exists storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz default now()
  );
  create table if not exists storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets (id),
    name       text not null,
    owner      uuid,
    metadata   jsonb,
    created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;
`;

export async function createDb({ seed = true } = {}) {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SUPABASE_BOOTSTRAP);
  const schema = await readFile(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  await db.exec(schema);
  if (seed) {
    const seedSql = await readFile(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8');
    await db.exec(seedSql);
  }
  return db;
}

export async function applySchemaAgain(db) {
  const schema = await readFile(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  const seedSql = await readFile(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(schema);
  await db.exec(seedSql);
}

/**
 * Ejecuta `fn(tx)` dentro de una transacción con el rol y los claims del JWT,
 * igual que lo hace PostgREST en Supabase en cada petición.
 * role: 'anon' | 'authenticated' | 'service_role'
 */
export async function asRole(db, { role = 'anon', sub = null, email = null } = {}, fn) {
  const claims = JSON.stringify({ role, ...(sub ? { sub, email } : {}) });
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.query(`set local role ${role === 'service_role' ? 'service_role' : role === 'authenticated' ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}

/** Crea un usuario de Auth y opcionalmente lo registra como administrador. */
export async function createUser(db, email, { admin = false } = {}) {
  const { rows } = await db.query(
    `insert into auth.users (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`, [email]);
  const id = rows[0].id;
  if (admin) {
    await db.query(
      `insert into public.administradores (user_id, nombre) values ($1, $2) on conflict do nothing`,
      [id, email.split('@')[0]]);
  }
  return id;
}
