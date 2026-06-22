import { loadConfig } from '@ocp-catalog/config';
import { createSchemaDb, type DbOptions } from '@ocp-catalog/db';
import * as activitySchema from './schema';

export { activitySchema };
export * from './schema';

export type ActivityDbOptions = DbOptions;
export type ActivityDb = ReturnType<typeof createActivityDb>;

export function createActivityDb(databaseUrl = loadConfig().DATABASE_URL, options: ActivityDbOptions = {}) {
  return createSchemaDb(activitySchema, databaseUrl, options);
}
