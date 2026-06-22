import { loadConfig } from '@ocp-catalog/config';
import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as shopifyAppSchema from './schema';

export { shopifyAppSchema };
export * from './schema';

export type ShopifyAppDbOptions = DbOptions;
export type ShopifyAppDb = ReturnType<typeof createShopifyAppDb>;

export function createShopifyAppDb(databaseUrl = loadConfig().DATABASE_URL, options: ShopifyAppDbOptions = {}) {
  return createSchemaDb(shopifyAppSchema, databaseUrl, options);
}
