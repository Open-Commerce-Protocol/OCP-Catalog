import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
import { schema } from '@ocp-catalog/db';
import { buildObjectSyncRequest, buildProviderRegistration, mapProductToCommercialObject } from './provider-mapper';

const config: AppConfig = {
  DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
  CATALOG_API_PORT: 4000,
  CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
  PROVIDER_API_PORT: 4200,
  PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4200',
  USER_DEMO_API_PORT: 4230,
  PROTOCOL_DOCS_PORT: 5173,
  REGISTRATION_API_PORT: 4100,
  REGISTRATION_ADMIN_UI_PORT: 4250,
  REGISTRATION_PUBLIC_BASE_URL: 'http://localhost:4100',
  REGISTRATION_REFRESH_SCHEDULER_ENABLED: true,
  REGISTRATION_REFRESH_INTERVAL_SECONDS: 300,
  API_KEY_DEV: 'dev-api-key',
  API_KEYS: '',
  CATALOG_ID: 'cat_local_dev',
  CATALOG_NAME: 'Local OCP Catalog',
  COMMERCE_PROVIDER_ID: 'commerce_provider_local_dev',
  COMMERCE_PROVIDER_NAME: 'Local Commerce Provider',
  COMMERCE_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
  COMMERCE_PROVIDER_DOMAIN: 'localhost',
  REGISTRATION_ID: 'center_local_dev',
  REGISTRATION_NAME: 'Local OCP Center',
  EMBEDDING_MODEL: 'local-hash-v1',
  EMBEDDING_DIMENSION: 64,
  USER_DEMO_AGENT_MODEL: 'qwen-plus',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
};

const product: typeof schema.providerProducts.$inferSelect = {
  id: 'pprod_1',
  providerId: config.COMMERCE_PROVIDER_ID,
  sku: 'sku-1',
  title: 'Travel Headphones',
  summary: 'Wireless noise cancelling headphones.',
  brand: 'North Audio',
  category: 'electronics',
  productUrl: 'http://localhost:4200/products/sku-1',
  imageUrls: ['http://localhost:4200/images/sku-1.jpg'],
  currency: 'USD',
  amount: 12999,
  availabilityStatus: 'in_stock',
  quantity: 7,
  status: 'active',
  attributes: { color: 'black' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('provider-mapper', () => {
  test('builds provider registration with commerce object declaration', () => {
    const registration = buildProviderRegistration(config, 3);

    expect(registration.catalog_id).toBe(config.CATALOG_ID);
    expect(registration.registration_version).toBe(3);
    expect(registration.provider.provider_id).toBe(config.COMMERCE_PROVIDER_ID);
    expect(registration.object_declarations[0]?.guaranteed_fields).toEqual([
      'ocp.commerce.product.core.v1#/title',
      'ocp.commerce.price.v1#/currency',
      'ocp.commerce.price.v1#/amount',
      'ocp.commerce.product.core.v1#/product_url',
    ]);
    expect(registration.object_declarations[0]?.sync).toEqual({
      preferred_capabilities: ['ocp.push.batch'],
      avoid_capabilities_unless_necessary: [],
      provider_endpoints: {},
    });
  });

  test('maps product cents to commercial object price amount', () => {
    const object = mapProductToCommercialObject(config, product);
    const pricePack = object.descriptors.find((descriptor) => descriptor.pack_id === 'ocp.commerce.price.v1');

    expect(object.id).toBe('obj_commerce_provider_local_dev_sku-1');
    expect(object.status).toBe('active');
    expect(pricePack?.data).toEqual({
      currency: 'USD',
      amount: 129.99,
    });
  });

  test('keeps out_of_stock active products discoverable as active commercial objects', () => {
    const object = mapProductToCommercialObject(config, {
      ...product,
      availabilityStatus: 'out_of_stock',
    });

    expect(object.status).toBe('active');
  });

  test('builds sync request with deterministic batch id when clock is injected', () => {
    const request = buildObjectSyncRequest(config, 2, [product], { now: 123456 });

    expect(request.batch_id).toBe('provider_batch_123456');
    expect(request.objects).toHaveLength(1);
    expect(request.objects[0]?.object_id).toBe('sku-1');
  });
});

