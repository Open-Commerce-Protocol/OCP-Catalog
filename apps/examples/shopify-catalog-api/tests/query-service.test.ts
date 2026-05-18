import { describe, expect, test } from 'bun:test';
import { loadShopifyConfig } from '../src/config';
import { ShopifyCatalogQueryService } from '../src/catalog/query-service';
import { ShopifyCatalogClient } from '../src/shopify/mcp-client';

function makeService() {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'true',
    SHOPIFY_CATALOG_MODE: 'global',
  } as NodeJS.ProcessEnv);
  return { service: new ShopifyCatalogQueryService(new ShopifyCatalogClient(cfg), cfg), cfg };
}

describe('ShopifyCatalogQueryService.query', () => {
  test('returns OCP CatalogQueryResult with items', async () => {
    const { service } = makeService();
    const result: any = await service.query({ query: 'sweater' });

    expect(result.kind).toBe('CatalogQueryResult');
    expect(result.query).toBe('sweater');
    expect(result.query_mode).toBe('keyword');
    expect(result.result_count).toBeGreaterThan(0);
    expect(result.items.length).toBe(result.result_count);
    expect(result.items[0].entry_id).toMatch(/^entry_shopify_global_/);
    expect(result.items[0].provider_id).toBe('shopify_global');
    expect(result.items[0].title).toBeDefined();
    expect(result.policy_summary.selected_capability_id).toBe('ocp.shopify.product.search.v1');
  });

  test('rejects unsupported filters into policy_summary', async () => {
    const { service } = makeService();
    const result: any = await service.query({ query: 'sweater', filters: { brand: 'acme' } });
    expect(result.policy_summary.rejected_filters).toContain('brand');
    expect(result.policy_summary.warnings.length).toBeGreaterThan(0);
  });

  test('accepts in_stock_only', async () => {
    const { service } = makeService();
    const result: any = await service.query({ query: 'sweater', filters: { in_stock_only: true } });
    expect(result.policy_summary.accepted_filters).toContain('in_stock_only');
  });

  test('falls back to filter mode when no query', async () => {
    const { service } = makeService();
    const result: any = await service.query({ query: '', filters: { in_stock_only: true } });
    expect(result.query_mode).toBe('filter');
  });
});
