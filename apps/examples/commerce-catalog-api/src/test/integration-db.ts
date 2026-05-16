import type { Sql } from 'postgres';

export const integrationPostgresOptions = {
  max: 1,
  connect_timeout: 2,
} as const;

export async function assertIntegrationDatabaseReady(sql: Sql, databaseUrl: string) {
  try {
    await sql`select 1`;
  } catch (error) {
    throw new Error(
      `Commerce catalog integration tests require a reachable Postgres database at ${redactDatabaseUrl(databaseUrl)}. ` +
        'Start the local test database or run the default unit test script instead.',
      { cause: error },
    );
  }
}

function redactDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
