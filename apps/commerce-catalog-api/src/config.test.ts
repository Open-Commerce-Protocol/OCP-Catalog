import { describe, expect, test } from 'bun:test';
import { loadCommerceCatalogConfig } from './config';

const requiredEnv = {
  DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
  CATALOG_ID: 'cat_test',
  CATALOG_NAME: 'Test Catalog',
  CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
  API_KEY_DEV: 'dev-api-key',
  CATALOG_ADMIN_API_KEY: 'dev-admin-key',
};

describe('loadCommerceCatalogConfig', () => {
  test('parses catalog service config from its own schema', () => {
    const config = loadCommerceCatalogConfig({
      ...requiredEnv,
      CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: 'false',
    }, { includeDotEnv: false });

    expect(config.CATALOG_ID).toBe('cat_test');
    expect(config.CATALOG_NAME).toBe('Test Catalog');
    expect(config.CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP).toBe(false);
  });

  test('requires catalog identity instead of inheriting a global default', () => {
    const { CATALOG_ID: _catalogId, ...env } = requiredEnv;

    expect(() => loadCommerceCatalogConfig(env, { includeDotEnv: false })).toThrow();
  });

  test('requires explicit admin auth config', () => {
    const { CATALOG_ADMIN_API_KEY: _adminKey, ...env } = requiredEnv;

    expect(() => loadCommerceCatalogConfig(env, { includeDotEnv: false })).toThrow();
  });

  test('rejects invalid runtime boolean strings', () => {
    expect(() => loadCommerceCatalogConfig({
      ...requiredEnv,
      CATALOG_SEARCH_INDEX_WORKER_ENABLED: 'disabled',
    }, { includeDotEnv: false })).toThrow();
  });
});
