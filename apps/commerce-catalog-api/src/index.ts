import { createCommerceCatalogApp } from './http/app';
import {
  createCommerceCatalogApiRuntimeContext,
  logEmbeddingProviderConfig,
} from './runtime/context';

const runtime = createCommerceCatalogApiRuntimeContext();
logEmbeddingProviderConfig(runtime);

const app = createCommerceCatalogApp(runtime);
app.listen(runtime.config.CATALOG_API_PORT);

console.log(`Commerce Catalog API listening on http://localhost:${app.server?.port}`);
if (await runtime.catalogAdminSite('/')) {
  console.log('Commerce Catalog Admin static site mounted from apps/commerce-catalog-api/public/dist');
}
