import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';

export type DbOptions = {
  maxConnections?: number;
};

export function createPostgresClient(databaseUrl = loadConfig().DATABASE_URL, options: DbOptions = {}) {
  return postgres(databaseUrl, { max: options.maxConnections ?? 10 });
}

export function createSchemaDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  databaseUrl = loadConfig().DATABASE_URL,
  options: DbOptions = {},
) {
  const client = createPostgresClient(databaseUrl, options);
  return drizzle(client, { schema });
}

export {
  PostgresAdvisoryLockService,
  type AdvisoryLockResult,
  type AdvisoryLockService,
} from './advisory-lock';
