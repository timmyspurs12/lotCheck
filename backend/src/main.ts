import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { buildApiApp } from './api/app.js';
import { createDatabase, assertMigrationsCurrent, runMigrations } from './lib/db.js';
import { createDocumentStorage } from './services/documentStorage.js';
import { DocumentService } from './services/documentService.js';
import { createGenLayerAdapter } from './services/genlayerAdapter.js';
import { ReviewService } from './services/reviewService.js';
import { SubmissionWorker } from './services/submissionWorker.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config);
  const storage = createDocumentStorage(config);
  const adapter = createGenLayerAdapter(config);
  try {
    if (config.dbAutoMigrate) await runMigrations(db);
    else await assertMigrationsCurrent(db);
    const worker = new SubmissionWorker(db, adapter, config);
    const documents = new DocumentService(db, config, storage);
    const reviews = new ReviewService(db, config, adapter, worker);
    const app = await buildApiApp({ config, db, reviews, documents, genlayer: adapter });
    app.addHook('onClose', async () => {
      await worker.stop();
      await documents.close();
      await db.end();
    });
    worker.start();
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port, genlayerMode: config.genlayerMode, network: config.genlayerMode === 'live' ? config.genlayerNetwork : null }, 'LotCheck backend listening');

    const shutdown = async (signal: string) => {
      app.log.info({ signal }, 'Shutting down LotCheck backend');
      try { await app.close(); }
      finally { process.exit(0); }
    };
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  } catch (error) {
    await storage.close?.().catch(() => undefined);
    await db.end().catch(() => undefined);
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Startup failed.';
  process.stderr.write(`LotCheck backend startup failed: ${message}\n`);
  process.exitCode = 1;
});
