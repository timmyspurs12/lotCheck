import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/env.js';

export type Database = Pool;

export function createDatabase(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    application_name: 'lotcheck-api',
    keepAlive: true,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    ssl: config.dbSsl === 'disable' ? false : { rejectUnauthorized: true },
  });
}

export async function inTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow>(db: Pool | PoolClient, sql: string, values: unknown[] = []): Promise<T | null> {
  const result = await db.query<T>(sql, values);
  return result.rows[0] ?? null;
}

export async function runMigrations(db: Pool) {
  const content = await readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(content).digest('hex');
  await inTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [736105420]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(80) PRIMARY KEY,
      checksum varchar(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version = $1', ['001_initial']);
    if (existing.rowCount) {
      if (existing.rows[0]!.checksum !== checksum) throw new Error('Applied migration 001_initial differs from the current migration file; refusing an implicit schema rewrite.');
      return;
    }
    await client.query(content);
    await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', ['001_initial', checksum]);
  });
}

export async function assertMigrationsCurrent(db: Pool) {
  const content = await readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(content).digest('hex');
  const result = await db.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version=$1', ['001_initial']);
  if (!result.rowCount) throw new Error('LotCheck database schema is not migrated. Run `npm run backend:migrate` before starting the API.');
  if (result.rows[0]!.checksum !== checksum) throw new Error('LotCheck database migration checksum does not match the current code. Apply migrations before starting the API.');
}

export async function checkDatabase(db: Pool) {
  const result = await db.query<{ now: Date }>('SELECT now() AS now');
  return result.rows[0]?.now;
}
