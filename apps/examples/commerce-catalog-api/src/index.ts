import { fileURLToPath } from 'node:url';
import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import {
  buildCatalogManifest,
  buildWellKnownDiscovery,
  createCatalogServices,
} from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb, schema } from '@ocp-catalog/db';
import { ActivityEventService } from '@ocp-catalog/ocp-activity-core';
import type { OcpActivityEventInput } from '@ocp-catalog/ocp-activity-schema';
import { AppError, createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { and, count, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import { createCommerceCatalogScenario } from './commerce-scenario';
import { createCommerceEmbeddingProvider } from './embedding-provider';
import { CommerceQueryService } from './query/commerce-query-service';
import { SearchDocumentUpsertService } from './search/indexing/document-upsert-service';
import { SearchEmbeddingService } from './search/indexing/search-embedding-service';
import { SearchIndexJobHandlerService } from './search/indexing/search-index-job-handler';
import { SearchIndexJobService } from './search/indexing/index-job-service';
import { SearchIndexWorker } from './search/indexing/index-worker';
import { SearchRetrievalService } from './search/retrieval/search-retrieval-service';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const activityEvents = new ActivityEventService(db);
const embeddingProvider = createCommerceEmbeddingProvider(config);
const commerceCatalogScenario = createCommerceCatalogScenario({
  semanticSearchEnabled: true,
});
const services = createCatalogServices(db, config, commerceCatalogScenario);
const searchRetrievalService = new SearchRetrievalService(db, embeddingProvider);
const commerceQueryService = new CommerceQueryService(db, config, commerceCatalogScenario, searchRetrievalService);
const searchIndexJobs = new SearchIndexJobService(db);
const searchDocumentService = new SearchDocumentUpsertService(db);
const searchEmbeddingService = new SearchEmbeddingService(db, embeddingProvider);
const searchIndexWorker = new SearchIndexWorker(
  searchIndexJobs,
  new SearchIndexJobHandlerService(searchDocumentService, searchIndexJobs, searchEmbeddingService),
);
const catalogAdminSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../public/dist', import.meta.url)));
const searchIndexScheduler = startSearchIndexWorkerScheduler();
const DATA_PROFILE_CACHE_TTL_MS = 60_000;
let catalogDataProfileCache: {
  expiresAt: number;
  value: Awaited<ReturnType<typeof loadCatalogDataProfile>>;
} | null = null;

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  level: 'info',
  event: 'embedding_provider_configured',
  provider: embeddingProvider.providerId,
  model: embeddingProvider.model,
  dimension: embeddingProvider.dimension,
}));

