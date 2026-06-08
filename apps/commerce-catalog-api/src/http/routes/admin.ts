import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildCatalogManifest } from '@ocp-catalog/catalog-core';
import { schema } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../../runtime/context';
import { firstHeader } from '../request-context';

type Db = CommerceCatalogRuntimeContext['db'];
type QueryTable = Parameters<ReturnType<Db['select']>['from']>[0];

const ADMIN_DEFAULT_PAGE_LIMIT = 50;
const ADMIN_MAX_PAGE_LIMIT = 100;
const ADMIN_QUEUE_COUNT_CAP = 100_000;
const FAST_COUNT_TABLES = [
  'commercial_objects',
  'catalog_entries',
  'catalog_search_documents',
  'query_audit_records',
] as const;

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
    .get('/api/catalog-admin/queue-trends', async ({ headers, query }) => {
      assertAdminAuth(context, headers);
      return getCatalogAdminQueueTrends(context, query);
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
    fastCounts,
    embeddingMetrics,
    searchJobMetrics,
    outboxMetrics,
    latestRun,
    latestChunk,
  ] = await Promise.all([
    countProviderContractStates(context),
    getFastTableCounts(context),
    getEmbeddingMetrics(context),
    getSearchJobMetrics(context),
    getOutboxMetrics(context),
    getLatestSyncRun(context),
    getLatestSyncChunk(context),
  ]);

  const objectCount = fastCounts.commercial_objects;
  const activeEntryCount = fastCounts.catalog_entries;
  const activeDocumentCount = fastCounts.catalog_search_documents;
  const queryAuditCount = fastCounts.query_audit_records;
  const activeDocumentsMissingEmbeddingCount = Math.max(0, activeDocumentCount - embeddingMetrics.readyEmbeddingCount);
  const embeddingReadinessRatio = activeDocumentCount > 0
    ? Number((embeddingMetrics.readyEmbeddingCount / activeDocumentCount).toFixed(4))
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
      active_entry_count: activeEntryCount,
      active_search_document_count: activeDocumentCount,
      ready_embedding_count: embeddingMetrics.readyEmbeddingCount,
      failed_embedding_count: embeddingMetrics.failedEmbeddingCount,
      pending_index_job_count: searchJobMetrics.pendingJobCount,
      running_index_job_count: searchJobMetrics.runningJobCount,
      failed_index_job_count: searchJobMetrics.failedJobCount,
      pending_outbox_count: outboxMetrics.pendingOutboxCount,
      running_outbox_count: outboxMetrics.runningOutboxCount,
      failed_outbox_count: outboxMetrics.failedOutboxCount,
      query_audit_count: queryAuditCount,
      rich_entry_count: 0,
      standard_entry_count: 0,
      basic_entry_count: activeEntryCount,
      missing_image_count: 0,
      missing_product_url_count: 0,
      out_of_stock_count: 0,
    },
    search_index: {
      active_document_count: activeDocumentCount,
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

async function countProviderContractStates(context: CommerceCatalogRuntimeContext) {
  const [row] = await context.db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.providerContractStates)
    .where(eq(schema.providerContractStates.catalogId, context.config.CATALOG_ID));
  return row?.value ?? 0;
}

