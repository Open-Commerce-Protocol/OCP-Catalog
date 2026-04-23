import { fileURLToPath } from 'node:url';
import { cors } from '@elysiajs/cors';
import { requireApiKey } from '@ocp-catalog/auth-core';
import { buildCatalogManifest, buildWellKnownDiscovery, CatalogEmbeddingService, createCatalogServices } from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb, schema } from '@ocp-catalog/db';
import { AppError, createSpaStaticSiteHandler } from '@ocp-catalog/shared';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import { createCommerceCatalogScenario } from './commerce-scenario';
import { createCommerceEmbeddingProvider } from './embedding-provider';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const embeddingProvider = createCommerceEmbeddingProvider(config);
const commerceCatalogScenario = createCommerceCatalogScenario({
  semanticSearchEnabled: Boolean(embeddingProvider),
});
const embeddingService = embeddingProvider
  ? new CatalogEmbeddingService(db, commerceCatalogScenario, embeddingProvider)
  : undefined;
const services = createCatalogServices(db, config, commerceCatalogScenario, {
  embeddings: embeddingService,
});
const catalogAdminSite = createSpaStaticSiteHandler(fileURLToPath(new URL('../public/dist', import.meta.url)));

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: { code: error.code, message: error.message, details: error.details } };
    }

    if (error instanceof ZodError) {
      set.status = 400;
      return { error: { code: 'validation_error', message: 'Invalid request body', details: error.issues } };
    }

    set.status = 500;
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
  .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(config))
  .get('/ocp/manifest', () => buildCatalogManifest(config, commerceCatalogScenario))
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
    assertWriteAuth(headers);
    return services.registrations.register(body, {
      sourceIp: firstHeader(headers['x-forwarded-for']) ?? firstHeader(headers['x-real-ip']),
      userAgent: firstHeader(headers['user-agent']),
    });
  })
  .get('/ocp/providers/:providerId', async ({ params }) => services.registrations.getProvider(params.providerId))
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
  .post('/api/catalog-admin/center/register', async ({ headers }) => {
    assertAdminAuth(headers);
    return registerCatalogInCenter();
  })
  .post('/api/catalog-admin/center/verify', async ({ headers }) => {
    assertAdminAuth(headers);
    return postCenterJson(`/ocp/catalogs/${config.CATALOG_ID}/verify`, {});
  })
  .post('/api/catalog-admin/center/refresh', async ({ headers, body }) => {
    assertAdminAuth(headers);
    const token = getBodyString(body, 'catalog_token');
    return postCenterJson(`/ocp/catalogs/${config.CATALOG_ID}/refresh`, {}, token);
  })
  .post('/api/catalog-admin/center/token/rotate', async ({ headers, body }) => {
    assertAdminAuth(headers);
    const token = getBodyString(body, 'catalog_token');
    return postCenterJson(`/ocp/catalogs/${config.CATALOG_ID}/token/rotate`, {}, token);
  })
  .post('/ocp/objects/sync', async ({ body, headers }) => {
    assertWriteAuth(headers);
    return services.objects.sync(body);
  })
  .get('/ocp/providers/:providerId/objects', async ({ params }) => ({
    catalog_id: config.CATALOG_ID,
    provider_id: params.providerId,
    objects: await services.objects.listProviderObjects(params.providerId),
  }))
  .get('/ocp/objects/:objectId', async ({ params }) => services.objects.getObject(params.objectId))
  .post('/ocp/query', async ({ body, headers }) => services.query.query(body, {
    requesterKey: firstHeader(headers['x-api-key']),
  }))
  .post('/ocp/resolve', async ({ body }) => services.resolve.resolve(body))
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

async function serveCatalogAdmin(pathname: string) {
  const response = await catalogAdminSite(pathname);
  return response ?? new Response('Not Found', { status: 404 });
}

async function getCatalogAdminOverview() {
  const [providerStates, objects, entries, queryAudits, syncBatches] = await Promise.all([
    db.select().from(schema.providerContractStates),
    db.select().from(schema.commercialObjects),
    db.select().from(schema.catalogEntries),
    db.select().from(schema.queryAuditRecords),
    db.select().from(schema.objectSyncBatches),
  ]);

  const catalogProviderStates = providerStates.filter((row) => row.catalogId === config.CATALOG_ID);
  const catalogObjects = objects.filter((row) => row.catalogId === config.CATALOG_ID);
  const catalogEntries = entries.filter((row) => row.catalogId === config.CATALOG_ID);
  const catalogQueryAudits = queryAudits.filter((row) => row.catalogId === config.CATALOG_ID);
  const latestBatch = syncBatches
    .filter((row) => row.catalogId === config.CATALOG_ID)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;

  const quality = summarizeEntryQuality(catalogEntries.map((row) => ({
    entryStatus: row.entryStatus,
    projection: row.searchProjection,
  })));

  return {
    catalog_id: config.CATALOG_ID,
    catalog_name: config.CATALOG_NAME,
    semantic_search_enabled: Boolean(embeddingProvider),
    query_packs: buildCatalogManifest(config, commerceCatalogScenario).query_capabilities.flatMap((capability) => (
      capability.query_packs.map((pack) => pack.pack_id)
    )),
    metrics: {
      provider_count: catalogProviderStates.length,
      object_count: catalogObjects.length,
      active_entry_count: catalogEntries.filter((row) => row.entryStatus === 'active').length,
      query_audit_count: catalogQueryAudits.length,
      ...quality,
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

async function registerCatalogInCenter() {
  const hostname = new URL(config.CATALOG_PUBLIC_BASE_URL).hostname;
  return postCenterJson('/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: `catreg_${crypto.randomUUID().replaceAll('-', '')}`,
    center_id: config.CENTER_ID,
    catalog_id: config.CATALOG_ID,
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: config.CATALOG_PUBLIC_BASE_URL,
    well_known_url: `${config.CATALOG_PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/ocp-catalog`,
    claimed_domains: [hostname],
    intended_visibility: 'public',
    tags: ['commerce', 'demo'],
  });
}

async function postCenterJson(pathname: string, body: Record<string, unknown>, catalogToken?: string | null) {
  const response = await fetch(`${config.CENTER_PUBLIC_BASE_URL.replace(/\/$/, '')}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(catalogToken ? { 'x-catalog-token': catalogToken } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError('internal_error', payload?.error?.message ?? `Center request failed with status ${response.status}`, response.status, payload);
  }

  return payload;
}

function getBodyString(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
