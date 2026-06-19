import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { loadConfig, type AppConfig } from '@ocp-catalog/config';
import { createCatalogServices } from '@ocp-catalog/catalog-core';
import { createDb, schema } from '@ocp-catalog/db';
import { and, eq } from 'drizzle-orm';
import { createCommerceCatalogScenario } from './commerce-scenario';
import { CommerceQueryService } from './query/commerce-query-service';
import { SearchDocumentUpsertService } from './search/indexing/document-upsert-service';
import { assertIntegrationDatabaseReady, integrationPostgresOptions } from './test/integration-db';

const baseConfig = loadConfig();
const db = createDb(baseConfig.DATABASE_URL);
const sql = postgres(baseConfig.DATABASE_URL, integrationPostgresOptions);
const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: false });
const services = createCatalogServices(db, baseConfig, scenario);
const searchDocumentUpsertService = new SearchDocumentUpsertService(db);
const commerceQueryService = new CommerceQueryService(db, baseConfig, scenario);

const providerId = `itest_provider_${Date.now()}`;
const queryText = `travel headphones ${providerId}`;
let integrationDatabaseReady = false;

describe('commerce catalog integration', () => {
  beforeAll(async () => {
    await assertIntegrationDatabaseReady(sql, baseConfig.DATABASE_URL);
    integrationDatabaseReady = true;
    await cleanupProviderData(providerId, queryText);
  });

  afterAll(async () => {
    if (integrationDatabaseReady) {
      await cleanupProviderData(providerId, queryText);
    }
    await sql.end();
  });

  test('registers provider, syncs products, queries ranked results, resolves entry, and reports provider quality', async () => {
    const registration = buildRegistration({
      ...baseConfig,
      COMMERCE_PROVIDER_ID: providerId,
      COMMERCE_PROVIDER_NAME: 'Integration Test Provider',
      COMMERCE_PROVIDER_CONTACT_EMAIL: 'itest@example.test',
    });

    const registrationResult = await services.registrations.register(registration);
    expect(registrationResult.status).toBe('accepted_full');
    expect(registrationResult.matched_object_contract_count).toBe(1);
    const syncOptions = {
      syncRun: {
        syncRunId: `batch_${providerId}`,
        runMode: 'batch' as const,
        complete: true,
      },
      sideEffects: {
        searchIndexJobs: true,
        activityEvent: {
          method: 'POST',
          pathTemplate: '/ocp/objects/sync',
          statusCode: 200,
        },
      },
    };

    const syncResult = await services.objects.sync({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: baseConfig.CATALOG_ID,
      provider_id: providerId,
      registration_version: 1,
      batch_id: `batch_${providerId}`,
      objects: [
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-rich',
          title: `Travel Headphones ${providerId}`,
          summary: 'Wireless noise cancelling headphones with aluminum frame.',
          brand: 'North Audio',
          category: 'electronics',
          sku: `sku-${providerId}-rich`,
          productUrl: `https://provider.example/products/${providerId}/rich`,
          imageUrls: [`https://provider.example/images/${providerId}-rich.jpg`],
          currency: 'USD',
          amount: 129.99,
          listAmount: 159.99,
          availabilityStatus: 'in_stock',
          quantity: 6,
          attributes: { color: 'black', material: 'aluminum' },
        }),
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-basic',
          title: `Travel Headphones ${providerId} budget`,
          summary: undefined,
          brand: undefined,
          category: undefined,
          sku: undefined,
          productUrl: undefined,
          imageUrls: [],
          currency: 'USD',
          amount: 99.99,
          listAmount: undefined,
          availabilityStatus: 'out_of_stock',
          quantity: 0,
          attributes: {},
        }),
      ],
    }, syncOptions);

    expect(syncResult.status).toBe('accepted');
    expect(syncResult.accepted_count).toBe(2);

    const [syncChunk] = await db
      .select()
      .from(schema.objectSyncChunks)
      .where(eq(schema.objectSyncChunks.batchId, `batch_${providerId}`))
      .limit(1);
    expect(typeof syncChunk?.requestHash).toBe('string');
    expect(syncChunk?.requestHash).not.toBe('');
    expect(syncChunk?.requestMetadata).toMatchObject({
      object_count: 2,
      has_client_batch_id: true,
    });
    expect(syncChunk?.resultSummary).toMatchObject({
      result_id: syncResult.id,
      item_count: 2,
      accepted_count: 2,
      rejected_count: 0,
      error_count: 0,
    });
    expect(JSON.stringify(syncChunk)).not.toContain('Wireless noise cancelling headphones');

    const replayedSyncResult = await services.objects.sync({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: baseConfig.CATALOG_ID,
      provider_id: providerId,
      registration_version: 1,
      batch_id: `batch_${providerId}`,
      objects: [
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-rich',
          title: `Travel Headphones ${providerId}`,
          summary: 'Wireless noise cancelling headphones with aluminum frame.',
          brand: 'North Audio',
          category: 'electronics',
          sku: `sku-${providerId}-rich`,
          productUrl: `https://provider.example/products/${providerId}/rich`,
          imageUrls: [`https://provider.example/images/${providerId}-rich.jpg`],
          currency: 'USD',
          amount: 129.99,
          listAmount: 159.99,
          availabilityStatus: 'in_stock',
          quantity: 6,
          attributes: { color: 'black', material: 'aluminum' },
        }),
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-basic',
          title: `Travel Headphones ${providerId} budget`,
          summary: undefined,
          brand: undefined,
          category: undefined,
          sku: undefined,
          productUrl: undefined,
          imageUrls: [],
          currency: 'USD',
          amount: 99.99,
          listAmount: undefined,
          availabilityStatus: 'out_of_stock',
          quantity: 0,
          attributes: {},
        }),
      ],
    }, syncOptions);
    expect(replayedSyncResult).toEqual(syncResult);
    const duplicateBatchRows = await db
      .select()
      .from(schema.objectSyncChunks)
      .where(eq(schema.objectSyncChunks.batchId, `batch_${providerId}`));
    expect(duplicateBatchRows).toHaveLength(1);
    const [syncRun] = await db
      .select()
      .from(schema.objectSyncRuns)
      .where(eq(schema.objectSyncRuns.syncRunId, `batch_${providerId}`))
      .limit(1);
    expect(syncRun).toMatchObject({
      status: 'accepted',
      batchCount: 1,
      acceptedCount: 2,
      rejectedCount: 0,
    });
    expect(syncRun?.checkpoint).toMatchObject({
      committed_chunk_count: 1,
      chunks: [
        {
          batch_id: `batch_${providerId}`,
          accepted_count: 2,
        },
      ],
    });
    const outboxRows = await db
      .select()
      .from(schema.catalogOutboxEvents)
      .where(and(
        eq(schema.catalogOutboxEvents.catalogId, baseConfig.CATALOG_ID),
        eq(schema.catalogOutboxEvents.aggregateId, `batch_${providerId}`),
      ));
    expect(outboxRows).toHaveLength(3);
    expect(outboxRows.map((row) => row.eventType).sort()).toEqual([
      'activity.ingest',
      'search_index.enqueue_job',
      'search_index.enqueue_job',
    ]);

    await expect(services.objects.sync({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: baseConfig.CATALOG_ID,
      provider_id: providerId,
      registration_version: 1,
      batch_id: `batch_${providerId}`,
      objects: [
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-rich',
          title: `Travel Headphones ${providerId} conflicting retry`,
          summary: 'This payload must be rejected for the reused batch id.',
          brand: 'North Audio',
          category: 'electronics',
          sku: `sku-${providerId}-conflict`,
          productUrl: `https://provider.example/products/${providerId}/conflict`,
          imageUrls: [],
          currency: 'USD',
          amount: 199.99,
          listAmount: undefined,
          availabilityStatus: 'in_stock',
          quantity: 1,
          attributes: {},
        }),
      ],
    })).rejects.toThrow('different request hash');

    await services.objects.sync({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: baseConfig.CATALOG_ID,
      provider_id: providerId,
      registration_version: 1,
      batch_id: `batch_${providerId}_replacement`,
      objects: [
        buildCommercialObject({
          providerId,
          objectId: 'travel-headphones-rich',
          title: `Travel Headphones ${providerId} refreshed`,
          summary: 'Updated descriptor payload.',
          brand: 'North Audio',
          category: 'audio',
          sku: `sku-${providerId}-rich-updated`,
          productUrl: `https://provider.example/products/${providerId}/rich-updated`,
          imageUrls: [`https://provider.example/images/${providerId}-rich-updated.jpg`],
          currency: 'USD',
          amount: 119.99,
          listAmount: 149.99,
          availabilityStatus: 'in_stock',
          quantity: 4,
          attributes: { color: 'silver' },
        }),
      ],
    });

    const [updatedObject] = await db
      .select()
      .from(schema.commercialObjects)
      .where(and(
        eq(schema.commercialObjects.providerId, providerId),
        eq(schema.commercialObjects.objectId, 'travel-headphones-rich'),
      ))
      .limit(1);
    expect(updatedObject?.title).toBe(`Travel Headphones ${providerId} refreshed`);

    const descriptors = await db
      .select()
      .from(schema.descriptorInstances)
      .where(eq(schema.descriptorInstances.commercialObjectId, updatedObject!.id));
    expect(descriptors).toHaveLength(3);
    expect(descriptors.find((descriptor) => descriptor.packId === 'ocp.commerce.product.core.v1')?.payload).toMatchObject({
      sku: `sku-${providerId}-rich-updated`,
      attributes: { color: 'silver' },
    });

    expect(await searchDocumentUpsertService.upsertForProvider({
      catalogId: baseConfig.CATALOG_ID,
      providerId,
    })).toHaveLength(2);

    const providerStatus = await services.registrations.getProvider(providerId);
    expect(providerStatus.catalog_quality?.object_count).toBe(2);
    expect(providerStatus.catalog_quality?.rich_entry_count).toBe(1);
    expect(providerStatus.catalog_quality?.basic_entry_count).toBe(1);
    expect(providerStatus.catalog_quality?.out_of_stock_count).toBe(1);

    const queryResult = await commerceQueryService.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      query: queryText,
      filters: {},
      limit: 10,
      explain: true,
    });

    expect(queryResult.entries.length).toBeGreaterThanOrEqual(2);
    expect(queryResult.entries[0]?.entry.attributes.quality_tier).toBe('rich');
    expect(queryResult.entries[0]?.entry.attributes.has_image).toBe(true);
    expect(queryResult.entries[0]?.score).toBeGreaterThan(queryResult.entries[1]?.score ?? 0);

    const firstListPage = await commerceQueryService.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      limit: 1,
      explain: true,
    });
    expect(firstListPage.entries).toHaveLength(1);
    expect(firstListPage.page).toEqual({
      limit: 1,
      offset: 0,
      has_more: true,
    });
    await expect(commerceQueryService.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      limit: 1,
      offset: 1,
      explain: true,
    })).rejects.toThrow();

    const filteredQuery = await commerceQueryService.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      query: queryText,
      filters: {
        has_image: true,
        in_stock_only: true,
        min_amount: 120,
        max_amount: 140,
      },
      limit: 10,
      explain: true,
    });

    expect(filteredQuery.entries).toHaveLength(1);
    expect(filteredQuery.entries[0]?.entry.image_url).toBe(`https://provider.example/images/${providerId}-rich.jpg`);
    expect(filteredQuery.entries[0]?.entry.attributes.primary_image_url).toBe(`https://provider.example/images/${providerId}-rich.jpg`);
    expect(filteredQuery.entries[0]?.entry.attributes.list_amount).toBe(159.99);

    const resolved = await services.resolve.resolve({
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      catalog_id: baseConfig.CATALOG_ID,
      entry_id: filteredQuery.entries[0]!.entry.entry_id,
      purpose: 'view',
      live_check: true,
      requested_fields: ['availability_status'],
    });

    expect(resolved.visible_attributes.primary_image_url).toBe(`https://provider.example/images/${providerId}-rich.jpg`);
    expect(resolved.visible_attributes.list_amount).toBe(159.99);
    expect(resolved.visible_attributes.discount_present).toBe(true);
    expect(resolved.visible_attributes.quality_tier).toBe('rich');
    expect(resolved.visible_attributes.product_url).toBeUndefined();
    expect(resolved.visible_attributes.source_url).toBeUndefined();
    expect(resolved.visible_attributes.text).toBeUndefined();
    expect(resolved.access).toMatchObject({
      visibility: 'public',
      permission_state: 'granted',
      redacted_fields: ['product_url', 'source_url', 'text'],
    });
    expect(resolved.live_checks[0]).toMatchObject({
      check_id: 'availability',
      status: 'passed',
      summary: 'in_stock',
      details: {
        availability_status: 'in_stock',
        quantity: 6,
      },
    });
    expect(resolved.action_bindings[0]?.entrypoint).toEqual({
      url: `https://provider.example/products/${providerId}/rich`,
      method: 'GET',
    });
    expect(resolved.action_bindings[0]).not.toHaveProperty('url');
    expect(resolved.action_bindings[0]).not.toHaveProperty('method');
  });
});

