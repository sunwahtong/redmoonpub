/**
 * Database access.
 *
 * Two backends behind one tiny interface:
 *
 *   PostgreSQL   when DATABASE_URL is set — Supabase in production, or any
 *                Postgres. Connection pooling through `pg`.
 *   PGlite       when it is not — a real Postgres compiled to WebAssembly,
 *                stored under data/pglite/. Zero setup for local development,
 *                and the same SQL, migrations and behaviour as production.
 *
 * Both expose `query`, `exec` and `tx` (see types.ts). Integers and numerics
 * come back as JavaScript numbers on both, so business code never has to
 * think about the driver.
 */
import fs from 'node:fs';
import path from 'node:path';
import {config} from './config.ts';
import type {Db, Queryable, QueryResult, Row} from './types.ts';

let backend: Db | null = null;
let readyPromise: Promise<Db> | null = null;

function normalise<T = Row>(result: {rows?: T[]; rowCount?: number | null; affectedRows?: number}): QueryResult<T> {
  const rows = result.rows || [];
  const rowCount = typeof result.rowCount === 'number' ? result.rowCount : (result.affectedRows ?? rows.length);
  return {rows, rowCount};
}

async function createPgBackend(): Promise<Db> {
  const pg = await import('pg');
  const {Pool, types} = pg.default || pg;
  // int8 / numeric arrive as strings by default. Everything in this schema
  // fits a JavaScript number, so parse them.
  types.setTypeParser(20, (value: string) => Number(value));
  types.setTypeParser(1700, (value: string) => Number(value));

  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? {rejectUnauthorized: false} : false,
    // A serverless instance may serve several requests at once; the Supabase
    // pooler multiplexes these onto far fewer server connections.
    max: config.serverless ? 4 : 8,
    // A long-lived process keeps its connections: every reconnect through the
    // pooler is a TLS handshake plus an auth round trip, which is what spent
    // the database's egress on serverless (thousands of connections a day).
    idleTimeoutMillis: config.serverless ? 10000 : 10 * 60 * 1000,
    keepAlive: true,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', (error) => console.error('[db] pool error', error.message));

  const scopedOf = (client: {query: (text: string, params?: any[]) => Promise<any>}): Queryable => ({
    query: async <T = Row,>(text: string, params: unknown[] = []) => normalise<T>(await client.query(text, params as any[]))
  });

  return {
    kind: 'postgres',
    query: async <T = Row,>(text: string, params: unknown[] = []) => normalise<T>((await pool.query(text, params as any[])) as unknown as {rows: T[]; rowCount: number | null}),
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(scopedOf(client));
        await client.query('commit');
        return result;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          /* the connection is gone anyway */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

async function createPgliteBackend(): Promise<Db> {
  // Not a literal import on purpose: the serverless bundler must not pull the
  // WebAssembly build into a deployment that always has DATABASE_URL.
  const moduleName = '@electric-sql/pglite';
  const {PGlite} = await import(moduleName);
  fs.mkdirSync(config.localDataDir, {recursive: true});
  const db = await PGlite.create(config.localDataDir);

  const scopedOf = (client: {query: (text: string, params?: unknown[]) => Promise<any>}): Queryable => ({
    query: async <T = Row,>(text: string, params: unknown[] = []) => normalise<T>(await client.query(text, params))
  });

  return {
    kind: 'pglite',
    query: async <T = Row,>(text: string, params: unknown[] = []) => normalise<T>(await db.query(text, params)),
    exec: async (sql) => {
      await db.exec(sql);
    },
    tx: (fn) => db.transaction((client: any) => fn(scopedOf(client))),
    close: () => db.close()
  };
}

/** Applies every SQL file in supabase/migrations once, in name order. */
async function migrate(db: Db): Promise<void> {
  await db.exec(`create table if not exists public.app_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await db.query<{name: string}>('select name from public.app_migrations')).rows.map((row) => row.name));
  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    await db.exec(sql);
    await db.query('insert into public.app_migrations (name) values ($1) on conflict do nothing', [file]);
    console.log(`[db] applied migration ${file}`);
  }
}

/**
 * Returns the ready database, opening it and running migrations on first use.
 * A failed start is not cached, so the next request retries.
 */
export function getDb(): Promise<Db> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!config.databaseUrl && config.serverless) {
        throw new Error('DATABASE_URL is not set. A serverless deployment has no disk for the embedded database; set the Supabase pooler connection string in the project environment and redeploy.');
      }
      if (/\[(DB-PASSWORD|REGION|YOUR-PASSWORD|PROJECT-REF)\]/i.test(config.databaseUrl)) {
        throw new Error('DATABASE_URL still contains a placeholder such as [DB-PASSWORD] or [REGION]. Replace it with the real value from Supabase → Project Settings → Database.');
      }
      const db = config.databaseUrl ? await createPgBackend() : await createPgliteBackend();
      await migrate(db);
      backend = db;
      return db;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export function dbKind(): 'postgres' | 'pglite' {
  return backend ? backend.kind : config.databaseUrl ? 'postgres' : 'pglite';
}

export async function closeDb(): Promise<void> {
  if (backend) await backend.close();
  backend = null;
  readyPromise = null;
}
