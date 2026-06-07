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
    DATABASE_POOL_MAX: 10,
    CATALOG_WORKER_DATABASE_POOL_MAX: 4,
    CATALOG_API_PORT: 4000,
    CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
    PROVIDER_API_PORT: 4200,
    PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4200',
    USER_DEMO_API_PORT: 4230,
    OCP_SITE_PORT: 5173,
    REGISTRATION_API_PORT: 4100,
    REGISTRATION_ADMIN_UI_PORT: 4250,
    REGISTRATION_PUBLIC_BASE_URL: 'http://localhost:4100',
    REGISTRATION_DISCOVERY_URL: 'http://localhost:4100/.well-known/ocp-registration',
    REGISTRATION_REFRESH_SCHEDULER_ENABLED: true,
    REGISTRATION_REFRESH_INTERVAL_SECONDS: 300,
    REGISTRATION_HEALTH_CHECK_TIMEOUT_MS: 5000,
    REGISTRATION_HEALTH_FAILURE_STALE_THRESHOLD: 3,
    CATALOG_SEARCH_INDEX_WORKER_ENABLED: true,
    CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS: 30,
    CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE: 25,
    CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: false,
    CATALOG_SEARCH_INDEX_WORKER_JOB_DELAY_MS: 0,
    CATALOG_SEARCH_INDEX_JOB_MAX_ATTEMPTS: 5,
    CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS: 30000,
    CATALOG_SEARCH_INDEX_RETRY_MAX_DELAY_MS: 900000,
    CATALOG_SEARCH_INDEX_RETRY_JITTER_RATIO: 0.2,
    API_KEY_DEV: 'dev-api-key',
    API_KEYS: '',
    CATALOG_ADMIN_API_KEY: 'dev-admin-key',
    CATALOG_ADMIN_API_KEYS: '',
    CATALOG_ID: 'cat_local_dev',
    CATALOG_NAME: 'Commerce Product Search Catalog',
    COMMERCE_PROVIDER_ID: 'commerce_provider_local_dev',
    COMMERCE_PROVIDER_NAME: 'Local Commerce Provider',
    COMMERCE_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
    COMMERCE_PROVIDER_DOMAIN: 'localhost',
    REGISTRATION_ID: 'ocp_registry_public',
    REGISTRATION_NAME: 'Open Commerce Protocol Registry',
    EMBEDDING_MODEL: 'local-hash-v1',
    EMBEDDING_DIMENSION: 64,
    CATALOG_VECTOR_INDEX_PROVIDER: 'postgres',
    OPENSEARCH_URL: 'http://127.0.0.1:9200',
    OPENSEARCH_USERNAME: '',
    OPENSEARCH_PASSWORD: '',
    OPENSEARCH_INDEX_NAME: 'ocp-commerce-catalog-vectors',
    OPENSEARCH_TIMEOUT_MS: 10000,
    OPENSEARCH_KNN_ENGINE: 'lucene',
    OPENSEARCH_KNN_M: 16,
    OPENSEARCH_KNN_EF_CONSTRUCTION: 128,
    USER_DEMO_AGENT_MODEL: 'qwen-plus',
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_TIMEOUT_MS: 30000,
    OPENAI_EMBEDDING_MAX_INPUT_CHARS: 12000,
    OCP_MCP_DEFAULT_REGISTRATION_URL: 'http://localhost:4100',
    OCP_MCP_REQUEST_TIMEOUT_MS: 10000,
    OCP_MCP_USER_AGENT: 'ocp-mcp-server/test',
    OCP_MCP_API_KEY: '',
    OCP_MCP_HTTP_PORT: 4300,
    OCP_MCP_HTTP_PATH: '/mcp',
    OCP_ACTIVITY_API_PORT: 4400,
    OCP_ACTIVITY_PUBLIC_BASE_URL: 'http://localhost:4400',
    OCP_ACTIVITY_API_KEY: '',
    OCP_MCP_SKILL_GATEWAY_URL: 'http://localhost:4330',
    OCP_MCP_SKILL_GATEWAY_KEY: '',
    ...overrides,
  };
}
