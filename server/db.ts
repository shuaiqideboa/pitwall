import { mkdirSync } from 'node:fs';
import pg from 'pg';

/** The little slice of a Postgres client the server needs. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/**
 * Real Postgres when DATABASE_URL is set (Railway). Otherwise an embedded
 * Postgres (PGlite): in memory, or in `dataDir` to keep data between runs.
 * Both speak the same SQL, so tests exercise the production queries.
 */
export async function connect({ url, dataDir }: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    return {
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as T[] }),
      close: () => pool.end(),
    };
  }
  // Loaded only here: production uses real Postgres and may not install this dev-only package.
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true }); // PGlite won't create parent folders
  const lite = new PGlite(dataDir);
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await lite.query<T>(sql, params)).rows }),
    close: () => lite.close(),
  };
}

/** Create the tables if they don't exist yet. Safe to run on every start. */
export async function migrate(db: Db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )`);
}
