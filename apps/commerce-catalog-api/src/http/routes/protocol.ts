import { requireApiKey } from '@ocp-catalog/auth-core';
import {
  buildCatalogManifest,
  buildWellKnownDiscovery,
} from '@ocp-catalog/catalog-core';
import { schema } from '@ocp-catalog/db';
import type { OcpActivityEventInput } from '@ocp-catalog/ocp-activity-schema';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { Elysia } from 'elysia';
import type { CommerceCatalogRuntimeContext } from '../../runtime/context';
import { firstHeader } from '../request-context';

const DATA_PROFILE_CACHE_TTL_MS = 60_000;

export function protocolRoutes(context: CommerceCatalogRuntimeContext) {
  const {
    config,
    db,
    activityEvents,
    commerceCatalogScenario,
    services,
    commerceQueryService,
    searchIndexJobs,
  } = context;

  let catalogDataProfileCache: {
    expiresAt: number;
    value: Awaited<ReturnType<typeof loadCatalogDataProfile>>;
  } | null = null;

  return new Elysia()
    .get('/ocp/health', async () => getCatalogHealth())
    .get('/.well-known/ocp-catalog', () => buildWellKnownDiscovery(config))
    .get('/ocp/manifest', async () => {
      const dataProfile = await getCatalogDataProfile();
      return buildCatalogManifest(config, commerceCatalogScenario, { dataProfile });
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
    });

  function assertWriteAuth(headers: Record<string, string | undefined>) {
    requireApiKey(firstHeader(headers['x-api-key']), config.API_KEY_DEV, config.API_KEYS);
  }

  async function recordActivityEvent(input: OcpActivityEventInput) {
    await activityEvents.ingest(input);
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

  function stringPayload(payload: unknown, key: string) {
    if (!payload || typeof payload !== 'object') return undefined;
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
    }
  }
}