const app = new Elysia()
  .use(cors())
  .derive(({ request }) => ({
    requestStartedAt: performance.now(),
    requestPathname: new URL(request.url).pathname,
  }))
  .onAfterHandle(({ request, requestStartedAt, requestPathname, set }) => {
    logRequest({
      request,
      pathname: requestPathname,
      status: statusCode(set.status),
      durationMs: performance.now() - requestStartedAt,
    });
  })
  .onError(({ error, request, requestStartedAt, requestPathname, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      logRequest({
        request,
        pathname: requestPathname,
        status: error.status,
        durationMs: requestStartedAt ? performance.now() - requestStartedAt : undefined,
        error,
      });
      return { error: { code: error.code, message: error.message, details: error.details } };
    }

    if (error instanceof ZodError) {
      set.status = 400;
      logRequest({
        request,
        pathname: requestPathname,
        status: 400,
        durationMs: requestStartedAt ? performance.now() - requestStartedAt : undefined,
        error,
      });
      return { error: { code: 'validation_error', message: 'Invalid request body', details: error.issues } };
    }

    set.status = 500;
    logRequest({
      request,
      pathname: requestPathname,
      status: 500,
      durationMs: requestStartedAt ? performance.now() - requestStartedAt : undefined,
      error,
    });
    return {
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  })
  .get('/health', () => ({
    ok: true,
    service: 'commerce-catalog-api',
    protocol: 'ocp.catalog.handshake.v1',
  }))
  .get('/ocp/health', async () => getCatalogHealth())
  .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(config))
  .get('/ocp/manifest', async () => {
    const dataProfile = await getOptionalCatalogDataProfile();
    return buildCatalogManifest(config, commerceCatalogScenario, dataProfile ? { dataProfile } : {});
  })
  .get('/ocp/contracts', () => {
    const contracts = buildCatalogManifest(config, commerceCatalogScenario).object_contracts;

    return {
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: config.CATALOG_ID,
      contracts,
    };
  })
  .post('/ocp/providers/register', async ({ body, headers }) => {
    const result = await services.registrations.register(body, {
      sourceIp: firstHeader(headers['x-forwarded-for']) ?? firstHeader(headers['x-real-ip']),
      userAgent: firstHeader(headers['user-agent']),
    });
    await recordActivityEvent({
      event_type: 'catalog.provider_registered',
      source_kind: 'catalog_node',
      client_kind: 'http',
      endpoint_role: 'inbound',
      protocol_family: 'catalog',
      protocol_version: '1.0',
      method: 'POST',
      path_template: '/ocp/providers/register',
      status_code: 200,
      catalog_id: config.CATALOG_ID,
      provider_id: result.provider_id,
      capability_id: result.selected_sync_capability?.capability_id,
      public_visibility: 'public',
      metadata: {
        registration_status: result.status,
        matched_object_contract_count: result.matched_object_contract_count,
      },
    });
    return result;
  })
  .get('/ocp/providers/:providerId', async ({ params }) => services.registrations.getProvider(params.providerId))
  .post('/ocp/providers/:providerId/deactivate', async ({ params, headers }) => {
    assertWriteAuth(headers);
    return services.providerLifecycle.deactivateProvider(params.providerId);
  })
  .post('/ocp/providers/:providerId/erase', async ({ params, headers }) => {
    assertWriteAuth(headers);
    return services.providerLifecycle.eraseProvider(params.providerId);
  })
  .get('/ocp/providers/:providerId/registrations', async ({ params }) => ({
    catalog_id: config.CATALOG_ID,
    provider_id: params.providerId,
    registrations: await services.registrations.listRegistrations(params.providerId),
  }))
  .get('/api/catalog-admin/overview', async ({ headers }) => {
    assertAdminAuth(headers);
    return getCatalogAdminOverview();
  })
  .get('/api/catalog-admin/providers', async ({ headers }) => {
    assertAdminAuth(headers);
    return getCatalogAdminProviders();
  })
  .get('/api/catalog-admin/entries', async ({ headers, query }) => {
    assertAdminAuth(headers);
    return getCatalogAdminEntries(query);
  })
  .post('/api/catalog-admin/registration/register', async ({ headers }) => {
    assertAdminAuth(headers);
    return registerCatalogInRegistration();
  })
  .post('/api/catalog-admin/registration/verify', async ({ headers }) => {
    assertAdminAuth(headers);
    return postRegistrationJson(`/ocp/catalogs/${config.CATALOG_ID}/verify`, {});
  })
  .post('/api/catalog-admin/registration/refresh', async ({ headers, body }) => {
    assertAdminAuth(headers);
    const token = getBodyString(body, 'catalog_token');
    return postRegistrationJson(`/ocp/catalogs/${config.CATALOG_ID}/refresh`, {}, token);
  })
  .post('/api/catalog-admin/registration/token/rotate', async ({ headers, body }) => {
    assertAdminAuth(headers);
    const token = getBodyString(body, 'catalog_token');
    return postRegistrationJson(`/ocp/catalogs/${config.CATALOG_ID}/token/rotate`, {}, token);
  })
  .post('/api/catalog-admin/search-index/run', async ({ headers, body }) => {
    assertAdminAuth(headers);
    return searchIndexWorker.runBatch({
      catalogId: config.CATALOG_ID,
      limit: getBodyNumber(body, 'limit') ?? 25,
      retryDelayMs: getBodyNumber(body, 'retry_delay_ms') ?? 30_000,
    });
  })
  .post('/api/catalog-admin/search-index/rebuild-provider', async ({ headers, body }) => {
    assertAdminAuth(headers);
    const providerId = getBodyString(body, 'provider_id') ?? config.COMMERCE_PROVIDER_ID;
    return searchIndexJobs.enqueue({
      catalogId: config.CATALOG_ID,
      providerId,
      jobType: 'rebuild_all_for_provider',
      payload: {
        requested_from: 'catalog-admin',
      },
    });
  })
  .post('/ocp/objects/sync', async ({ body, headers }) => {
    assertWriteAuth(headers);
    const result = await services.objects.sync(body);
    await enqueueSearchIndexJobs(result);
    await recordActivityEvent({
      event_type: 'catalog.object_synced',
      source_kind: 'catalog_node',
      client_kind: 'http',
      endpoint_role: 'inbound',
      protocol_family: 'catalog',
      protocol_version: '1.0',
      method: 'POST',
      path_template: '/ocp/objects/sync',
      status_code: 200,
      catalog_id: result.catalog_id,
      provider_id: result.provider_id,
      sync_object_count: result.items.length,
      public_visibility: 'public',
      metadata: {
        sync_status: result.status,
        accepted_count: result.accepted_count,
        rejected_count: result.rejected_count,
      },
    });
    return result;
  })
  .get('/ocp/providers/:providerId/objects', async ({ params }) => ({
    catalog_id: config.CATALOG_ID,
    provider_id: params.providerId,
    objects: await services.objects.listProviderObjects(params.providerId),
  }))
  .get('/ocp/objects/:objectId', async ({ params }) => services.objects.getObject(params.objectId))
  .post('/ocp/query', async ({ body, headers }) => {
    const result = await commerceQueryService.query(body, {
      requesterKey: firstHeader(headers['x-api-key']),
    });
    await recordActivityEvent({
      event_type: 'catalog.queried',
      source_kind: 'catalog_node',
      client_kind: 'http',
      endpoint_role: 'inbound',
      protocol_family: 'catalog',
      protocol_version: '1.0',
      method: 'POST',
      path_template: '/ocp/query',
      status_code: 200,
      catalog_id: config.CATALOG_ID,
      query_pack: stringPayload(body as Record<string, unknown>, 'query_pack'),
      result_count: result.result_count,
      public_visibility: 'aggregate_only',
    });
    return result;
  })
  .post('/ocp/resolve', async ({ body }) => {
    const result = await services.resolve.resolve(body);
    await recordActivityEvent({
      event_type: 'catalog.resolved',
      source_kind: 'catalog_node',
      client_kind: 'http',
      endpoint_role: 'inbound',
      protocol_family: 'catalog',
      protocol_version: '1.0',
      method: 'POST',
      path_template: '/ocp/resolve',
      status_code: 200,
      catalog_id: config.CATALOG_ID,
      object_type: result.object_type,
      public_visibility: 'aggregate_only',
    });
    return result;
  })
  .get('/', () => serveCatalogAdmin('/'))
  .get('/*', async ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (
      pathname === '/health'
      || pathname.startsWith('/api/catalog-admin/')
      || pathname.startsWith('/ocp/')
      || pathname === '/.well-known/ocp-catalog'
    ) {
      return new Response('Not Found', { status: 404 });
    }

    return serveCatalogAdmin(pathname);
  })
  .listen(config.CATALOG_API_PORT);