async function cleanupProviderData(providerId: string, queryText: string) {
  await sql`delete from query_audit_records where request_payload->>'query' = ${queryText}`;
  await sql`delete from catalog_outbox_events where provider_id = ${providerId}`;
  await sql`delete from object_sync_chunks where provider_id = ${providerId}`;
  await sql`delete from object_sync_runs where provider_id = ${providerId}`;
  await sql`delete from provider_contract_states where provider_id = ${providerId}`;
  await sql`delete from provider_registrations where provider_id = ${providerId}`;
  await sql`delete from commercial_objects where provider_id = ${providerId}`;
}

function buildRegistration(config: AppConfig) {
  return {
    ocp_version: '1.0' as const,
    kind: 'ProviderRegistration' as const,
    id: `reg_${config.COMMERCE_PROVIDER_ID}_1`,
    catalog_id: config.CATALOG_ID,
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: config.COMMERCE_PROVIDER_ID,
      entity_type: 'merchant' as const,
      display_name: config.COMMERCE_PROVIDER_NAME,
      homepage: config.PROVIDER_PUBLIC_BASE_URL,
      contact_email: config.COMMERCE_PROVIDER_CONTACT_EMAIL,
      domains: [config.COMMERCE_PROVIDER_DOMAIN],
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
          'ocp.commerce.product.core.v1#/product_url',
        ],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/brand',
          'ocp.commerce.product.core.v1#/category',
          'ocp.commerce.product.core.v1#/sku',
          'ocp.commerce.product.core.v1#/image_urls',
          'ocp.commerce.inventory.v1#/availability_status',
          'ocp.commerce.inventory.v1#/quantity',
        ],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  };
}

