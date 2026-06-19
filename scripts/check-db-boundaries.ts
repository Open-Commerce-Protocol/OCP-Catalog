import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

type ServiceDb = {
  packageName: string;
  migrationTable: string;
  requiredTables: string[];
  forbiddenTables: string[];
};

const serviceDbs: ServiceDb[] = [
  {
    packageName: 'catalog-db',
    migrationTable: '__drizzle_migrations_catalog',
    requiredTables: ['catalog_entries', 'catalog_search_documents', 'catalog_embedding_work_items'],
    forbiddenTables: ['registered_catalogs', 'ocp_activity_events_raw', 'provider_products', 'shopify_app_installations'],
  },
  {
    packageName: 'registration-db',
    migrationTable: '__drizzle_migrations_registration',
    requiredTables: ['registered_catalogs', 'catalog_registration_records'],
    forbiddenTables: ['catalog_search_documents', 'ocp_activity_events_raw', 'provider_products', 'shopify_app_installations'],
  },
  {
    packageName: 'activity-db',
    migrationTable: '__drizzle_migrations_activity',
    requiredTables: ['ocp_activity_events_raw', 'ocp_activity_public_events'],
    forbiddenTables: ['catalog_search_documents', 'registered_catalogs', 'provider_products', 'shopify_app_installations'],
  },
  {
    packageName: 'provider-demo-db',
    migrationTable: '__drizzle_migrations_provider_demo',
    requiredTables: ['provider_products', 'provider_sync_runs'],
    forbiddenTables: ['catalog_search_documents', 'registered_catalogs', 'ocp_activity_events_raw', 'shopify_app_installations'],
  },
  {
    packageName: 'shopify-app-db',
    migrationTable: '__drizzle_migrations_shopify_app',
    requiredTables: ['shopify_app_installations', 'shopify_app_sync_jobs'],
    forbiddenTables: ['catalog_search_documents', 'registered_catalogs', 'ocp_activity_events_raw', 'provider_products'],
  },
];

const failures: string[] = [];

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function walk(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.turbo' || entry === '.git') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else if (/\.(ts|tsx|json)$/.test(entry)) files.push(path);
  }
  return files;
}

assert(!existsSync(join(root, 'packages/db/src/schema')), 'packages/db must not contain business schema files');

for (const file of walk(join(root, 'apps')).concat(walk(join(root, 'packages')), walk(join(root, 'scripts')))) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (rel === 'scripts/check-db-boundaries.ts') continue;
  const source = readFileSync(file, 'utf8');
  if (source.includes('@ocp-catalog/db/schema')) {
    failures.push(`${rel} imports forbidden @ocp-catalog/db/schema`);
  }
  if (/import\s+\{[^}]*\bschema\b[^}]*\}\s+from\s+['"]@ocp-catalog\/db['"]/.test(source)) {
    failures.push(`${rel} imports schema from infra-only @ocp-catalog/db`);
  }
}

for (const service of serviceDbs) {
  const base = `packages/${service.packageName}`;
  const initPath = `${base}/migrations/001_init.sql`;
  const configPath = `${base}/drizzle.config.ts`;
  assert(existsSync(join(root, initPath)), `${initPath} is missing`);
  assert(existsSync(join(root, configPath)), `${configPath} is missing`);
  const init = existsSync(join(root, initPath)) ? read(initPath) : '';
  const config = existsSync(join(root, configPath)) ? read(configPath) : '';
  assert(config.includes(service.migrationTable), `${configPath} must use ${service.migrationTable}`);
  assert(!init.includes('IF NOT EXISTS'), `${initPath} must not hide service schema drift with IF NOT EXISTS`);
  for (const table of service.requiredTables) {
    assert(init.includes(`"${table}"`), `${initPath} is missing required table ${table}`);
  }
  for (const table of service.forbiddenTables) {
    assert(!init.includes(`"${table}"`), `${initPath} contains table owned by another service: ${table}`);
  }
}

const catalogInit = read('packages/catalog-db/migrations/001_init.sql');
for (const requiredIndex of [
  'catalog_search_documents_search_vector_idx',
  'catalog_search_embeddings_embedding_hnsw_64_idx',
  'catalog_search_embeddings_embedding_hnsw_1024_idx',
]) {
  assert(catalogInit.includes(requiredIndex), `catalog baseline is missing ${requiredIndex}`);
}

const infraInit = read('packages/db/migrations/001_init.sql');
assert(infraInit.includes('CREATE EXTENSION IF NOT EXISTS pg_trgm'), 'infra init must create pg_trgm');
assert(infraInit.includes('CREATE EXTENSION IF NOT EXISTS vector'), 'infra init must create vector');

if (failures.length > 0) {
  console.error(failures.map((failure) => `db-boundary-error: ${failure}`).join('\n'));
  process.exit(1);
}

console.log('db-boundaries-ok');
