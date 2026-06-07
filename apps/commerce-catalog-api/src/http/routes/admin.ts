import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildCatalogManifest } from '@ocp-catalog/catalog-core';
import { schema } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { and, count, desc, eq, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../../runtime/context';
import { firstHeader } from '../request-context';

type Db = CommerceCatalogRuntimeContext['db'];
type QueryTable = Parameters<ReturnType<Db['select']>['from']>[0];

const ADMIN_DEFAULT_PAGE_LIMIT = 50;
const ADMIN_MAX_PAGE_LIMIT = 100;

export function catalogAdminApiRoutes(context: CommerceCatalogRuntimeContext) {
  return new Elysia()
    .get('/api/catalog-admin/overview', async ({ headers }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminOverview(context);
    })
    .get('/api/catalog-admin/providers', async ({ headers, query }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminProviders(context, query);
    })
    .get('/api/catalog-admin/entries', async ({ headers, query }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminEntries(context, query);
    })
    .post('/api/catalog-admin/registration/register', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      return runRegistrationTargets(context, body, (target) => registerCatalogInRegistration(context, target));
    })
    .post('/api/catalog-admin/registration/verify', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      return runRegistrationTargets(context, body, (target) => postRegistrationJson(target, `/ocp/catalogs/${context.config.CATALOG_ID}/verify`, {}));
    })
    .post('/api/catalog-admin/registration/refresh', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      return runRegistrationTargets(context, body, (target) => (
        postRegistrationJson(target, `/ocp/catalogs/${context.config.CATALOG_ID}/refresh`, {}, getCatalogTokenForTarget(body, target))
      ));
    })
    .post('/api/catalog-admin/registration/token/rotate', async ({ headers, body }) => {
      assertAdminAuth(context, headers);
      return runRegistrationTargets(context, body, (target) => (
        postRegistrationJson(target, `/ocp/catalogs/${context.config.CATALOG_ID}/token/rotate`, {}, getCatalogTokenForTarget(body, target))
      ));
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
    outboxMetrics,
    queryAuditCount,
    latestRun,
    latestChunk,
  ] = await Promise.all([
    countRows(context, schema.providerContractStates, eq(schema.providerContractStates.catalogId, context.config.CATALOG_ID)),
    countRows(context, schema.commercialObjects, eq(schema.commercialObjects.catalogId, context.config.CATALOG_ID)),
    getEntryMetrics(context),
    getSearchDocumentMetrics(context),
    getEmbeddingMetrics(context),
    getActiveDocumentsMissingEmbeddingCount(context),
    getSearchJobMetrics(context),
    getOutboxMetrics(context),
    countRows(context, schema.queryAuditRecords, eq(schema.queryAuditRecords.catalogId, context.config.CATALOG_ID)),
    getLatestSyncRun(context),
    getLatestSyncChunk(context),
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
      pending_outbox_count: outboxMetrics.pendingOutboxCount,
      running_outbox_count: outboxMetrics.runningOutboxCount,
      failed_outbox_count: outboxMetrics.failedOutboxCount,
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
    outbox: {
      pending_count: outboxMetrics.pendingOutboxCount,
      running_count: outboxMetrics.runningOutboxCount,
      failed_count: outboxMetrics.failedOutboxCount,
      oldest_pending_created_at: outboxMetrics.oldestPendingOutboxCreatedAt?.toISOString() ?? null,
    },
    latest_sync_run: latestRun
      ? {
          provider_id: latestRun.providerId,
          sync_run_id: latestRun.syncRunId,
          run_mode: latestRun.runMode,
          status: latestRun.status,
          batch_count: latestRun.batchCount,
          accepted_count: latestRun.acceptedCount,
          rejected_count: latestRun.rejectedCount,
          error_count: latestRun.errorCount,
          created_at: latestRun.createdAt.toISOString(),
          finished_at: latestRun.finishedAt?.toISOString() ?? null,
        }
      : null,
    latest_sync_chunk: latestChunk
      ? {
          provider_id: latestChunk.providerId,
          status: latestChunk.status,
          accepted_count: latestChunk.acceptedCount,
          rejected_count: latestChunk.rejectedCount,
          created_at: latestChunk.createdAt.toISOString(),
          finished_at: latestChunk.finishedAt?.toISOString() ?? null,
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

async function getOutboxMetrics(context: CommerceCatalogRuntimeContext) {
  const [metrics] = await context.db
    .select({
      pendingOutboxCount: sql<number>`count(*) filter (where ${schema.catalogOutboxEvents.status} = 'pending')::int`,
      runningOutboxCount: sql<number>`count(*) filter (where ${schema.catalogOutboxEvents.status} = 'running')::int`,
      failedOutboxCount: sql<number>`count(*) filter (where ${schema.catalogOutboxEvents.status} = 'failed')::int`,
    })
    .from(schema.catalogOutboxEvents)
    .where(eq(schema.catalogOutboxEvents.catalogId, context.config.CATALOG_ID));
  const [oldestPending] = await context.db
    .select({ createdAt: schema.catalogOutboxEvents.createdAt })
    .from(schema.catalogOutboxEvents)
    .where(and(eq(schema.catalogOutboxEvents.catalogId, context.config.CATALOG_ID), eq(schema.catalogOutboxEvents.status, 'pending')))
    .orderBy(schema.catalogOutboxEvents.createdAt)
    .limit(1);

  return {
    pendingOutboxCount: metrics?.pendingOutboxCount ?? 0,
    runningOutboxCount: metrics?.runningOutboxCount ?? 0,
    failedOutboxCount: metrics?.failedOutboxCount ?? 0,
    oldestPendingOutboxCreatedAt: oldestPending?.createdAt ?? null,
  };
}

async function getLatestSyncRun(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
    .select()
    .from(schema.objectSyncRuns)
    .where(eq(schema.objectSyncRuns.catalogId, context.config.CATALOG_ID))
    .orderBy(desc(schema.objectSyncRuns.createdAt))
    .limit(1);

  return row ?? null;
}

async function getLatestSyncChunk(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
    .select()
    .from(schema.objectSyncChunks)
    .where(eq(schema.objectSyncChunks.catalogId, context.config.CATALOG_ID))
    .orderBy(desc(schema.objectSyncChunks.createdAt))
    .limit(1);

  return row ?? null;
}

async function getCatalogAdminProviders(context: CommerceCatalogRuntimeContext, query: Record<string, string | undefined>) {
  const page = parseKeysetPage(query);
  const conditions: SQL[] = [eq(schema.providerContractStates.catalogId, context.config.CATALOG_ID)];
  if (page.cursor) {
    conditions.push(or(
      lt(schema.providerContractStates.updatedAt, page.cursor.at),
      and(
        eq(schema.providerContractStates.updatedAt, page.cursor.at),
        lt(schema.providerContractStates.id, page.cursor.id),
      ),
    )!);
  }

  const rows = await context.db
    .select()
    .from(schema.providerContractStates)
    .where(and(...conditions))
    .orderBy(desc(schema.providerContractStates.updatedAt), desc(schema.providerContractStates.id))
    .limit(page.limit + 1);
  const catalogStates = rows.slice(0, page.limit);

  const providers = await Promise.all(catalogStates.map(async (state) => {
    const [provider, latestRegistrationRows, latestRunRows, latestChunkRows] = await Promise.all([
      context.services.registrations.getProvider(state.providerId),
      context.db
        .select()
        .from(schema.providerRegistrations)
        .where(and(
          eq(schema.providerRegistrations.catalogId, context.config.CATALOG_ID),
          eq(schema.providerRegistrations.providerId, state.providerId),
        ))
        .orderBy(desc(schema.providerRegistrations.registrationVersion))
        .limit(1),
      context.db
        .select()
        .from(schema.objectSyncRuns)
        .where(and(
          eq(schema.objectSyncRuns.catalogId, context.config.CATALOG_ID),
          eq(schema.objectSyncRuns.providerId, state.providerId),
        ))
        .orderBy(desc(schema.objectSyncRuns.createdAt), desc(schema.objectSyncRuns.id))
        .limit(1),
      context.db
        .select()
        .from(schema.objectSyncChunks)
        .where(and(
          eq(schema.objectSyncChunks.catalogId, context.config.CATALOG_ID),
          eq(schema.objectSyncChunks.providerId, state.providerId),
        ))
        .orderBy(desc(schema.objectSyncChunks.createdAt), desc(schema.objectSyncChunks.id))
        .limit(1),
    ]);
    const latestRegistration = latestRegistrationRows[0] ?? null;
    const latestRun = latestRunRows[0] ?? null;
    const latestChunk = latestChunkRows[0] ?? null;

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
      latest_sync_run: latestRun
        ? {
            sync_run_id: latestRun.syncRunId,
            run_mode: latestRun.runMode,
            status: latestRun.status,
            batch_count: latestRun.batchCount,
            accepted_count: latestRun.acceptedCount,
            rejected_count: latestRun.rejectedCount,
            error_count: latestRun.errorCount,
            created_at: latestRun.createdAt.toISOString(),
            finished_at: latestRun.finishedAt?.toISOString() ?? null,
          }
        : null,
      latest_sync_chunk: latestChunk
        ? {
            status: latestChunk.status,
            accepted_count: latestChunk.acceptedCount,
            rejected_count: latestChunk.rejectedCount,
            created_at: latestChunk.createdAt.toISOString(),
          }
        : null,
    };
  }));

  return {
    catalog_id: context.config.CATALOG_ID,
    providers,
    page: buildPage(page.limit, catalogStates, rows.length > page.limit, (row) => ({
      at: row.updatedAt,
      id: row.id,
    })),
  };
}

async function getCatalogAdminEntries(context: CommerceCatalogRuntimeContext, query: Record<string, string | undefined>) {
  const page = parseKeysetPage(query);
  const conditions: SQL[] = [eq(schema.catalogEntries.catalogId, context.config.CATALOG_ID)];
  if (query.provider_id) conditions.push(eq(schema.catalogEntries.providerId, query.provider_id));
  if (query.entry_status) conditions.push(eq(schema.catalogEntries.entryStatus, query.entry_status as 'active' | 'inactive' | 'rejected' | 'pending_verification'));
  if (query.quality_tier) {
    conditions.push(query.quality_tier === 'basic'
      ? sql`coalesce(${schema.catalogEntries.searchProjection}->>'quality_tier', 'basic') not in ('rich', 'standard')`
      : sql`${schema.catalogEntries.searchProjection}->>'quality_tier' = ${query.quality_tier}`);
  }
  if (query.search?.trim()) {
    const pattern = `%${query.search.trim().toLowerCase()}%`;
    conditions.push(sql`lower(concat_ws(' ',
      ${schema.catalogEntries.title},
      ${schema.catalogEntries.objectId},
      ${schema.catalogEntries.providerId},
      ${schema.catalogEntries.brand},
      ${schema.catalogEntries.category}
    )) like ${pattern}`);
  }
  if (page.cursor) {
    conditions.push(or(
      lt(schema.catalogEntries.updatedAt, page.cursor.at),
      and(
        eq(schema.catalogEntries.updatedAt, page.cursor.at),
        lt(schema.catalogEntries.id, page.cursor.id),
      ),
    )!);
  }

  const rows = await context.db
    .select({
      entry: schema.catalogEntries,
      object: schema.commercialObjects,
    })
    .from(schema.catalogEntries)
    .leftJoin(schema.commercialObjects, eq(schema.commercialObjects.id, schema.catalogEntries.commercialObjectId))
    .where(and(...conditions))
    .orderBy(desc(schema.catalogEntries.updatedAt), desc(schema.catalogEntries.id))
    .limit(page.limit + 1);

  const pageRows = rows.slice(0, page.limit);
  const items = pageRows.map(({ entry, object }) => ({
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
  }));

  return {
    catalog_id: context.config.CATALOG_ID,
    entries: items,
    page: buildPage(page.limit, pageRows, rows.length > page.limit, (row) => ({
      at: row.entry.updatedAt,
      id: row.entry.id,
    })),
  };
}

type RegistrationTarget = {
  baseUrl: string;
};

async function runRegistrationTargets(
  context: CommerceCatalogRuntimeContext,
  body: unknown,
  action: (target: RegistrationTarget) => Promise<Record<string, unknown>>,
) {
  const targets = getRegistrationTargets(context, body);
  const results = await Promise.allSettled(targets.map(async (target) => ({
    registration_url: target.baseUrl,
    result: await action(target),
  })));
  const mapped = results.map((result, index) => {
    const target = targets[index];
    if (result.status === 'fulfilled') return { status: 'fulfilled' as const, ...result.value };
    return {
      status: 'rejected' as const,
      registration_url: target.baseUrl,
      error: serializeRegistrationActionError(result.reason),
    };
  });

  const failed = mapped.filter((result) => result.status === 'rejected');
  const onlyResult = mapped[0];
  if (onlyResult && onlyResult.status === 'fulfilled' && mapped.length === 1) return onlyResult.result;
  return {
    registration_target_count: targets.length,
    fulfilled_count: mapped.length - failed.length,
    failed_count: failed.length,
    results: mapped,
  };
}

function getRegistrationTargets(context: CommerceCatalogRuntimeContext, body: unknown): RegistrationTarget[] {
  const values = getOptionalBodyStringArray(body, 'registration_urls');
  const urls = values.length > 0 ? values : [context.config.REGISTRATION_PUBLIC_BASE_URL];
  const unique = [...new Set(urls.map((url) => normalizeRegistrationUrl(url)))];
  return unique.map((baseUrl) => ({ baseUrl }));
}

function normalizeRegistrationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('validation_error', 'registration_urls must contain valid URLs', 400, { value });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('validation_error', 'registration_urls only supports http or https URLs', 400, { value });
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

async function registerCatalogInRegistration(context: CommerceCatalogRuntimeContext, target: RegistrationTarget) {
  const hostname = new URL(context.config.CATALOG_PUBLIC_BASE_URL).hostname;
  const [registrationVersion, registrationId] = await Promise.all([
    nextCatalogRegistrationVersion(context, target),
    getTargetRegistrationId(context, target),
  ]);
  return postRegistrationJson(target, '/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${crypto.randomUUID().replaceAll('-', '')}`,
    registration_id: registrationId,
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

async function nextCatalogRegistrationVersion(context: CommerceCatalogRuntimeContext, target: RegistrationTarget) {
  const pathname = `/ocp/catalogs/${context.config.CATALOG_ID}`;
  const response = await fetch(`${target.baseUrl}${pathname}`);
  if (response.status === 404) return 1;
  const payload = await readRegistrationJson(response, pathname);
  if (!response.ok) {
    throw registrationRequestError(response, payload, pathname);
  }

  return getRequiredPayloadNumber(payload, 'activeRegistrationVersion') + 1;
}

async function getTargetRegistrationId(context: CommerceCatalogRuntimeContext, target: RegistrationTarget) {
  const manifest = await fetchRegistrationMetadata(target, '/ocp/registration/manifest');
  const manifestId = readPayloadString(manifest, 'registration_id');
  if (manifestId) return manifestId;

  const discovery = await fetchRegistrationMetadata(target, '/.well-known/ocp-registration');
  const discoveryId = readPayloadString(discovery, 'registration_id');
  return discoveryId ?? context.config.REGISTRATION_ID;
}

async function fetchRegistrationMetadata(target: RegistrationTarget, pathname: string) {
  try {
    const response = await fetch(`${target.baseUrl}${pathname}`);
    if (!response.ok) return null;
    return readRegistrationJson(response, pathname);
  } catch {
    return null;
  }
}

async function postRegistrationJson(
  target: RegistrationTarget,
  pathname: string,
  body: Record<string, unknown>,
  catalogToken?: string | null,
) {
  const response = await fetch(`${target.baseUrl}${pathname}`, {
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

function getOptionalBodyStringArray(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return [];
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function getCatalogTokenForTarget(body: unknown, target: RegistrationTarget) {
  const scoped = getOptionalBodyStringRecord(body, 'catalog_tokens');
  return scoped[normalizeRegistrationUrl(target.baseUrl)] ?? scoped[target.baseUrl] ?? getOptionalBodyString(body, 'catalog_token');
}

function getOptionalBodyStringRecord(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return {};
  const value = (body as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([entryKey, entryValue]) => (
      typeof entryValue === 'string' && entryValue.trim()
        ? [[normalizeRegistrationUrl(entryKey), entryValue.trim()]]
        : []
    )),
  );
}

function getRequiredBodyString(body: unknown, key: string) {
  const value = getOptionalBodyString(body, key);
  if (!value) {
    throw new AppError('validation_error', `${key} is required`, 400, { field: key });
  }
  return value;
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function serializeRegistrationActionError(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function getRequiredPayloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('internal_error', `Registration response is missing numeric ${key}`, 502, { field: key, payload });
  }
  return value;
}

type KeysetCursor = {
  at: Date;
  id: string;
};

function parseKeysetPage(query: Record<string, string | undefined>) {
  return {
    limit: parseAdminLimit(query.limit),
    cursor: query.cursor ? decodeKeysetCursor(query.cursor) : null,
  };
}

function parseAdminLimit(value: string | undefined) {
  if (!value) return ADMIN_DEFAULT_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > ADMIN_MAX_PAGE_LIMIT) {
    throw new AppError('validation_error', `limit must be an integer from 1 to ${ADMIN_MAX_PAGE_LIMIT}`, 400, {
      limit: value,
      max_limit: ADMIN_MAX_PAGE_LIMIT,
    });
  }
  return parsed;
}

function buildPage<T>(limit: number, rows: T[], hasMore: boolean, cursorFromRow: (row: T) => KeysetCursor) {
  const last = rows.at(-1);
  return {
    limit,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeKeysetCursor(cursorFromRow(last)) : null,
  };
}

function encodeKeysetCursor(cursor: KeysetCursor) {
  return `${cursor.at.toISOString()}|${cursor.id}`;
}

function decodeKeysetCursor(value: string): KeysetCursor {
  const [timestamp, id, ...extra] = value.split('|');
  if (!timestamp || !id || extra.length > 0) {
    throw invalidCursor(value);
  }
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) {
    throw invalidCursor(value);
  }
  return { at, id };
}

function invalidCursor(cursor: string) {
  return new AppError('validation_error', 'cursor is invalid', 400, { cursor });
}
