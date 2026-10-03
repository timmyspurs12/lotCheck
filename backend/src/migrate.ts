import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { createDatabase, runMigrations } from './lib/db.js';

const config = loadConfig();
const db = createDatabase(config);
try {
  await runMigrations(db);
  process.stdout.write('LotCheck PostgreSQL migrations are current.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Migration failed.';
  process.stderr.write(`LotCheck migration failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
