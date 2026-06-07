import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';
import * as schema from './schema/index';

export type Db = ReturnType<typeof createDb>;

export type DbOptions = {
  maxConnections?: number;
};

export function createDb(databaseUrl = loadConfig().DATABASE_URL, options: DbOptions = {}) {
  const client = postgres(databaseUrl, { max: options.maxConnections ?? 10 });
  return drizzle(client, { schema });
}

export { schema };
