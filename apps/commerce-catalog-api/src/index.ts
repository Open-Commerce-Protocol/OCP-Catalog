import { app, runtime } from './http/app';
import { startSearchIndexWorkerScheduler } from './runtime/search-index-scheduler';

const searchIndexScheduler = startSearchIndexWorkerScheduler(runtime);

app.listen(runtime.config.CATALOG_API_PORT);

console.log(`Commerce Catalog API listening on http://localhost:${app.server?.port}`);
if (await runtime.catalogAdminSite('/')) {
  console.log('Commerce Catalog Admin static site mounted from apps/commerce-catalog-api/public/dist');
}
if (searchIndexScheduler) {
  console.log(`Commerce Catalog search index worker enabled every ${runtime.config.CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS}s`);
}
