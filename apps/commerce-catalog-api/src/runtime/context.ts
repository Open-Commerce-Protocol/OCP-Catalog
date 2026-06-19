import { fileURLToPath } from 'node:url';
import {
  buildCatalogManifest,
  createCatalogServices,
} from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb, PostgresAdvisoryLockService } from '@ocp-catalog/db';
import { ActivityEventService } from '@ocp-catalog/ocp-activity-core';
import { createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { createCommerceCatalogScenario } from '../commerce-scenario';
import { createCommerceEmbeddingProvider } from '../embedding-provider';
import { CommerceQueryService } from '../query/commerce-query-service';
import { SearchDocumentUpsertService } from '../search/indexing/document-upsert-service';
import { SearchIndexJobService } from '../search/indexing/index-job-service';
import { SearchIndexWorker } from '../search/indexing/index-worker';
import { SearchEmbeddingService } from '../search/indexing/search-embedding-service';
import { SearchIndexJobHandlerService } from '../search/indexing/search-index-job-handler';
import { OpenAIEmbeddingBatchBackfillService } from '../search/indexing/openai-embedding-batch-backfill';
import { EmbeddingWorkItemService } from '../search/indexing/embedding-work-item-service';
import { CatalogSemanticRetrievalService } from '../search/retrieval/catalog-semantic-retrieval-service';
import { OpenSearchVectorIndexAdapter } from '../search/retrieval/opensearch-vector-index-adapter';
import { PostgresLocalVectorIndexAdapter } from '../search/retrieval/postgres-local-vector-index-adapter';
import { InMemoryQueryEmbeddingCache, RedisQueryEmbeddingCache } from '../search/retrieval/query-embedding-cache';
import type { WritableTextSearchIndexAdapter, WritableVectorIndexAdapter } from '../search/retrieval/vector-index-adapter';
import { CatalogOutboxService } from './catalog-outbox-service';

export type CommerceCatalogRuntimeContextOptions = {
  databasePoolMax?: number;
};

function createBaseRuntimeContext(options: CommerceCatalogRuntimeContextOptions = {}) {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL, {
    maxConnections: options.databasePoolMax ?? config.DATABASE_POOL_MAX,
  });
  const activityEvents = new ActivityEventService(db);
  const embeddingProvider = createCommerceEmbeddingProvider(config);
  const commerceCatalogScenario = createCommerceCatalogScenario({
    semanticSearchEnabled: true,
  });
  const services = createCatalogServices(db, config, commerceCatalogScenario);
  const vectorIndexProfile = {
    vectorProviderId: config.CATALOG_VECTOR_INDEX_PROVIDER === 'opensearch'
      ? 'opensearch-knn'
      : 'postgres-local-pgvector',
    indexName: config.CATALOG_VECTOR_INDEX_PROVIDER === 'opensearch'
      ? config.OPENSEARCH_INDEX_NAME
      : 'catalog_search_embeddings',
    embeddingProviderId: embeddingProvider.providerId,
    embeddingModel: embeddingProvider.model,
    embeddingDimension: embeddingProvider.dimension,
  };
  const vectorIndex = config.CATALOG_VECTOR_INDEX_PROVIDER === 'opensearch'
    ? new OpenSearchVectorIndexAdapter(config, vectorIndexProfile)
    : new PostgresLocalVectorIndexAdapter(db, vectorIndexProfile);
  const writableVectorIndex: WritableVectorIndexAdapter | undefined = isWritableVectorIndex(vectorIndex)
    ? vectorIndex
    : undefined;
  const writableTextIndex: WritableTextSearchIndexAdapter | undefined = isWritableTextIndex(vectorIndex)
    ? vectorIndex
    : undefined;
  const queryEmbeddingCache = config.QUERY_EMBEDDING_CACHE_REDIS_URL
    ? new RedisQueryEmbeddingCache(config.QUERY_EMBEDDING_CACHE_REDIS_URL, config.QUERY_EMBEDDING_CACHE_TTL_SECONDS)
    : new InMemoryQueryEmbeddingCache(
      config.QUERY_EMBEDDING_CACHE_TTL_SECONDS * 1000,
      config.QUERY_EMBEDDING_CACHE_MAX_ENTRIES,
    );
  const searchRetrievalService = new CatalogSemanticRetrievalService(embeddingProvider, vectorIndex, queryEmbeddingCache);
  const commerceQueryService = new CommerceQueryService(db, config, commerceCatalogScenario, searchRetrievalService);
  const searchIndexJobs = new SearchIndexJobService(db, config.CATALOG_SEARCH_INDEX_JOB_MAX_ATTEMPTS);
  const catalogAdminSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../../public/dist', import.meta.url)));

  return {
    config,
    db,
    activityEvents,
    embeddingProvider,
    commerceCatalogScenario,
    services,
    searchRetrievalService,
    queryEmbeddingCache,
    vectorIndexProfile,
    vectorIndex,
    writableVectorIndex,
    writableTextIndex,
    commerceQueryService,
    searchIndexJobs,
    catalogAdminSite,
  };
}

