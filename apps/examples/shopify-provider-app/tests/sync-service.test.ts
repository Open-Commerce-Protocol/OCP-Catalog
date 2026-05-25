import { describe, expect, test } from 'bun:test';
import type { ShopifyProviderConfig } from '../src/config';
import { SyncService } from '../src/services/sync-service';
import { StateStore } from '../src/services/state-store';
import type { ShopifyProduct } from '../src/shopify/types';

const cfg: ShopifyProviderConfig = {
  SHOPIFY_PROVIDER_ID: 'shopify_provider_test',
  SHOPIFY_PROVIDER_DISPLAY_NAME: 'Shopify Test',
  SHOPIFY_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
  SHOPIFY_PROVIDER_PORT: 4400,
  SHOPIFY_PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4400',
  SHOPIFY_PROVIDER_ADMIN_KEY: 'dev-shopify-provider-admin-key',
  SHOPIFY_PROVIDER_MOCK: true,
  SHOPIFY_PROVIDER_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_PROVIDER_ACCESS_TOKEN: undefined,
  SHOPIFY_PROVIDER_API_VERSION: '2025-10',
  SHOPIFY_PROVIDER_DEFAULT_CURRENCY: 'USD',
  SHOPIFY_PROVIDER_PAGE_SIZE: 50,
  SHOPIFY_PROVIDER_REQUEST_TIMEOUT_MS: 15000,
  SHOPIFY_PROVIDER_WEBHOOK_SECRET: 'secret',
  SHOPIFY_PROVIDER_CATALOG_BASE_URL: 'http://localhost:4000',
  SHOPIFY_PROVIDER_CATALOG_ID: 'cat_test',
  SHOPIFY_PROVIDER_CATALOG_API_KEY: 'dev-api-key',
  SHOPIFY_PROVIDER_STATE_FILE: undefined,
  SHOPIFY_PROVIDER_GRAPHQL_URL: 'mock://shopify-admin-graphql',
};

function product(id: string, updatedAt: string): ShopifyProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    handle: `product-${id}`,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt,
    options: [],
    variants: {
      nodes: [{
        id: `gid://shopify/ProductVariant/${id}1`,
        title: 'Default',
        price: '10.00',
        availableForSale: true,
      }],
    },
  };
}

function makeService(opts: {
  products?: ShopifyProduct[];
  one?: ShopifyProduct | null;
  syncObjects: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const state = new StateStore(undefined);
  const admin = {
    shopProfile: async () => ({
      name: 'Test Shop',
      primaryDomain: 'test-shop.myshopify.com',
      currencyCode: 'USD',
    }),
    listProducts: async () => ({
      nodes: opts.products ?? [],
      pageInfo: { hasNextPage: false, endCursor: null },
    }),
    getProduct: async () => opts.one ?? null,
  };
  const catalog = { syncObjects: opts.syncObjects };
  return { state, service: new SyncService(cfg, admin as any, catalog as any, state) };
}

describe('SyncService cursor commits', () => {
  test('syncFull commits cursor after all objects are accepted', async () => {
    const newest = '2026-05-02T00:00:00Z';
    const { state, service } = makeService({
      products: [product('1', '2026-05-01T00:00:00Z'), product('2', newest)],
      syncObjects: async (request) => ({
        accepted_count: (request.objects as unknown[]).length,
        rejected_count: 0,
        items: (request.objects as Array<{ object_id: string }>).map((obj) => ({ object_id: obj.object_id, status: 'accepted' })),
      }),
    });
    await state.update({ active_registration_version: 1 });

    const summary = await service.syncFull();

    expect(summary.status).toBe('succeeded');
    expect(summary.cursor_advanced_to).toBe(newest);
    expect((await state.snapshot()).last_synced_at).toBe(newest);
  });

  test('syncDelta does not commit cursor after partial catalog acceptance', async () => {
    const previous = '2026-05-01T00:00:00Z';
    const { state, service } = makeService({
      products: [product('1', '2026-05-02T00:00:00Z'), product('2', '2026-05-03T00:00:00Z')],
      syncObjects: async () => ({ accepted_count: 1, rejected_count: 1 }),
    });
    await state.update({ active_registration_version: 1, last_synced_at: previous });

    const summary = await service.syncDelta();

    expect(summary.status).toBe('partial');
    expect(summary.cursor_advanced_to).toBeNull();
    expect((await state.snapshot()).last_synced_at).toBe(previous);
  });

  test('syncDelta does not commit cursor after catalog failure', async () => {
    const previous = '2026-05-01T00:00:00Z';
    const { state, service } = makeService({
      products: [product('1', '2026-05-02T00:00:00Z')],
      syncObjects: async () => {
        throw new Error('catalog unavailable');
      },
    });
    await state.update({ active_registration_version: 1, last_synced_at: previous });

    const summary = await service.syncDelta();

    expect(summary.status).toBe('failed');
    expect(summary.cursor_advanced_to).toBeNull();
    expect((await state.snapshot()).last_synced_at).toBe(previous);
  });

  test('webhook syncOne does not advance the global delta cursor', async () => {
    const previous = '2026-05-01T00:00:00Z';
    const { state, service } = makeService({
      one: product('1', '2026-05-05T00:00:00Z'),
      syncObjects: async () => ({ accepted_count: 1, rejected_count: 0 }),
    });
    await state.update({ active_registration_version: 1, last_synced_at: previous });

    const summary = await service.syncOne('1', 'webhook');

    expect(summary.status).toBe('succeeded');
    expect(summary.cursor_advanced_to).toBeNull();
    expect((await state.snapshot()).last_synced_at).toBe(previous);
  });
});
