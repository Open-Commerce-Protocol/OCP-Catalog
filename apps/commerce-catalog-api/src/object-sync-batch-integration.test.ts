import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { loadConfig, type AppConfig } from '@ocp-catalog/config';
import { createCatalogServices } from '@ocp-catalog/catalog-core';
import { createCatalogDb, catalogSchema as schema } from '@ocp-catalog/catalog-db';
import { and, eq } from 'drizzle-orm';
import { createCommerceCatalogScenario } from './commerce-scenario';
import { assertIntegrationDatabaseReady, integrationPostgresOptions } from './test/integration-db';

// Exercises the batched `syncChunk` write path in
// packages/catalog-core/src/object-sync-service.ts. Covers the three semantics
// that were previously untested and are most at risk from the per-object ->
// batch rewrite: unchanged-skip, descriptor hash-skip, and mixed batches.

const baseConfig = loadConfig();
const db = createCatalogDb(baseConfig.DATABASE_URL);
const sql = postgres(baseConfig.DATABASE_URL, integrationPostgresOptions);
const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: false });
const services = createCatalogServices(db, baseConfig, scenario);

const providerId = `itest_batch_provider_${Date.now()}`;
let integrationDatabaseReady = false;

const syncOptions = {
  sideEffects: {
    searchIndexJobs: true,
    activityEvent: {
      method: 'POST',
      pathTemplate: '/ocp/objects/sync',
      statusCode: 200,
    },
  },
} as const;

describe('object sync batch write path', () => {
  beforeAll(async () => {
    await assertIntegrationDatabaseReady(sql, baseConfig.DATABASE_URL);
    integrationDatabaseReady = true;
    await cleanupProviderData(providerId);

    const registrationResult = await services.registrations.register(buildRegistration({
      ...baseConfig,
      COMMERCE_PROVIDER_ID: providerId,
      COMMERCE_PROVIDER_NAME: 'Batch Integration Provider',
      COMMERCE_PROVIDER_CONTACT_EMAIL: 'batch-itest@example.test',
    }));
    expect(registrationResult.status).toBe('accepted_full');
  });

  afterAll(async () => {
    if (integrationDatabaseReady) {
      await cleanupProviderData(providerId);
    }
    await sql.end();
  });

  test('unchanged object re-sync is skipped and emits no new upsert outbox event', async () => {
    const objectId = 'batch-unchanged';
    const objects = [buildCommercialObject({
      providerId,
      objectId,
      title: 'Unchanged Widget',
      summary: 'A widget that does not change.',
      brand: 'Acme',
      category: 'tools',
      sku: 'sku-unchanged',
      productUrl: 'https://provider.example/products/unchanged',
      imageUrls: ['https://provider.example/images/unchanged.jpg'],
      currency: 'USD',
      amount: 19.99,
      availabilityStatus: 'in_stock',
      quantity: 3,
      attributes: { color: 'red' },
    })];

    const first = await services.objects.sync(buildRequest(`batch_unchanged_1`, objects), syncOptions);
    expect(first.status).toBe('accepted');
    expect(first.accepted_count).toBe(1);
    const firstOutbox = await countUpsertOutbox(`batch_unchanged_1`);
    expect(firstOutbox).toBe(1);

    // Same objects, new batch id -> goes through syncChunk (not replay) and must
    // be detected as unchanged.
    const second = await services.objects.sync(buildRequest(`batch_unchanged_2`, objects), syncOptions);
    expect(second.status).toBe('accepted');
    expect(second.accepted_count).toBe(1);
    expect(second.items[0]?.warnings).toContain('unchanged_object_hash');
    // Unchanged items must NOT produce an upsert_document outbox event.
    const secondOutbox = await countUpsertOutbox(`batch_unchanged_2`);
    expect(secondOutbox).toBe(0);
  });

  test('descriptor rows are not rewritten when descriptor hash is unchanged', async () => {
    const objectId = 'batch-descriptor-stable';
    const baseObject = buildCommercialObject({
      providerId,
      objectId,
      title: 'Descriptor Stable Widget',
      summary: 'Initial summary.',
      brand: 'Acme',
      category: 'tools',
      sku: 'sku-stable',
      productUrl: 'https://provider.example/products/stable',
      imageUrls: ['https://provider.example/images/stable.jpg'],
      currency: 'USD',
      amount: 29.99,
      availabilityStatus: 'in_stock',
      quantity: 5,
      attributes: { color: 'blue' },
    });

    await services.objects.sync(buildRequest('batch_desc_1', [baseObject]), syncOptions);

    const [commercialObject] = await db
      .select({ id: schema.commercialObjects.id })
      .from(schema.commercialObjects)
      .where(and(
        eq(schema.commercialObjects.providerId, providerId),
        eq(schema.commercialObjects.objectId, objectId),
      ))
      .limit(1);
    const descriptorIdsBefore = await descriptorIdsFor(commercialObject!.id);
    expect(descriptorIdsBefore.length).toBe(3);

    // Re-sync with an identical body but a fresh batch id. raw hash and
    // descriptor hash are identical -> unchanged-skip, descriptor rows untouched.
    await services.objects.sync(buildRequest('batch_desc_2', [baseObject]), syncOptions);
    const descriptorIdsAfterUnchanged = await descriptorIdsFor(commercialObject!.id);
    expect(descriptorIdsAfterUnchanged.sort()).toEqual(descriptorIdsBefore.sort());
  });

  test('mixed batch: new + unchanged + rejected keeps order, status, and counts', async () => {
    // Seed one object so it can appear as "unchanged" in the mixed batch.
    const unchanged = buildCommercialObject({
      providerId,
      objectId: 'batch-mixed-unchanged',
      title: 'Mixed Unchanged',
      currency: 'USD',
      amount: 9.99,
      productUrl: 'https://provider.example/products/mixed-unchanged',
      imageUrls: [],
      availabilityStatus: 'in_stock',
      quantity: 2,
      attributes: {},
    });
    await services.objects.sync(buildRequest('batch_mixed_seed', [unchanged]), syncOptions);

    const fresh = buildCommercialObject({
      providerId,
      objectId: 'batch-mixed-new',
      title: 'Mixed New',
      currency: 'USD',
      amount: 49.99,
      productUrl: 'https://provider.example/products/mixed-new',
      imageUrls: [],
      availabilityStatus: 'in_stock',
      quantity: 1,
      attributes: {},
    });
    // Invalid object: missing required contract fields (no descriptors).
    const invalid = {
      ocp_version: '1.0',
      kind: 'CommercialObject',
      id: `obj_${providerId}_batch-mixed-invalid`,
      object_id: 'batch-mixed-invalid',
      object_type: 'product',
      provider_id: providerId,
      title: 'Mixed Invalid',
      status: 'active',
      descriptors: [],
    };

    // Order: new, unchanged, invalid -> result order must match exactly.
    const result = await services.objects.sync(
      buildRequest('batch_mixed_main', [fresh, unchanged, invalid]),
      syncOptions,
    );

    expect(result.status).toBe('partial');
    expect(result.accepted_count).toBe(2);
    expect(result.rejected_count).toBe(1);
    expect(result.items).toHaveLength(3);

    expect(result.items[0]?.object_id).toBe('batch-mixed-new');
    expect(result.items[0]?.status).toBe('accepted');
    expect(result.items[0]?.warnings ?? []).not.toContain('unchanged_object_hash');
    expect(result.items[0]?.catalog_entry_id).toBeTruthy();

    expect(result.items[1]?.object_id).toBe('batch-mixed-unchanged');
    expect(result.items[1]?.status).toBe('accepted');
    expect(result.items[1]?.warnings).toContain('unchanged_object_hash');

    expect(result.items[2]?.object_id).toBe('batch-mixed-invalid');
    expect(result.items[2]?.status).toBe('rejected');
    expect((result.items[2]?.errors ?? []).length).toBeGreaterThan(0);

    // Only the new object produces an upsert_document outbox event.
    expect(await countUpsertOutbox('batch_mixed_main')).toBe(1);
  });
});