console.log(`Commerce Catalog API listening on http://localhost:${app.server?.port}`);
if (await catalogAdminSite('/')) {
  console.log('Commerce Catalog Admin static site mounted from apps/examples/commerce-catalog-api/public/dist');
}
if (searchIndexScheduler) {
  console.log(`Commerce Catalog search index worker enabled every ${config.CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS}s`);
}

function assertWriteAuth(headers: Record<string, string | undefined>) {
  requireApiKey(firstHeader(headers['x-api-key']), config.API_KEY_DEV, config.API_KEYS);
}

function assertAdminAuth(headers: Record<string, string | undefined>) {
  requireApiKey(
    firstHeader(headers['x-admin-key']) ?? firstHeader(headers['x-api-key']),
    config.API_KEY_DEV,
    config.API_KEYS,
  );
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function recordActivityEvent(input: OcpActivityEventInput) {
  try {
    await activityEvents.ingest(input);
  } catch (error) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'activity_event_record_failed',
      activity_event_type: input.event_type,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function serveCatalogAdmin(pathname: string) {
  const response = await catalogAdminSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}

function startSearchIndexWorkerScheduler() {
  if (!config.CATALOG_SEARCH_INDEX_WORKER_ENABLED) return null;

  let running = false;

  const runOnce = async (reason: string) => {
    if (running) return;
    running = true;
    const startedAt = performance.now();
    try {
      if (reason === 'startup' && config.CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP) {
        const reconciled = await reconcileSearchIndexQueue();
        if (reconciled.upserted_document_count > 0 || reconciled.enqueued_embedding_jobs > 0) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'search_index_reconcile',
            reason,
            ...reconciled,
          }));
        }
      }

      const result = await searchIndexWorker.runBatch({
        catalogId: config.CATALOG_ID,
        limit: config.CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE,
        retryDelayMs: 30_000,
      });
      if (result.claimedCount > 0) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: result.failedCount > 0 ? 'warn' : 'info',
          event: 'search_index_worker_batch',
          reason,
          duration_ms: Number((performance.now() - startedAt).toFixed(2)),
          ...result,
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'search_index_worker_error',
        reason,
        duration_ms: Number((performance.now() - startedAt).toFixed(2)),
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      running = false;
    }
  };

  void runOnce('startup');
  const timer = setInterval(() => {
    void runOnce('interval');
  }, config.CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS * 1000);

  return timer;
}

