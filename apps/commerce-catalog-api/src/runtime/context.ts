import { fileURLToPath } from 'node:url';
import {
  buildCatalogManifest,
  createCatalogServices,
} from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
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
import { CatalogSemanticRetrievalService } from '../search/retrieval/catalog-semantic-retrieval-service';
import { OpenSearchVectorIndexAdapter } from '../search/retrieval/opensearch-vector-index-adapter';
import { PostgresLocalVectorIndexAdapter } from '../search/retrieval/postgres-local-vector-index-adapter';
import type { WritableVectorIndexAdapter } from '../search/retrieval/vector-index-adapter';
import { CatalogOutboxService } from './catalog-outbox-service';

export function createCommerceCatalogRuntimeContext() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
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
  const searchRetrievalService = new CatalogSemanticRetrievalService(embeddingProvider, vectorIndex);
  const commerceQueryService = new CommerceQueryService(db, config, commerceCatalogScenario, searchRetrievalService);
  const searchIndexJobs = new SearchIndexJobService(db, config.CATALOG_SEARCH_INDEX_JOB_MAX_ATTEMPTS);
  const catalogOutbox = new CatalogOutboxService(db, searchIndexJobs, activityEvents);
  const searchDocumentService = new SearchDocumentUpsertService(db, writableVectorIndex);
  const searchEmbeddingService = new SearchEmbeddingService(db, embeddingProvider, writableVectorIndex);
  const searchIndexWorker = new SearchIndexWorker(
    searchIndexJobs,
    new SearchIndexJobHandlerService(searchDocumentService, searchIndexJobs, searchEmbeddingService),
  );
  const catalogAdminSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../../public/dist', import.meta.url)));

  return {
    config,
    db,
    activityEvents,
    embeddingProvider,
    commerceCatalogScenario,
    services,
    searchRetrievalService,
    vectorIndex,
    commerceQueryService,
    searchIndexJobs,
    catalogOutbox,
    searchDocumentService,
    searchEmbeddingService,
    searchIndexWorker,
    catalogAdminSite,
  };
}

export type CommerceCatalogRuntimeContext = ReturnType<typeof createCommerceCatalogRuntimeContext>;

export function logEmbeddingProviderConfig(context: CommerceCatalogRuntimeContext) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'embedding_provider_configured',
    provider: context.embeddingProvider.providerId,
    model: context.embeddingProvider.model,
    dimension: context.embeddingProvider.dimension,
    vector_index_provider: context.vectorIndex.profile.vectorProviderId,
    vector_index_name: context.vectorIndex.profile.indexName,
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

export function buildCurrentCatalogManifest(context: CommerceCatalogRuntimeContext) {
  return buildCatalogManifest(context.config, context.commerceCatalogScenario);
}
