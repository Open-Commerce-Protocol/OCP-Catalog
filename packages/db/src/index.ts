import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type DbOptions = {
  maxConnections?: number;
};

export function createPostgresClient(databaseUrl: string, options: DbOptions = {}) {
  return postgres(databaseUrl, { max: options.maxConnections ?? 10 });
}

export function createSchemaDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  databaseUrl: string,
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