async function reconcileSearchIndexQueue() {
  const [entries, documents, embeddings, jobs] = await Promise.all([
    db.select().from(schema.catalogEntries),
    db.select().from(schema.catalogSearchDocuments),
    db.select().from(schema.catalogSearchEmbeddings),
    db.select().from(schema.catalogSearchIndexJobs),
  ]);

  const catalogEntries = entries.filter((row) => row.catalogId === config.CATALOG_ID && row.entryStatus === 'active');
  const activeDocumentByEntryId = new Map(
    documents
      .filter((row) => row.catalogId === config.CATALOG_ID && row.documentStatus === 'active')
      .map((row) => [row.catalogEntryId, row] as const),
  );
  const readyEmbeddingDocumentIds = new Set(
    embeddings
      .filter((row) => row.catalogId === config.CATALOG_ID && row.status === 'ready')
      .map((row) => row.catalogSearchDocumentId),
  );
  const activeJobs = jobs.filter((row) => (
    row.catalogId === config.CATALOG_ID && (row.status === 'pending' || row.status === 'running')
  ));
  const activeEmbeddingJobDocumentIds = new Set(
    activeJobs
      .filter((row) => row.jobType === 'refresh_embedding')
      .map((row) => stringPayload(row.payload, 'search_document_id'))
      .filter((value): value is string => Boolean(value)),
  );

  let upsertedDocuments = 0;
  let enqueuedEmbeddingJobs = 0;
  for (const entry of catalogEntries) {
    const document = activeDocumentByEntryId.get(entry.id);
    if (!document) {
      const upserted = await searchDocumentService.upsertForCatalogEntry(entry.id);
      if (!upserted) continue;
      upsertedDocuments += 1;

      if (upserted.documentStatus === 'active' && !activeEmbeddingJobDocumentIds.has(upserted.documentId)) {
        await searchIndexJobs.enqueueEmbeddingRefresh({
          catalogId: entry.catalogId,
          providerId: entry.providerId,
          catalogEntryId: entry.id,
          commercialObjectId: entry.commercialObjectId,
          payload: {
            reason: 'startup_reconcile_missing_embedding',
            search_document_id: upserted.documentId,
          },
        });
        activeEmbeddingJobDocumentIds.add(upserted.documentId);
        enqueuedEmbeddingJobs += 1;
      }
      continue;
    }

    if (!readyEmbeddingDocumentIds.has(document.id) && !activeEmbeddingJobDocumentIds.has(document.id)) {
      await searchIndexJobs.enqueueEmbeddingRefresh({
        catalogId: document.catalogId,
        providerId: document.providerId,
        catalogEntryId: document.catalogEntryId,
        commercialObjectId: document.commercialObjectId,
        payload: {
          reason: 'startup_reconcile_missing_embedding',
          search_document_id: document.id,
        },
      });
      activeEmbeddingJobDocumentIds.add(document.id);
      enqueuedEmbeddingJobs += 1;
    }
  }

  return {
    active_entry_count: catalogEntries.length,
    active_document_count: activeDocumentByEntryId.size + upsertedDocuments,
    ready_embedding_count: readyEmbeddingDocumentIds.size,
    upserted_document_count: upsertedDocuments,
    enqueued_embedding_jobs: enqueuedEmbeddingJobs,
  };
}

async function getCatalogAdminOverview() {
  const [
    providerCount,
    objectCount,
    entryMetrics,
    searchDocumentMetrics,
    embeddingMetrics,
    activeDocumentsMissingEmbeddingCount,
    searchJobMetrics,
    queryAuditCount,
    latestBatch,
  ] = await Promise.all([
    countRows(schema.providerContractStates, eq(schema.providerContractStates.catalogId, config.CATALOG_ID)),
    countRows(schema.commercialObjects, eq(schema.commercialObjects.catalogId, config.CATALOG_ID)),
    getEntryMetrics(),
    getSearchDocumentMetrics(),
    getEmbeddingMetrics(),
    getActiveDocumentsMissingEmbeddingCount(),
    getSearchJobMetrics(),
    countRows(schema.queryAuditRecords, eq(schema.queryAuditRecords.catalogId, config.CATALOG_ID)),
    getLatestSyncBatch(),
  ]);

  const embeddingReadinessRatio = searchDocumentMetrics.activeDocumentCount > 0
    ? Number(((searchDocumentMetrics.activeDocumentCount - activeDocumentsMissingEmbeddingCount) / searchDocumentMetrics.activeDocumentCount).toFixed(4))
    : 1;

  return {
    catalog_id: config.CATALOG_ID,
    catalog_name: config.CATALOG_NAME,
    semantic_search_enabled: true,
    query_packs: buildCatalogManifest(config, commerceCatalogScenario).query_capabilities.flatMap((capability) => (
      capability.query_packs.map((pack) => pack.pack_id)
    )),
    metrics: {
      provider_count: providerCount,
      object_count: objectCount,
      active_entry_count: entryMetrics.activeEntryCount,
      active_search_document_count: searchDocumentMetrics.activeDocumentCount,
      ready_embedding_count: embeddingMetrics.readyEmbeddingCount,
      failed_embedding_count: embeddingMetrics.failedEmbeddingCount,
      pending_index_job_count: searchJobMetrics.pendingJobCount,
      running_index_job_count: searchJobMetrics.runningJobCount,
      failed_index_job_count: searchJobMetrics.failedJobCount,
      query_audit_count: queryAuditCount,
      rich_entry_count: entryMetrics.richEntryCount,
      standard_entry_count: entryMetrics.standardEntryCount,
      basic_entry_count: entryMetrics.basicEntryCount,
      missing_image_count: entryMetrics.missingImageCount,
      missing_product_url_count: entryMetrics.missingProductUrlCount,
      out_of_stock_count: entryMetrics.outOfStockCount,
    },
    search_index: {
      active_document_count: searchDocumentMetrics.activeDocumentCount,
      ready_embedding_count: embeddingMetrics.readyEmbeddingCount,
      failed_embedding_count: embeddingMetrics.failedEmbeddingCount,
      latest_failed_embedding_error: embeddingMetrics.latestFailedEmbeddingError,
      active_documents_missing_embedding_count: activeDocumentsMissingEmbeddingCount,
      embedding_readiness_ratio: embeddingReadinessRatio,
      pending_job_count: searchJobMetrics.pendingJobCount,
      running_job_count: searchJobMetrics.runningJobCount,
      failed_job_count: searchJobMetrics.failedJobCount,
      oldest_pending_job_created_at: searchJobMetrics.oldestPendingJobCreatedAt?.toISOString() ?? null,
    },
    latest_sync_batch: latestBatch
      ? {
          provider_id: latestBatch.providerId,
          status: latestBatch.status,
          accepted_count: latestBatch.acceptedCount,
          rejected_count: latestBatch.rejectedCount,
          created_at: latestBatch.createdAt.toISOString(),
          finished_at: latestBatch.finishedAt?.toISOString() ?? null,
        }
      : null,
  };
}

