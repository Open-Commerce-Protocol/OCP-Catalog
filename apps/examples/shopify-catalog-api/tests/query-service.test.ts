import { describe, expect, test } from 'bun:test';
import { loadShopifyConfig } from '../src/config';
import { ShopifyCatalogQueryService } from '../src/catalog/query-service';
import { ShopifyCatalogClient } from '../src/shopify/mcp-client';
import type { ShopifyCatalogListPayload } from '../src/shopify/types';

function makeService() {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'true',
    SHOPIFY_CATALOG_MODE: 'global',
  } as NodeJS.ProcessEnv);
  return { service: new ShopifyCatalogQueryService(new ShopifyCatalogClient(cfg), cfg), cfg };
}

function makeServiceWithPayload(payload: ShopifyCatalogListPayload) {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'true',
    SHOPIFY_CATALOG_MODE: 'global',
  } as NodeJS.ProcessEnv);
  const client = {
    search: async () => payload,
  } as unknown as ShopifyCatalogClient;
  return new ShopifyCatalogQueryService(client, cfg);
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

  test('returns an empty page for unsupported offset pagination', async () => {
    const { service } = makeService();
    const firstPage: any = await service.query({ query: 'sweater', limit: 1, offset: 0 });
    const secondPage: any = await service.query({ query: 'sweater', limit: 1, offset: 1 });

    expect(firstPage.items.length).toBe(1);
    expect(secondPage.items).toEqual([]);
    expect(secondPage.result_count).toBe(0);
    expect(secondPage.page).toEqual({
      limit: 1,
      offset: 1,
      has_more: false,
    });
    expect(secondPage.page.next_offset).toBeUndefined();
    expect(secondPage.items[0]?.entry_id).not.toBe(firstPage.items[0].entry_id);
    expect(secondPage.policy_summary.warnings).toContain(
      'Shopify Catalog pagination is cursor-based and is not yet bridged to OCP offset pagination.',
    );
    expect(secondPage.explain.join(' ')).toContain('empty page instead of replaying');
  });

  test('does not expose Shopify cursor pagination as OCP next_offset', async () => {
    const service = makeServiceWithPayload({
      products: [
        {
          id: 'gid://shopify/Product/1',
          title: 'Cursor-backed product',
        },
      ],
      pagination: {
        cursor: 'opaque-cursor',
        has_next_page: true,
      },
    });

    const result: any = await service.query({ query: 'cursor', limit: 1, offset: 0 });

    expect(result.items.length).toBe(1);
    expect(result.page.has_more).toBe(false);
    expect(result.page.next_offset).toBeUndefined();
    expect(result.policy_summary.warnings).toContain(
      'Shopify Catalog pagination is cursor-based and is not yet bridged to OCP offset pagination.',
    );
    expect(result.explain).toContain(
      'Shopify Catalog pagination is cursor-based and is not yet bridged to OCP offset pagination.',
    );
  });
});
