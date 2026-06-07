import { loadConfig } from '@ocp-catalog/config';
import {
  createCommerceCatalogWorkerRuntimeContext,
  logEmbeddingProviderConfig,
} from './runtime/context';
import { startSearchIndexWorkerScheduler } from './runtime/search-index-scheduler';

const config = loadConfig();
if (!config.CATALOG_SEARCH_INDEX_WORKER_ENABLED) {
  throw new Error('commerce catalog worker requires CATALOG_SEARCH_INDEX_WORKER_ENABLED=true');
}

const runtime = createCommerceCatalogWorkerRuntimeContext({
  databasePoolMax: config.CATALOG_WORKER_DATABASE_POOL_MAX,
});
logEmbeddingProviderConfig(runtime);

const searchIndexScheduler = startSearchIndexWorkerScheduler(runtime);
if (!searchIndexScheduler) {
  throw new Error('commerce catalog worker scheduler did not start');
}

console.log(`Commerce Catalog search index worker started every ${runtime.config.CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS}s`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(searchIndexScheduler);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'search_index_worker_shutdown',
      signal,
    }));
    process.exit(0);
  });
}