async function getCatalogHealth() {
  const checkedAt = new Date().toISOString();
  try {
    const [providerCount, activeEntryCount] = await Promise.all([
      countRows(schema.providerContractStates, eq(schema.providerContractStates.catalogId, config.CATALOG_ID)),
      countRows(schema.catalogEntries, and(
        eq(schema.catalogEntries.catalogId, config.CATALOG_ID),
        eq(schema.catalogEntries.entryStatus, 'active'),
      )),
    ]);

    return {
      ocp_version: '1.0',
      kind: 'CatalogHealth',
      catalog_id: config.CATALOG_ID,
      status: 'healthy',
      ready: true,
      checked_at: checkedAt,
      manifest_version: `manifest_${config.CATALOG_ID}`,
      details: {
        catalog_name: config.CATALOG_NAME,
        provider_count: providerCount,
        active_entry_count: activeEntryCount,
        semantic_search_enabled: true,
      },
      dependencies: [
        {
          name: 'postgres',
          status: 'healthy',
        },
      ],
    };
  } catch (error) {
    return {
      ocp_version: '1.0',
      kind: 'CatalogHealth',
      catalog_id: config.CATALOG_ID,
      status: 'unhealthy',
      ready: false,
      checked_at: checkedAt,
      manifest_version: `manifest_${config.CATALOG_ID}`,
      details: {
        catalog_name: config.CATALOG_NAME,
      },
      dependencies: [
        {
          name: 'postgres',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function getOptionalCatalogDataProfile() {
  try {
    return await getCatalogDataProfile();
  } catch (error) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'catalog_data_profile_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }));
    return catalogDataProfileCache?.value;
  }
}

async function getCatalogDataProfile() {
  const now = Date.now();
  if (catalogDataProfileCache && catalogDataProfileCache.expiresAt > now) {
    return catalogDataProfileCache.value;
  }

  const value = await loadCatalogDataProfile();
  catalogDataProfileCache = {
    expiresAt: now + DATA_PROFILE_CACHE_TTL_MS,
    value,
  };
  return value;
}

async function loadCatalogDataProfile() {
  const objectCounts = await db
    .select({
      objectType: schema.catalogEntries.objectType,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.catalogEntries)
    .where(and(
      eq(schema.catalogEntries.catalogId, config.CATALOG_ID),
      eq(schema.catalogEntries.entryStatus, 'active'),
    ))
    .groupBy(schema.catalogEntries.objectType);

  return {
    catalog_entry_count: objectCounts.reduce((sum, row) => sum + row.count, 0),
    object_counts: objectCounts
      .map((row) => ({
        object_type: row.objectType,
        count: row.count,
      }))
      .sort((left, right) => left.object_type.localeCompare(right.object_type)),
    counted_at: new Date().toISOString(),
  };
}

async function countRows<T extends Parameters<typeof db.select>[0]>(
  table: Parameters<ReturnType<typeof db.select>['from']>[0],
  where: SQL | undefined,
) {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

async function getEntryMetrics() {
  const [row] = await db
    .select({
      activeEntryCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active')::int`,
      richEntryCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and ${schema.catalogEntries.searchProjection}->>'quality_tier' = 'rich')::int`,
      standardEntryCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and ${schema.catalogEntries.searchProjection}->>'quality_tier' = 'standard')::int`,
      basicEntryCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and coalesce(${schema.catalogEntries.searchProjection}->>'quality_tier', 'basic') not in ('rich', 'standard'))::int`,
      missingImageCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and coalesce((${schema.catalogEntries.searchProjection}->>'has_image')::boolean, false) is not true)::int`,
      missingProductUrlCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and coalesce((${schema.catalogEntries.searchProjection}->>'has_product_url')::boolean, false) is not true)::int`,
      outOfStockCount: sql<number>`count(*) filter (where ${schema.catalogEntries.entryStatus} = 'active' and ${schema.catalogEntries.searchProjection}->>'availability_status' = 'out_of_stock')::int`,
    })
    .from(schema.catalogEntries)
    .where(eq(schema.catalogEntries.catalogId, config.CATALOG_ID));

  return {
    activeEntryCount: row?.activeEntryCount ?? 0,
    richEntryCount: row?.richEntryCount ?? 0,
    standardEntryCount: row?.standardEntryCount ?? 0,
    basicEntryCount: row?.basicEntryCount ?? 0,
    missingImageCount: row?.missingImageCount ?? 0,
    missingProductUrlCount: row?.missingProductUrlCount ?? 0,
    outOfStockCount: row?.outOfStockCount ?? 0,
  };
}

async function getSearchDocumentMetrics() {
  const [row] = await db
    .select({
      activeDocumentCount: sql<number>`count(*) filter (where ${schema.catalogSearchDocuments.documentStatus} = 'active')::int`,
    })
    .from(schema.catalogSearchDocuments)
    .where(eq(schema.catalogSearchDocuments.catalogId, config.CATALOG_ID));

  return {
    activeDocumentCount: row?.activeDocumentCount ?? 0,
  };
}

async function getEmbeddingMetrics() {
  const [metrics] = await db
    .select({
      readyEmbeddingCount: sql<number>`count(*) filter (where ${schema.catalogSearchEmbeddings.status} = 'ready')::int`,
      failedEmbeddingCount: sql<number>`count(*) filter (where ${schema.catalogSearchEmbeddings.status} = 'failed')::int`,
    })
    .from(schema.catalogSearchEmbeddings)
    .where(eq(schema.catalogSearchEmbeddings.catalogId, config.CATALOG_ID));
  const [latestFailed] = await db
    .select({ error: schema.catalogSearchEmbeddings.error })
    .from(schema.catalogSearchEmbeddings)
    .where(and(eq(schema.catalogSearchEmbeddings.catalogId, config.CATALOG_ID), eq(schema.catalogSearchEmbeddings.status, 'failed')))
    .orderBy(desc(schema.catalogSearchEmbeddings.updatedAt))
    .limit(1);

  return {
    readyEmbeddingCount: metrics?.readyEmbeddingCount ?? 0,
    failedEmbeddingCount: metrics?.failedEmbeddingCount ?? 0,
    latestFailedEmbeddingError: latestFailed?.error ?? null,
  };
}

async function getActiveDocumentsMissingEmbeddingCount() {
  const [row] = await db
    .select({
      value: sql<number>`count(*)::int`,
    })
    .from(schema.catalogSearchDocuments)
    .leftJoin(
      schema.catalogSearchEmbeddings,
      and(
        eq(schema.catalogSearchEmbeddings.catalogSearchDocumentId, schema.catalogSearchDocuments.id),
        eq(schema.catalogSearchEmbeddings.status, 'ready'),
      ),
    )
    .where(and(
      eq(schema.catalogSearchDocuments.catalogId, config.CATALOG_ID),
      eq(schema.catalogSearchDocuments.documentStatus, 'active'),
      isNotNull(schema.catalogSearchDocuments.id),
      sql`${schema.catalogSearchEmbeddings.id} is null`,
    ));

  return row?.value ?? 0;
}

async function getSearchJobMetrics() {
  const [metrics] = await db
    .select({
      pendingJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'pending')::int`,
      runningJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'running')::int`,
      failedJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'failed')::int`,
    })
    .from(schema.catalogSearchIndexJobs)
    .where(eq(schema.catalogSearchIndexJobs.catalogId, config.CATALOG_ID));
  const [oldestPending] = await db
    .select({ createdAt: schema.catalogSearchIndexJobs.createdAt })
    .from(schema.catalogSearchIndexJobs)
    .where(and(eq(schema.catalogSearchIndexJobs.catalogId, config.CATALOG_ID), eq(schema.catalogSearchIndexJobs.status, 'pending')))
    .orderBy(schema.catalogSearchIndexJobs.createdAt)
    .limit(1);

  return {
    pendingJobCount: metrics?.pendingJobCount ?? 0,
    runningJobCount: metrics?.runningJobCount ?? 0,
    failedJobCount: metrics?.failedJobCount ?? 0,
    oldestPendingJobCreatedAt: oldestPending?.createdAt ?? null,
  };
}

async function getLatestSyncBatch() {
  const [row] = await db
    .select()
    .from(schema.objectSyncBatches)
    .where(eq(schema.objectSyncBatches.catalogId, config.CATALOG_ID))
    .orderBy(desc(schema.objectSyncBatches.createdAt))
    .limit(1);

  return row ?? null;
}

function logRequest(input: {
  request: Request;
  pathname?: string;
  status: number;
  durationMs?: number;
  error?: unknown;
}) {
  const level = input.status >= 500 ? 'error' : input.status >= 400 ? 'warn' : 'info';
  const logLine = {
    ts: new Date().toISOString(),
    level,
    event: 'http_request',
    method: input.request.method,
    path: input.pathname ?? new URL(input.request.url).pathname,
    status: input.status,
    duration_ms: input.durationMs !== undefined ? Number(input.durationMs.toFixed(2)) : undefined,
    user_agent: input.request.headers.get('user-agent') ?? undefined,
    error: input.error instanceof Error ? input.error.message : undefined,
  };

  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  writer(JSON.stringify(logLine));
}

function statusCode(value: unknown) {
  return typeof value === 'number' ? value : 200;
}

function summarizeSearchIndex(
  documents: Array<typeof schema.catalogSearchDocuments.$inferSelect>,
  embeddings: Array<typeof schema.catalogSearchEmbeddings.$inferSelect>,
  jobs: Array<typeof schema.catalogSearchIndexJobs.$inferSelect>,
) {
  const activeDocumentCount = documents.filter((row) => row.documentStatus === 'active').length;
  const readyEmbeddingDocumentIds = new Set(
    embeddings
      .filter((row) => row.status === 'ready')
      .map((row) => row.catalogSearchDocumentId),
  );
  const activeDocumentsMissingEmbedding = documents.filter((row) => (
    row.documentStatus === 'active' && !readyEmbeddingDocumentIds.has(row.id)
  )).length;
  const pendingJobs = jobs.filter((row) => row.status === 'pending');
  const runningJobs = jobs.filter((row) => row.status === 'running');
  const failedJobs = jobs.filter((row) => row.status === 'failed');
  const failedEmbeddings = embeddings.filter((row) => row.status === 'failed');
  const oldestPendingJob = pendingJobs
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0] ?? null;
  const latestFailedEmbedding = failedEmbeddings
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;

  return {
    active_document_count: activeDocumentCount,
    ready_embedding_count: readyEmbeddingDocumentIds.size,
    failed_embedding_count: failedEmbeddings.length,
    latest_failed_embedding_error: latestFailedEmbedding?.error ?? null,
    active_documents_missing_embedding_count: activeDocumentsMissingEmbedding,
    embedding_readiness_ratio: activeDocumentCount > 0
      ? Number(((activeDocumentCount - activeDocumentsMissingEmbedding) / activeDocumentCount).toFixed(4))
      : 1,
    pending_job_count: pendingJobs.length,
    running_job_count: runningJobs.length,
    failed_job_count: failedJobs.length,
    oldest_pending_job_created_at: oldestPendingJob?.createdAt.toISOString() ?? null,
  };
}

async function getCatalogAdminProviders() {
  const [states, registrations, batches] = await Promise.all([
    db.select().from(schema.providerContractStates),
    db.select().from(schema.providerRegistrations),
    db.select().from(schema.objectSyncBatches),
  ]);

  const catalogStates = states
    .filter((row) => row.catalogId === config.CATALOG_ID)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  const providers = await Promise.all(catalogStates.map(async (state) => {
    const provider = await services.registrations.getProvider(state.providerId);
    const latestRegistration = registrations
      .filter((row) => row.catalogId === config.CATALOG_ID && row.providerId === state.providerId)
      .sort((left, right) => right.registrationVersion - left.registrationVersion)[0] ?? null;

    const latestBatch = batches
      .filter((row) => row.catalogId === config.CATALOG_ID && row.providerId === state.providerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;

    return {
      provider_id: provider.provider_id,
      status: provider.status,
      active_registration_version: provider.active_registration_version,
      guaranteed_fields: provider.guaranteed_fields,
      declared_packs: provider.declared_packs,
      catalog_quality: provider.catalog_quality,
      updated_at: provider.updated_at,
      latest_registration: latestRegistration
        ? {
            registration_version: latestRegistration.registrationVersion,
            status: latestRegistration.status,
            updated_at: latestRegistration.updatedAt.toISOString(),
          }
        : null,
      latest_sync_batch: latestBatch
        ? {
            status: latestBatch.status,
            accepted_count: latestBatch.acceptedCount,
            rejected_count: latestBatch.rejectedCount,
            created_at: latestBatch.createdAt.toISOString(),
          }
        : null,
    };
  }));

  return {
    catalog_id: config.CATALOG_ID,
    providers,
  };
}

async function getCatalogAdminEntries(query: Record<string, string | undefined>) {
  const [entries, objects] = await Promise.all([
    db.select().from(schema.catalogEntries),
    db.select().from(schema.commercialObjects),
  ]);

  const objectByCommercialId = new Map(
    objects
      .filter((row) => row.catalogId === config.CATALOG_ID)
      .map((row) => [row.id, row] as const),
  );

  const items = entries
    .filter((row) => row.catalogId === config.CATALOG_ID)
    .map((entry) => {
      const object = objectByCommercialId.get(entry.commercialObjectId);
      return {
        entry_id: entry.id,
        commercial_object_id: entry.commercialObjectId,
        provider_id: entry.providerId,
        object_id: entry.objectId,
        object_type: entry.objectType,
        entry_status: entry.entryStatus,
        contract_match_status: entry.contractMatchStatus,
        title: entry.title,
        summary: entry.summary,
        brand: entry.brand,
        category: entry.category,
        currency: entry.currency,
        availability_status: entry.availabilityStatus,
        search_projection: entry.searchProjection,
        explain_projection: entry.explainProjection,
        updated_at: entry.updatedAt.toISOString(),
        raw_object: object?.rawObject ?? null,
        object_status: object?.status ?? null,
        object_source_url: object?.sourceUrl ?? null,
        object_updated_at: object?.updatedAt.toISOString() ?? null,
      };
    })
    .filter((entry) => {
      if (query.provider_id && entry.provider_id !== query.provider_id) return false;
      if (query.entry_status && entry.entry_status !== query.entry_status) return false;
      if (query.quality_tier) {
        const qualityTier = typeof entry.search_projection.quality_tier === 'string' ? entry.search_projection.quality_tier : 'basic';
        if (qualityTier !== query.quality_tier) return false;
      }
      if (query.search) {
        const haystack = `${entry.title} ${entry.object_id} ${entry.provider_id} ${entry.brand ?? ''} ${entry.category ?? ''}`.toLowerCase();
        if (!haystack.includes(query.search.toLowerCase())) return false;
      }
      return true;
    })
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));

  return {
    catalog_id: config.CATALOG_ID,
    entries: items,
  };
}

