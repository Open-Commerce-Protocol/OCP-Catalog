import { describe, expect, test } from 'bun:test';
import { loadShopifyConfig } from '../src/config';
import { ShopifyCatalogResolveService } from '../src/catalog/resolve-service';
import { ShopifyCatalogClient } from '../src/shopify/mcp-client';

function makeService() {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'true',
    SHOPIFY_CATALOG_MODE: 'global',
  } as NodeJS.ProcessEnv);
  return { service: new ShopifyCatalogResolveService(new ShopifyCatalogClient(cfg), cfg), cfg };
}

describe('ShopifyCatalogResolveService.resolve', () => {
  test('returns ResolvableReference with action_bindings only for available variants', async () => {
    const { service } = makeService();
    const result: any = await service.resolve({
      entry_id: 'entry_shopify_global_p/7f3a2b8c1d9e',
    });

    expect(result.kind).toBe('ResolvableReference');
    expect(result.provider_id).toBe('shopify_global');
    expect(result.title).toBe('Organic Cotton Crewneck Sweater');

    // Fixture: 2 available variants (100001, 100003), 1 unavailable (100005)
    expect(result.action_bindings.length).toBe(2);
    for (const a of result.action_bindings) {
      expect(a.action_type).toBe('url');
      expect(a.entrypoint.url.startsWith('https://')).toBe(true);
    }

    expect(result.live_checks[0].status).toBe('passed');
    expect(result.live_checks[0].summary).toMatch(/2\/3 variants/);
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('access fields are set', async () => {
    const { service } = makeService();
    const result: any = await service.resolve({
      entry_id: 'entry_shopify_global_p/7f3a2b8c1d9e',
    });
    expect(result.access.visibility).toBe('public');
    expect(result.access.permission_state).toBe('granted');
    expect(result.access.policy_notes.length).toBeGreaterThan(0);
  });
});
