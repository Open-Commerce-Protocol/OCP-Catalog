import { describe, expect, test } from 'bun:test';
import { DashboardService } from '../src/services/dashboard-service';

// Minimal fakes for the three dependencies.
function makeService(opts: {
  install: any;
  providerRecord?: any;
  rollup?: any;
  activityEnabled?: boolean;
}) {
  const store = { get: async () => opts.install } as any;
  const catalog = { getProviderRecord: async () => opts.providerRecord ?? null } as any;
  const activity = {
    enabled: opts.activityEnabled ?? false,
    providerRollup: async () => opts.rollup ?? null,
  } as any;
  return new DashboardService(store, catalog, activity);
}

const baseInstall = {
  shopDomain: 'coffee.myshopify.com',
  status: 'active',
  catalogId: 'cat_local_dev',
  activeRegistrationVersion: 2,
  lastSyncedAt: new Date('2026-05-29T08:00:00Z'),
  lastRun: { type: 'sync_full', status: 'succeeded' },
};

describe('DashboardService.build', () => {
  test('returns null when no installation', async () => {
    const svc = makeService({ install: null });
    expect(await svc.build('nope.myshopify.com')).toBeNull();
  });

  test('P1: maps install + catalog quality', async () => {
    const svc = makeService({
      install: baseInstall,
      providerRecord: {
        catalog_quality: {
          object_count: 85,
          active_entry_count: 27,
          rich_entry_count: 79,
          standard_entry_count: 6,
          basic_entry_count: 0,
          out_of_stock_count: 0,
          missing_image_count: 0,
          missing_product_url_count: 0,
        },
      },
    });
    const d = (await svc.build('coffee.myshopify.com'))!;
    expect(d.connected).toBe(true);
    expect(d.provider_id).toBe('shopify_app_coffee');
    expect(d.catalog_id).toBe('cat_local_dev');
    expect(d.active_registration_version).toBe(2);
    expect(d.last_synced_at).toBe('2026-05-29T08:00:00.000Z');
    expect(d.listing.object_count).toBe(85);
    expect(d.listing.rich_entry_count).toBe(79);
    // P2 absent → activity unavailable, nulls
    expect(d.activity.available).toBe(false);
    expect(d.activity.views).toBeNull();
    expect(d.activity.resolves).toBeNull();
  });

  test('P1 degrades: no catalog record yet → listing nulls, still returns', async () => {
    const svc = makeService({ install: baseInstall, providerRecord: null });
    const d = (await svc.build('coffee.myshopify.com'))!;
    expect(d.connected).toBe(true);
    expect(d.listing.object_count).toBeNull();
  });

  test('P2: maps activity rollup when present', async () => {
    const svc = makeService({
      install: baseInstall,
      providerRecord: { catalog_quality: { object_count: 85 } },
      activityEnabled: true,
      rollup: { provider_id: 'shopify_app_coffee', window_hours: 168, event_count: 42, queried: 30, resolved: 12, object_synced: 0, by_event_type: {} },
    });
    const d = (await svc.build('coffee.myshopify.com'))!;
    expect(d.activity.available).toBe(true);
    expect(d.activity.window_hours).toBe(168);
    expect(d.activity.views).toBe(30);
    expect(d.activity.resolves).toBe(12);
  });

  test('does not throw if catalog getProviderRecord rejects', async () => {
    const store = { get: async () => baseInstall } as any;
    const catalog = { getProviderRecord: async () => { throw new Error('catalog down'); } } as any;
    const activity = { enabled: false, providerRollup: async () => null } as any;
    const svc = new DashboardService(store, catalog, activity);
    const d = (await svc.build('coffee.myshopify.com'))!;
    expect(d.connected).toBe(true);
    expect(d.listing.object_count).toBeNull();
  });
});