async function registerCatalogInRegistration() {
  const hostname = new URL(config.CATALOG_PUBLIC_BASE_URL).hostname;
  const registrationVersion = await nextCatalogRegistrationVersion();
  return postRegistrationJson('/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${crypto.randomUUID().replaceAll('-', '')}`,
    registration_id: config.REGISTRATION_ID,
    catalog_id: config.CATALOG_ID,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    homepage: config.CATALOG_PUBLIC_BASE_URL,
    well_known_url: `${config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/ocp-catalog`,
    claimed_domains: [hostname],
    intended_visibility: 'public',
    tags: ['commerce', 'demo'],
  });
}

async function nextCatalogRegistrationVersion() {
  const response = await fetch(`${config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '')}/ocp/catalogs/${config.CATALOG_ID}`);
  if (!response.ok) return 1;

  const payload = await response.json().catch(() => ({}));
  const activeVersion = numberPayload(payload, 'activeRegistrationVersion') ?? numberPayload(payload, 'active_registration_version');
  return activeVersion !== undefined ? activeVersion + 1 : 1;
}

async function postRegistrationJson(pathname: string, body: Record<string, unknown>, catalogToken?: string | null) {
  const response = await fetch(`${config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '')}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(catalogToken ? { 'x-catalog-token': catalogToken } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError('internal_error', payload?.error?.message ?? `Registration request failed with status ${response.status}`, response.status, payload);
  }

  return payload;
}

function getBodyString(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getBodyNumber(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function enqueueSearchIndexJobs(result: {
  catalog_id: string;
  provider_id: string;
  registration_version: number;
  items: Array<{
    status: string;
    object_id?: string;
    commercial_object_id?: string;
    catalog_entry_id?: string;
    warnings: string[];
  }>;
}) {
  for (const item of result.items) {
    if (item.status !== 'accepted' || !item.catalog_entry_id || !item.commercial_object_id) continue;
    try {
      await searchIndexJobs.enqueueDocumentUpsert({
        catalogId: result.catalog_id,
        providerId: result.provider_id,
        catalogEntryId: item.catalog_entry_id,
        commercialObjectId: item.commercial_object_id,
        payload: {
          object_id: item.object_id,
          registration_version: result.registration_version,
        },
      });
    } catch (error) {
      item.warnings.push(`Search index job enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function summarizeEntryQuality(rows: Array<{
  entryStatus: string;
  projection: Record<string, unknown>;
}>) {
  const summary = {
    rich_entry_count: 0,
    standard_entry_count: 0,
    basic_entry_count: 0,
    missing_image_count: 0,
    missing_product_url_count: 0,
    out_of_stock_count: 0,
  };

  for (const row of rows) {
    if (row.entryStatus !== 'active') continue;
    const qualityTier = typeof row.projection.quality_tier === 'string' ? row.projection.quality_tier : 'basic';
    if (qualityTier === 'rich') summary.rich_entry_count += 1;
    else if (qualityTier === 'standard') summary.standard_entry_count += 1;
    else summary.basic_entry_count += 1;

    if (row.projection.has_image !== true) summary.missing_image_count += 1;
    if (row.projection.has_product_url !== true) summary.missing_product_url_count += 1;
    if (row.projection.availability_status === 'out_of_stock') summary.out_of_stock_count += 1;
  }

  return summary;
}