function buildCommercialObject(input: {
  providerId: string;
  objectId: string;
  title: string;
  summary?: string;
  brand?: string;
  category?: string;
  sku?: string;
  productUrl?: string;
  imageUrls: string[];
  currency: string;
  amount: number;
  listAmount?: number;
  availabilityStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  quantity: number;
  attributes: Record<string, unknown>;
}) {
  return {
    ocp_version: '1.0' as const,
    kind: 'CommercialObject' as const,
    id: `obj_${input.providerId}_${input.objectId}`,
    object_id: input.objectId,
    object_type: 'product',
    provider_id: input.providerId,
    title: input.title,
    ...(input.summary ? { summary: input.summary } : {}),
    status: 'active' as const,
    ...(input.productUrl ? { source_url: input.productUrl } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: input.title,
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.brand ? { brand: input.brand } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.sku ? { sku: input.sku } : {}),
          ...(input.productUrl ? { product_url: input.productUrl } : {}),
          ...(input.imageUrls.length ? { image_urls: input.imageUrls } : {}),
          attributes: input.attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: input.currency,
          amount: input.amount,
          ...(input.listAmount !== undefined ? { list_amount: input.listAmount } : {}),
          price_type: 'fixed',
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: input.availabilityStatus,
          quantity: input.quantity,
        },
      },
    ],
  };
}
