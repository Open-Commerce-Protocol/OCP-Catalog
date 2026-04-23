import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
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

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
    CATALOG_API_PORT: 4000,
    CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
    PROVIDER_API_PORT: 4200,
    PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4200',
    USER_DEMO_API_PORT: 4230,
    PROTOCOL_DOCS_PORT: 5173,
    CENTER_API_PORT: 4100,
    CENTER_ADMIN_UI_PORT: 4250,
    CENTER_PUBLIC_BASE_URL: 'http://localhost:4100',
    CENTER_REFRESH_SCHEDULER_ENABLED: true,
    CENTER_REFRESH_INTERVAL_SECONDS: 300,
    CATALOG_SEARCH_INDEX_WORKER_ENABLED: true,
    CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS: 30,
    CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE: 25,
    CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: true,
    API_KEY_DEV: 'dev-api-key',
    API_KEYS: '',
    CATALOG_ID: 'cat_local_dev',
    CATALOG_NAME: 'Local OCP Catalog',
    COMMERCE_PROVIDER_ID: 'commerce_provider_local_dev',
    COMMERCE_PROVIDER_NAME: 'Local Commerce Provider',
    COMMERCE_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
    COMMERCE_PROVIDER_DOMAIN: 'localhost',
    CENTER_ID: 'center_local_dev',
    CENTER_NAME: 'Local OCP Center',
    EMBEDDING_MODEL: 'local-hash-v1',
    EMBEDDING_DIMENSION: 64,
    USER_DEMO_AGENT_MODEL: 'qwen-plus',
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    ...overrides,
  };
}
