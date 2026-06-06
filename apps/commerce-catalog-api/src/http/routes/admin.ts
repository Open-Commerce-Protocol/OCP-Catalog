import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildCatalogManifest } from '@ocp-catalog/catalog-core';
import { schema } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { and, count, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../../runtime/context';
import { firstHeader } from '../request-context';

type Db = CommerceCatalogRuntimeContext['db'];
type QueryTable = Parameters<ReturnType<Db['select']>['from']>[0];

const SEARCH_INDEX_RUN_DEFAULT_LIMIT = 25;
const SEARCH_INDEX_RUN_DEFAULT_RETRY_DELAY_MS = 30_000;

export function catalogAdminApiRoutes(context: CommerceCatalogRuntimeContext) {
  return new Elysia()
    .get('/api/catalog-admin/overview', async ({ headers }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminOverview(context);
    })
    .get('/api/catalog-admin/providers', async ({ headers }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminProviders(context);
    })
    .get('/api/catalog-admin/entries', async ({ headers, query }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminEntries(context, query);
    })
    .post('/api/catalog-admin/registration/register', async ({ headers }) => {
      assertAdminAuth(context, headers);
      return registerCatalogInRegistration(context);
    })
    .post('/api/catalog-admin/registration/verify', async ({ headers }) => {
      assertAdminAuth(context, headers);
      return postRegistrationJson(context, `/ocp/catalogs/${context.config.CATALOG_ID}/verify`, {});
    })
    .post('/api/catalog-admin/registration/refresh', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      const token = getOptionalBodyString(body, 'catalog_token');
      return postRegistrationJson(context, `/ocp/catalogs/${context.config.CATALOG_ID}/refresh`, {}, token);
    })
    .post('/api/catalog-admin/registration/token/rotate', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      const token = getOptionalBodyString(body, 'catalog_token');
      return postRegistrationJson(context, `/ocp/catalogs/${context.config.CATALOG_ID}/token/rotate`, {}, token);
    })
    .post('/api/catalog-admin/search-index/run', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      return context.searchIndexWorker.runBatch({
        catalogId: context.config.CATALOG_ID,
        limit: getOptionalBodyNumber(body, 'limit') ?? SEARCH_INDEX_RUN_DEFAULT_LIMIT,
        retryDelayMs: getOptionalBodyNumber(body, 'retry_delay_ms') ?? SEARCH_INDEX_RUN_DEFAULT_RETRY_DELAY_MS,
      });
    })
    .post('/api/catalog-admin/search-index/rebuild-provider', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      const providerId = getRequiredBodyString(body, 'provider_id');
      return context.searchIndexJobs.enqueue({
        catalogId: context.config.CATALOG_ID,
        providerId,
        jobType: 'rebuild_all_for_provider',
        payload: {
          requested_from: 'catalog-admin',
        },
      });
    });
}

function assertAdminAuth(context: CommerceCatalogRuntimeContext, headers: Record<string, string | undefined>) {
  requireApiKey(
    firstHeader(headers['x-admin-key']),
    context.config.CATALOG_ADMIN_API_KEY,
    context.config.CATALOG_ADMIN_API_KEYS,
  );
}

