import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as providerDemoSchema from './schema';

export { providerDemoSchema };
export * from './schema';

export type ProviderDemoDbOptions = DbOptions;
export type ProviderDemoDb = ReturnType<typeof createProviderDemoDb>;

export function createProviderDemoDb(databaseUrl: string, options: ProviderDemoDbOptions = {}) {
  return createSchemaDb(providerDemoSchema, databaseUrl, options);
}