function buildRequest(batchId: string, objects: unknown[]) {
  return {
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: baseConfig.CATALOG_ID,
    provider_id: providerId,
    registration_version: 1,
    batch_id: batchId,
    objects,
  };
}

async function countUpsertOutbox(batchId: string) {
  const rows = await db
    .select({ eventType: schema.catalogOutboxEvents.eventType })
    .from(schema.catalogOutboxEvents)
    .where(and(
      eq(schema.catalogOutboxEvents.catalogId, baseConfig.CATALOG_ID),
      eq(schema.catalogOutboxEvents.aggregateId, batchId),
      eq(schema.catalogOutboxEvents.eventType, 'search_index.enqueue_job'),
    ));
  return rows.length;
}

async function descriptorIdsFor(commercialObjectId: string) {
  const rows = await db
    .select({ id: schema.descriptorInstances.id })
    .from(schema.descriptorInstances)
    .where(eq(schema.descriptorInstances.commercialObjectId, commercialObjectId));
  return rows.map((row) => row.id);
}

async function cleanupProviderData(provider: string) {
  await sql`delete from catalog_outbox_events where provider_id = ${provider}`;
  await sql`delete from object_sync_chunks where provider_id = ${provider}`;
  await sql`delete from object_sync_runs where provider_id = ${provider}`;
  await sql`delete from provider_contract_states where provider_id = ${provider}`;
  await sql`delete from provider_registrations where provider_id = ${provider}`;
  await sql`delete from commercial_objects where provider_id = ${provider}`;
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
