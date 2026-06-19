import { loadConfig } from '@ocp-catalog/config';
import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as catalogSchema from './schema';

export { catalogSchema };
export * from './schema';

export type CatalogDbOptions = DbOptions;
export type CatalogDb = ReturnType<typeof createCatalogDb>;

export function createCatalogDb(databaseUrl = loadConfig().DATABASE_URL, options: CatalogDbOptions = {}) {
  return createSchemaDb(catalogSchema, databaseUrl, options);
}
