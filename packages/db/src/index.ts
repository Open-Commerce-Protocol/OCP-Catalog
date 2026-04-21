import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';
import * as schema from './schema/index';

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl = loadConfig().DATABASE_URL) {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}

export { schema };
