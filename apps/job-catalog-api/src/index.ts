import { createJobCatalogApp } from './http/app';
import { createJobCatalogRuntimeContext } from './runtime/context';

const runtime = createJobCatalogRuntimeContext();
const app = createJobCatalogApp(runtime);
app.listen(runtime.config.JOB_CATALOG_API_PORT);

console.log(`Job Catalog API listening on http://localhost:${app.server?.port}`);
