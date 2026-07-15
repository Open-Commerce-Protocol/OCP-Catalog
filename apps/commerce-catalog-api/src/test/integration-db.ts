import type { Sql } from 'postgres';
import { loadCommerceCatalogConfig, type CommerceCatalogConfig } from '../config';

export const integrationPostgresOptions = {
  max: 1,
  connect_timeout: 2,
} as const;

// Required config fields no longer carry insecure production defaults, so
// integration tests provide explicit dev values. Any of these can still be
// overridden by the ambient environment (e.g. a CI-provided DATABASE_URL).
const integrationEnvDefaults = {
  DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
  CATALOG_ID: 'cat_test',
  CATALOG_NAME: 'Test Catalog',
  CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
  API_KEY_DEV: 'dev-api-key',
  CATALOG_ADMIN_API_KEY: 'dev-admin-key',
};

export function loadIntegrationConfig(): CommerceCatalogConfig {
  return loadCommerceCatalogConfig({ ...integrationEnvDefaults, ...process.env });
}

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
