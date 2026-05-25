import { describe, expect, test } from 'bun:test';
import type { WcProviderConfig } from '../src/config';
import { SyncService } from '../src/services/sync-service';
import { StateStore } from '../src/services/state-store';
import type { WcProduct } from '../src/woocommerce/types';

const cfg: WcProviderConfig = {
  WC_PROVIDER_ID: 'wc_provider_test',
  WC_PROVIDER_DISPLAY_NAME: 'WC Test',
  WC_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
  WC_PROVIDER_PORT: 4410,
  WC_PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4410',
  WC_PROVIDER_ADMIN_KEY: 'dev-wc-provider-admin-key',
  WC_PROVIDER_MOCK: true,
  WC_PROVIDER_SITE_URL: 'https://wc.example.test',
  WC_PROVIDER_CONSUMER_KEY: 'ck_test',
  WC_PROVIDER_CONSUMER_SECRET: 'cs_test',
  WC_PROVIDER_AUTH_MODE: 'basic',
  WC_PROVIDER_API_VERSION: 'wc/v3',
  WC_PROVIDER_DEFAULT_CURRENCY: 'USD',
  WC_PROVIDER_PAGE_SIZE: 50,
  WC_PROVIDER_REQUEST_TIMEOUT_MS: 15000,
  WC_PROVIDER_WEBHOOK_SECRET: 'secret',
  WC_PROVIDER_CATALOG_BASE_URL: 'http://localhost:4000',
  WC_PROVIDER_CATALOG_ID: 'cat_test',
  WC_PROVIDER_CATALOG_API_KEY: 'dev-api-key',
  WC_PROVIDER_STATE_FILE: undefined,
};

function product(id: number, updatedAt: string): WcProduct {
  return {
    id,
    name: `Product ${id}`,
    permalink: `https://wc.example.test/product-${id}`,
    type: 'simple',
    status: 'publish',
    price: '10.00',
    stock_status: 'instock',
    date_modified_gmt: updatedAt,
  };
}

function makeService(opts: {
  products?: WcProduct[];
  one?: WcProduct | null;
  syncObjects: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const state = new StateStore(undefined);
  const wc = {
    siteProfile: async () => ({
      name: 'WC Test',
      url: 'https://wc.example.test',
      default_currency: 'USD',
    }),
    listProducts: async () => opts.products ?? [],
    getProduct: async () => opts.one ?? null,
    listVariations: async () => [],
  };
  const catalog = { syncObjects: opts.syncObjects };
  return { state, service: new SyncService(cfg, wc as any, catalog as any, state) };
}

describe('SyncService cursor commits', () => {
  test('syncFull commits cursor after all objects are accepted', async () => {
    const newest = '2026-05-02T00:00:00Z';
    const { state, service } = makeService({
      products: [product(1, '2026-05-01T00:00:00Z'), product(2, newest)],
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
      products: [product(1, '2026-05-02T00:00:00Z'), product(2, '2026-05-03T00:00:00Z')],
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
      products: [product(1, '2026-05-02T00:00:00Z')],
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
      one: product(1, '2026-05-05T00:00:00Z'),
      syncObjects: async () => ({ accepted_count: 1, rejected_count: 0 }),
    });
    await state.update({ active_registration_version: 1, last_synced_at: previous });

    const summary = await service.syncOne(1, 'webhook');

    expect(summary.status).toBe('succeeded');
    expect(summary.cursor_advanced_to).toBeNull();
    expect((await state.snapshot()).last_synced_at).toBe(previous);
  });
});