export function createCommerceCatalogApiRuntimeContext(options: CommerceCatalogRuntimeContextOptions = {}) {
  const base = createBaseRuntimeContext(options);
  const {
    vectorIndex: _vectorIndex,
    writableVectorIndex: _writableVectorIndex,
    ...apiContext
  } = base;

  return apiContext;
}

export function createCommerceCatalogWorkerRuntimeContext(options: CommerceCatalogRuntimeContextOptions = {}) {
  const base = createBaseRuntimeContext(options);
  const coordination = new PostgresAdvisoryLockService(base.config.DATABASE_URL);
  const catalogOutbox = new CatalogOutboxService(base.db, base.searchIndexJobs, base.activityEvents);
  const searchDocumentService = new SearchDocumentUpsertService(base.db, base.writableVectorIndex, base.writableTextIndex);
  const searchEmbeddingService = new SearchEmbeddingService(base.db, base.embeddingProvider, base.writableVectorIndex);
  const embeddingWorkItems = new EmbeddingWorkItemService(base.db, {
    embeddingProvider: base.embeddingProvider.providerId,
    embeddingModel: base.embeddingProvider.model,
    embeddingDimension: base.embeddingProvider.dimension,
  });
  const embeddingBatchBackfill = new OpenAIEmbeddingBatchBackfillService(
    base.db,
    base.config,
    searchEmbeddingService,
    embeddingWorkItems,
  );
  const searchIndexWorker = new SearchIndexWorker(
    base.searchIndexJobs,
    new SearchIndexJobHandlerService(
      searchDocumentService,
      base.searchIndexJobs,
      searchEmbeddingService,
      embeddingWorkItems,
    ),
  );

  return {
    ...base,
    coordination,
    catalogOutbox,
    searchDocumentService,
    searchEmbeddingService,
    embeddingWorkItems,
    embeddingBatchBackfill,
    searchIndexWorker,
  };
}

export type CommerceCatalogApiRuntimeContext = ReturnType<typeof createCommerceCatalogApiRuntimeContext>;
export type CommerceCatalogWorkerRuntimeContext = ReturnType<typeof createCommerceCatalogWorkerRuntimeContext>;
export type CommerceCatalogRuntimeContext = CommerceCatalogApiRuntimeContext;

export function logEmbeddingProviderConfig(context: CommerceCatalogApiRuntimeContext | CommerceCatalogWorkerRuntimeContext) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'embedding_provider_configured',
    provider: context.embeddingProvider.providerId,
    model: context.embeddingProvider.model,
    dimension: context.embeddingProvider.dimension,
    vector_index_provider: context.vectorIndexProfile.vectorProviderId,
    vector_index_name: context.vectorIndexProfile.indexName,
  }));
}

function isWritableVectorIndex(value: unknown): value is WritableVectorIndexAdapter {
  return Boolean(
    value
    && typeof value === 'object'
    && 'ensureIndex' in value
    && 'upsert' in value
    && 'delete' in value,
  );
}

function isWritableTextIndex(value: unknown): value is WritableTextSearchIndexAdapter {
  return Boolean(
    value
    && typeof value === 'object'
    && 'upsertText' in value
    && 'searchText' in value,
  );
}

export function buildCurrentCatalogManifest(context: CommerceCatalogApiRuntimeContext) {
  return buildCatalogManifest(context.config, context.commerceCatalogScenario);
}