async function getCatalogAdminOverview(context: CommerceCatalogRuntimeContext) {
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
    countRows(context, schema.providerContractStates, eq(schema.providerContractStates.catalogId, context.config.CATALOG_ID)),
    countRows(context, schema.commercialObjects, eq(schema.commercialObjects.catalogId, context.config.CATALOG_ID)),
    getEntryMetrics(context),
    getSearchDocumentMetrics(context),
    getEmbeddingMetrics(context),
    getActiveDocumentsMissingEmbeddingCount(context),
    getSearchJobMetrics(context),
    countRows(context, schema.queryAuditRecords, eq(schema.queryAuditRecords.catalogId, context.config.CATALOG_ID)),
    getLatestSyncBatch(context),
  ]);

  const embeddingReadinessRatio = searchDocumentMetrics.activeDocumentCount > 0
    ? Number(((searchDocumentMetrics.activeDocumentCount - activeDocumentsMissingEmbeddingCount) / searchDocumentMetrics.activeDocumentCount).toFixed(4))
    : 1;

  return {
    catalog_id: context.config.CATALOG_ID,
    catalog_name: context.config.CATALOG_NAME,
    semantic_search_enabled: true,
    query_packs: buildCatalogManifest(context.config, context.commerceCatalogScenario).query_capabilities.flatMap((capability) => (
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

async function countRows(context: CommerceCatalogRuntimeContext, table: QueryTable, where: SQL | undefined) {
  const [row] = await context.db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

async function getEntryMetrics(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
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
    .where(eq(schema.catalogEntries.catalogId, context.config.CATALOG_ID));

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

async function getSearchDocumentMetrics(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
    .select({
      activeDocumentCount: sql<number>`count(*) filter (where ${schema.catalogSearchDocuments.documentStatus} = 'active')::int`,
    })
    .from(schema.catalogSearchDocuments)
    .where(eq(schema.catalogSearchDocuments.catalogId, context.config.CATALOG_ID));

  return {
    activeDocumentCount: row?.activeDocumentCount ?? 0,
  };
}

async function getEmbeddingMetrics(context: CommerceCatalogRuntimeContext) {
  const [metrics] = await context.db
    .select({
      readyEmbeddingCount: sql<number>`count(*) filter (where ${schema.catalogSearchEmbeddings.status} = 'ready')::int`,
      failedEmbeddingCount: sql<number>`count(*) filter (where ${schema.catalogSearchEmbeddings.status} = 'failed')::int`,
    })
    .from(schema.catalogSearchEmbeddings)
    .where(eq(schema.catalogSearchEmbeddings.catalogId, context.config.CATALOG_ID));
  const [latestFailed] = await context.db
    .select({ error: schema.catalogSearchEmbeddings.error })
    .from(schema.catalogSearchEmbeddings)
    .where(and(eq(schema.catalogSearchEmbeddings.catalogId, context.config.CATALOG_ID), eq(schema.catalogSearchEmbeddings.status, 'failed')))
    .orderBy(desc(schema.catalogSearchEmbeddings.updatedAt))
    .limit(1);

  return {
    readyEmbeddingCount: metrics?.readyEmbeddingCount ?? 0,
    failedEmbeddingCount: metrics?.failedEmbeddingCount ?? 0,
    latestFailedEmbeddingError: latestFailed?.error ?? null,
  };
}

async function getActiveDocumentsMissingEmbeddingCount(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
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
      eq(schema.catalogSearchDocuments.catalogId, context.config.CATALOG_ID),
      eq(schema.catalogSearchDocuments.documentStatus, 'active'),
      isNotNull(schema.catalogSearchDocuments.id),
      sql`${schema.catalogSearchEmbeddings.id} is null`,
    ));

  return row?.value ?? 0;
}

async function getSearchJobMetrics(context: CommerceCatalogRuntimeContext) {
  const [metrics] = await context.db
    .select({
      pendingJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'pending')::int`,
      runningJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'running')::int`,
      failedJobCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'failed')::int`,
    })
    .from(schema.catalogSearchIndexJobs)
    .where(eq(schema.catalogSearchIndexJobs.catalogId, context.config.CATALOG_ID));
  const [oldestPending] = await context.db
    .select({ createdAt: schema.catalogSearchIndexJobs.createdAt })
    .from(schema.catalogSearchIndexJobs)
    .where(and(eq(schema.catalogSearchIndexJobs.catalogId, context.config.CATALOG_ID), eq(schema.catalogSearchIndexJobs.status, 'pending')))
    .orderBy(schema.catalogSearchIndexJobs.createdAt)
    .limit(1);

  return {
    pendingJobCount: metrics?.pendingJobCount ?? 0,
    runningJobCount: metrics?.runningJobCount ?? 0,
    failedJobCount: metrics?.failedJobCount ?? 0,
    oldestPendingJobCreatedAt: oldestPending?.createdAt ?? null,
  };
}

async function getLatestSyncBatch(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
    .select()
    .from(schema.objectSyncBatches)
    .where(eq(schema.objectSyncBatches.catalogId, context.config.CATALOG_ID))
    .orderBy(desc(schema.objectSyncBatches.createdAt))
    .limit(1);

  return row ?? null;
}

async function getCatalogAdminProviders(context: CommerceCatalogRuntimeContext) {
  const [states, registrations, batches] = await Promise.all([
    context.db.select().from(schema.providerContractStates),
    context.db.select().from(schema.providerRegistrations),
    context.db.select().from(schema.objectSyncBatches),
  ]);

  const catalogStates = states
    .filter((row) => row.catalogId === context.config.CATALOG_ID)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  const providers = await Promise.all(catalogStates.map(async (state) => {
    const provider = await context.services.registrations.getProvider(state.providerId);
    const latestRegistration = registrations
      .filter((row) => row.catalogId === context.config.CATALOG_ID && row.providerId === state.providerId)
      .sort((left, right) => right.registrationVersion - left.registrationVersion)[0] ?? null;

    const latestBatch = batches
      .filter((row) => row.catalogId === context.config.CATALOG_ID && row.providerId === state.providerId)
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
    catalog_id: context.config.CATALOG_ID,
    providers,
  };
}

async function getCatalogAdminEntries(context: CommerceCatalogRuntimeContext, query: Record<string, string | undefined>) {
  const [entries, objects] = await Promise.all([
    context.db.select().from(schema.catalogEntries),
    context.db.select().from(schema.commercialObjects),
  ]);

  const objectByCommercialId = new Map(
    objects
      .filter((row) => row.catalogId === context.config.CATALOG_ID)
      .map((row) => [row.id, row] as const),
  );

  const items = entries
    .filter((row) => row.catalogId === context.config.CATALOG_ID)
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
    catalog_id: context.config.CATALOG_ID,
    entries: items,
  };
}

async function registerCatalogInRegistration(context: CommerceCatalogRuntimeContext) {
  const hostname = new URL(context.config.CATALOG_PUBLIC_BASE_URL).hostname;
  const registrationVersion = await nextCatalogRegistrationVersion(context);
  return postRegistrationJson(context, '/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${crypto.randomUUID().replaceAll('-', '')}`,
    registration_id: context.config.REGISTRATION_ID,
    catalog_id: context.config.CATALOG_ID,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    homepage: context.config.CATALOG_PUBLIC_BASE_URL,
    well_known_url: `${context.config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/ocp-catalog`,
    claimed_domains: [hostname],
    intended_visibility: 'public',
    tags: ['commerce', 'demo'],
  });
}

async function nextCatalogRegistrationVersion(context: CommerceCatalogRuntimeContext) {
  const pathname = `/ocp/catalogs/${context.config.CATALOG_ID}`;
  const response = await fetch(`${context.config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '')}${pathname}`);
  if (response.status === 404) return 1;
  const payload = await readRegistrationJson(response, pathname);
  if (!response.ok) {
    throw registrationRequestError(response, payload, pathname);
  }

  return getRequiredPayloadNumber(payload, 'activeRegistrationVersion') + 1;
}

async function postRegistrationJson(
  context: CommerceCatalogRuntimeContext,
  pathname: string,
  body: Record<string, unknown>,
  catalogToken?: string | null,
) {
  const response = await fetch(`${context.config.REGISTRATION_PUBLIC_BASE_URL.replace(/\/$/, '')}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(catalogToken ? { 'x-catalog-token': catalogToken } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await readRegistrationJson(response, pathname);
  if (!response.ok) {
    throw registrationRequestError(response, payload, pathname);
  }

  return payload;
}

async function readRegistrationJson(response: Response, pathname: string) {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new AppError('internal_error', `Registration response for ${pathname} is not valid JSON`, response.ok ? 502 : response.status, {
      status: response.status,
      parse_error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('internal_error', `Registration response for ${pathname} must be a JSON object`, response.ok ? 502 : response.status, {
      status: response.status,
      payload,
    });
  }

  return payload as Record<string, unknown>;
}

function registrationRequestError(response: Response, payload: Record<string, unknown>, pathname: string) {
  const message = readErrorMessage(payload) ?? `Registration request ${pathname} failed with status ${response.status}`;
  return new AppError('internal_error', message, response.status, payload);
}

function readErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined;
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

function getOptionalBodyString(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getRequiredBodyString(body: unknown, key: string) {
  const value = getOptionalBodyString(body, key);
  if (!value) {
    throw new AppError('validation_error', `${key} is required`, 400, { field: key });
  }
  return value;
}

function getRequiredPayloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('internal_error', `Registration response is missing numeric ${key}`, 502, { field: key, payload });
  }
  return value;
}

function getOptionalBodyNumber(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
