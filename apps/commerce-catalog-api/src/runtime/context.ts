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
import { PostgresLocalVectorIndexAdapter } from '../search/retrieval/postgres-local-vector-index-adapter';

export function createCommerceCatalogRuntimeContext() {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  const activityEvents = new ActivityEventService(db);
  const embeddingProvider = createCommerceEmbeddingProvider(config);
  const commerceCatalogScenario = createCommerceCatalogScenario({
    semanticSearchEnabled: true,
  });
  const services = createCatalogServices(db, config, commerceCatalogScenario);
  const localVectorIndex = new PostgresLocalVectorIndexAdapter(db, {
    vectorProviderId: 'postgres-local-pgvector',
    indexName: 'catalog_search_embeddings',
    embeddingProviderId: embeddingProvider.providerId,
    embeddingModel: embeddingProvider.model,
    embeddingDimension: embeddingProvider.dimension,
  });
  const searchRetrievalService = new CatalogSemanticRetrievalService(embeddingProvider, localVectorIndex);
  const commerceQueryService = new CommerceQueryService(db, config, commerceCatalogScenario, searchRetrievalService);
  const searchIndexJobs = new SearchIndexJobService(db);
  const searchDocumentService = new SearchDocumentUpsertService(db);
  const searchEmbeddingService = new SearchEmbeddingService(db, embeddingProvider);
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
    commerceQueryService,
    searchIndexJobs,
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
  }));
}

export function buildCurrentCatalogManifest(context: CommerceCatalogRuntimeContext) {
  return buildCatalogManifest(context.config, context.commerceCatalogScenario);
}