async function getFastTableCounts(context: CommerceCatalogRuntimeContext) {
  const rows = await context.db.execute(sql`
    select relname, greatest(n_live_tup, 0)::bigint as count
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname in (${sql.join(FAST_COUNT_TABLES.map((table) => sql`${table}`), sql`, `)})
  `) as Array<{ relname: typeof FAST_COUNT_TABLES[number]; count: number | string }>;
  const counts: Record<typeof FAST_COUNT_TABLES[number], number> = {
    commercial_objects: 0,
    catalog_entries: 0,
    catalog_search_documents: 0,
    query_audit_records: 0,
  };
  for (const row of rows) {
    counts[row.relname] = Number(row.count);
  }
  return counts;
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

async function getSearchJobMetrics(context: CommerceCatalogRuntimeContext) {
  const [pendingJobCount, runningJobCount, failedJobCount] = await Promise.all([
    countSearchIndexJobsByStatus(context, 'pending'),
    countSearchIndexJobsByStatus(context, 'running'),
    countSearchIndexJobsByStatus(context, 'failed'),
  ]);
  const [oldestPending] = await context.db
    .execute(sql`select null::timestamptz as "createdAt"`) as Array<{ createdAt: Date | null }>;

  return {
    pendingJobCount,
    runningJobCount,
    failedJobCount,
    oldestPendingJobCreatedAt: oldestPending?.createdAt ?? null,
  };
}

async function countSearchIndexJobsByStatus(context: CommerceCatalogRuntimeContext, status: 'pending' | 'running' | 'failed') {
  const [row] = await context.db.execute(sql`
    select count(*)::int as value
    from (
      select 1
      from catalog_search_index_jobs
      where catalog_id = ${context.config.CATALOG_ID}
        and status = ${status}
      limit ${ADMIN_QUEUE_COUNT_CAP}
    ) counted
  `) as Array<{ value: number }>;
  return row?.value ?? 0;
}

async function getOutboxMetrics(context: CommerceCatalogRuntimeContext) {
  const [pendingOutboxCount, runningOutboxCount, failedOutboxCount] = await Promise.all([
    countOutboxEventsByStatus(context, 'pending'),
    countOutboxEventsByStatus(context, 'running'),
    countOutboxEventsByStatus(context, 'failed'),
  ]);
  const [oldestPending] = await context.db
    .execute(sql`select null::timestamptz as "createdAt"`) as Array<{ createdAt: Date | null }>;

  return {
    pendingOutboxCount,
    runningOutboxCount,
    failedOutboxCount,
    oldestPendingOutboxCreatedAt: oldestPending?.createdAt ?? null,
  };
}

async function countOutboxEventsByStatus(context: CommerceCatalogRuntimeContext, status: 'pending' | 'running' | 'failed') {
  const [row] = await context.db.execute(sql`
    select count(*)::int as value
    from (
      select 1
      from catalog_outbox_events
      where catalog_id = ${context.config.CATALOG_ID}
        and status = ${status}
      limit ${ADMIN_QUEUE_COUNT_CAP}
    ) counted
  `) as Array<{ value: number }>;
  return row?.value ?? 0;
}

async function getCatalogAdminQueueTrends(context: CommerceCatalogRuntimeContext, query: Record<string, string | undefined>) {
  const hours = parseTrendHours(query.hours);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = (await Promise.all([
    context.db.execute(sql`
      select
        'search_index_jobs'::text as queue_name,
        date_trunc('hour', created_at) as "bucketAt",
        'created'::text as status,
        job_type::text as type,
        count(*)::int as count
      from catalog_search_index_jobs
      where catalog_id = ${context.config.CATALOG_ID}
        and created_at >= ${since.toISOString()}::timestamptz
      group by "bucketAt", job_type
    `),
    context.db.execute(sql`
      select
        'search_index_jobs'::text as queue_name,
        date_trunc('hour', finished_at) as "bucketAt",
        status::text as status,
        job_type::text as type,
        count(*)::int as count
      from catalog_search_index_jobs
      where catalog_id = ${context.config.CATALOG_ID}
        and finished_at is not null
        and finished_at >= ${since.toISOString()}::timestamptz
        and status in ('completed', 'failed', 'cancelled')
      group by "bucketAt", status, job_type
    `),
    context.db.execute(sql`
      select
        'catalog_outbox'::text as queue_name,
        date_trunc('hour', created_at) as "bucketAt",
        'created'::text as status,
        event_type::text as type,
        count(*)::int as count
      from catalog_outbox_events
      where catalog_id = ${context.config.CATALOG_ID}
        and created_at >= ${since.toISOString()}::timestamptz
      group by "bucketAt", event_type
    `),
    context.db.execute(sql`
      select
        'catalog_outbox'::text as queue_name,
        date_trunc('hour', finished_at) as "bucketAt",
        status::text as status,
        event_type::text as type,
        count(*)::int as count
      from catalog_outbox_events
      where catalog_id = ${context.config.CATALOG_ID}
        and finished_at is not null
        and finished_at >= ${since.toISOString()}::timestamptz
        and status in ('completed', 'failed')
      group by "bucketAt", status, event_type
    `),
  ])).flat() as Array<{
    queue_name: string;
    bucketAt: Date;
    status: string;
    type: string;
    count: number;
  }>;

  return {
    catalog_id: context.config.CATALOG_ID,
    window_hours: hours,
    buckets: rows
      .sort((left, right) => (
        toIsoTimestamp(left.bucketAt).localeCompare(toIsoTimestamp(right.bucketAt))
        || left.queue_name.localeCompare(right.queue_name)
        || left.status.localeCompare(right.status)
        || left.type.localeCompare(right.type)
      ))
      .map((row) => ({
        queue_name: row.queue_name,
        bucket_at: toIsoTimestamp(row.bucketAt),
        status: row.status,
        type: row.type,
        count: row.count,
      })),
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
    const [latestRegistrationRows, latestRunRows, latestChunkRows] = await Promise.all([
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
      provider_id: state.providerId,
      status: state.status,
      active_registration_version: state.activeRegistrationVersion,
      guaranteed_fields: state.guaranteedFields,
      declared_packs: state.declaredPacks,
      catalog_quality: estimateProviderCatalogQuality(state.providerId),
      updated_at: state.updatedAt.toISOString(),
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

function estimateProviderCatalogQuality(providerId: string) {
  return {
    provider_id: providerId,
    object_count: 0,
    active_entry_count: 0,
    rich_entry_count: 0,
    standard_entry_count: 0,
    basic_entry_count: 0,
    missing_image_count: 0,
    missing_product_url_count: 0,
    out_of_stock_count: 0,
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

function parseTrendHours(value: string | undefined) {
  if (!value) return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    throw new AppError('validation_error', 'hours must be an integer from 1 to 6', 400, {
      hours: value,
      max_hours: 6,
    });
  }
  return parsed;
}

function toIsoTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('internal_error', 'invalid timestamp returned by database', 500, {
      timestamp: String(value),
    });
  }
  return date.toISOString();
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
