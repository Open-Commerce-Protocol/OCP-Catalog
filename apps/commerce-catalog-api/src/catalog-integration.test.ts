import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { loadConfig, type AppConfig } from '@ocp-catalog/config';
import { createCatalogServices } from '@ocp-catalog/catalog-core';
import { createDb } from '@ocp-catalog/db';
import { createCommerceCatalogScenario } from './commerce-scenario';

const baseConfig = loadConfig();
const db = createDb(baseConfig.DATABASE_URL);
const sql = postgres(baseConfig.DATABASE_URL, { max: 1 });
const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: false });
const services = createCatalogServices(db, baseConfig, scenario);

const providerId = `itest_provider_${Date.now()}`;
const queryText = `travel headphones ${providerId}`;

describe('commerce catalog integration', () => {
  beforeAll(async () => {
    await cleanupProviderData(providerId, queryText);
  });

  afterAll(async () => {
    await cleanupProviderData(providerId, queryText);
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
    });

    expect(syncResult.status).toBe('accepted');
    expect(syncResult.accepted_count).toBe(2);

    const providerStatus = await services.registrations.getProvider(providerId);
    expect(providerStatus.catalog_quality?.object_count).toBe(2);
    expect(providerStatus.catalog_quality?.rich_entry_count).toBe(1);
    expect(providerStatus.catalog_quality?.basic_entry_count).toBe(1);
    expect(providerStatus.catalog_quality?.out_of_stock_count).toBe(1);

    const queryResult = await services.query.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      query: queryText,
      filters: {},
      limit: 10,
      explain: true,
    });

    expect(queryResult.items.length).toBeGreaterThanOrEqual(2);
    expect(queryResult.items[0]?.attributes.quality_tier).toBe('rich');
    expect(queryResult.items[0]?.attributes.has_image).toBe(true);
    expect(queryResult.items[0]?.score).toBeGreaterThan(queryResult.items[1]?.score ?? 0);

    const filteredQuery = await services.query.query({
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

    expect(filteredQuery.items).toHaveLength(1);
    expect(filteredQuery.items[0]?.attributes.primary_image_url).toBe(`https://provider.example/images/${providerId}-rich.jpg`);
    expect(filteredQuery.items[0]?.attributes.list_amount).toBe(159.99);

    const resolved = await services.resolve.resolve({
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      catalog_id: baseConfig.CATALOG_ID,
      entry_id: filteredQuery.items[0]!.entry_id,
    });

    expect(resolved.visible_attributes.primary_image_url).toBe(`https://provider.example/images/${providerId}-rich.jpg`);
    expect(resolved.visible_attributes.list_amount).toBe(159.99);
    expect(resolved.visible_attributes.discount_present).toBe(true);
    expect(resolved.visible_attributes.quality_tier).toBe('rich');
    expect(resolved.action_bindings[0]?.url).toBe(`https://provider.example/products/${providerId}/rich`);
  });
});

async function cleanupProviderData(providerId: string, queryText: string) {
  await sql`delete from query_audit_records where request_payload->>'query' = ${queryText}`;
  await sql`delete from object_sync_batches where provider_id = ${providerId}`;
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
