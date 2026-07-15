import { describe, expect, test } from 'bun:test';
import { loadCommerceCatalogConfig, type CommerceCatalogConfig } from './config';
import { createCommerceEmbeddingProvider } from './embedding-provider';

describe('createCommerceEmbeddingProvider', () => {
  test('uses local hash provider when no OpenAI key is configured', () => {
    const provider = createCommerceEmbeddingProvider(config({
      OPENAI_API_KEY: '',
      EMBEDDING_MODEL: 'local-hash-v1',
      EMBEDDING_DIMENSION: 64,
    }));

    expect(provider.providerId).toBe('local');
    expect(provider.model).toBe('local-hash-v1');
  });

  test('does not use local hash model name for external OpenAI-compatible embeddings', () => {
    const provider = createCommerceEmbeddingProvider(config({
      OPENAI_API_KEY: 'test-key',
      EMBEDDING_MODEL: 'local-hash-v1',
      EMBEDDING_DIMENSION: 64,
    }));

    expect(provider.providerId).toBe('openai');
    expect(provider.model).toBe('text-embedding-3-small');
  });
});

function config(overrides: Partial<CommerceCatalogConfig>): CommerceCatalogConfig {
  return {
    ...loadCommerceCatalogConfig({
      DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
      CATALOG_ID: 'cat_local_dev',
      CATALOG_NAME: 'Commerce Product Search Catalog',
      CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
      API_KEY_DEV: 'dev-api-key',
      CATALOG_ADMIN_API_KEY: 'dev-admin-key',
    }, { includeDotEnv: false }),
    ...overrides,
  };
}
