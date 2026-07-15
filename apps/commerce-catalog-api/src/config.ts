import { loadEnv, runtimeBoolean, type LoadEnvOptions } from '@ocp-catalog/config';
import type { CatalogCoreConfig } from '@ocp-catalog/catalog-core';
import { z } from 'zod';

export const commerceCatalogConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  CATALOG_WORKER_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(4),
  CATALOG_API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CATALOG_PUBLIC_BASE_URL: z.string().url(),
  CATALOG_SEARCH_INDEX_WORKER_ENABLED: runtimeBoolean.default(true),
  CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  CATALOG_SEARCH_INDEX_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(16),
  CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT: z.coerce.number().int().min(0).default(5000),
  CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: runtimeBoolean.default(false),
  CATALOG_SEARCH_INDEX_WORKER_JOB_DELAY_MS: z.coerce.number().int().min(0).default(0),
  CATALOG_SEARCH_INDEX_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1000).default(30000),
  CATALOG_SEARCH_INDEX_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).default(900000),
  CATALOG_SEARCH_INDEX_RETRY_JITTER_RATIO: z.coerce.number().min(0).max(1).default(0.2),
  CATALOG_QUEUE_CLEANUP_ENABLED: runtimeBoolean.default(true),
  CATALOG_QUEUE_COMPLETED_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  CATALOG_QUEUE_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(10000).default(1000),
  CATALOG_EMBEDDING_BATCH_WORKER_ENABLED: runtimeBoolean.default(false),
  CATALOG_EMBEDDING_BATCH_WORKER_SUBMIT_LIMIT: z.coerce.number().int().min(1).max(50000).default(5000),
  CATALOG_EMBEDDING_BATCH_WORKER_INGEST_LIMIT: z.coerce.number().int().min(1).max(50000).default(5000),
  CATALOG_EMBEDDING_BATCH_MAX_ACTIVE_JOBS: z.coerce.number().int().min(1).max(100).default(2),
  CATALOG_PROVIDER_THROTTLE_ENABLED: runtimeBoolean.default(true),
  QUERY_EMBEDDING_CACHE_REDIS_URL: z.string().default(''),
  QUERY_EMBEDDING_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(600),
  QUERY_EMBEDDING_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).default(5000),
  API_KEY_DEV: z.string().min(1),
  API_KEYS: z.string().default(''),
  CATALOG_ADMIN_API_KEY: z.string().min(1),
  CATALOG_ADMIN_API_KEYS: z.string().default(''),
  CATALOG_ID: z.string().min(1),
  CATALOG_NAME: z.string().min(1),
  REGISTRATION_ID: z.string().default('ocp_registry_public'),
  REGISTRATION_PUBLIC_BASE_URL: z.string().url().default('https://ocp.deeplumen.io/registry'),
  EMBEDDING_MODEL: z.string().default('local-hash-v1'),
  EMBEDDING_DIMENSION: z.coerce.number().int().min(1).default(64),
  CATALOG_VECTOR_INDEX_PROVIDER: z.enum(['postgres', 'opensearch']).default('postgres'),
  OPENSEARCH_URL: z.string().url().default('http://127.0.0.1:9200'),
  OPENSEARCH_USERNAME: z.string().default(''),
  OPENSEARCH_PASSWORD: z.string().default(''),
  OPENSEARCH_INDEX_NAME: z.string().default('ocp-commerce-catalog-vectors'),
  OPENSEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  OPENSEARCH_KNN_ENGINE: z.enum(['lucene', 'faiss']).default('lucene'),
  OPENSEARCH_KNN_M: z.coerce.number().int().min(2).max(2048).default(16),
  OPENSEARCH_KNN_EF_CONSTRUCTION: z.coerce.number().int().min(4).max(4096).default(128),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  OPENAI_EMBEDDING_MAX_INPUT_CHARS: z.coerce.number().int().min(100).default(12000),
});

export type CommerceCatalogConfig = z.infer<typeof commerceCatalogConfigSchema>;

export function loadCommerceCatalogConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): CommerceCatalogConfig {
  return commerceCatalogConfigSchema.parse(loadEnv(env, options));
}

export function toCatalogCoreConfig(config: CommerceCatalogConfig): CatalogCoreConfig {
  return {
    catalogId: config.CATALOG_ID,
    catalogName: config.CATALOG_NAME,
    publicBaseUrl: config.CATALOG_PUBLIC_BASE_URL,
    providerThrottleEnabled: config.CATALOG_PROVIDER_THROTTLE_ENABLED,
  };
}
