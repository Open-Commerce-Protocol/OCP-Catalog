import { describe, expect, test } from 'bun:test';
import { PRODUCT_FIELDS, ShopifyAdminClient } from '../src/shopify/admin-client';

describe('ShopifyAdminClient', () => {
  test('does not request ProductVariant fields removed from the 2026-04 API', () => {
    expect(PRODUCT_FIELDS).not.toMatch(/\bweight\b/);
    expect(PRODUCT_FIELDS).not.toMatch(/\bweightUnit\b/);
  });

  test('uses the per-shop GraphQL URL and access token header', async () => {
    const calls: Array<{ url: string; headers: HeadersInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers ?? {} });
      return new Response(JSON.stringify({ data: { product: null } }), { status: 200 });
    }) as typeof fetch;
    try {
      const client = new ShopifyAdminClient({
        SHOPIFY_APP_MOCK: false,
        SHOPIFY_APP_API_VERSION: '2026-04',
        SHOPIFY_APP_REQUEST_TIMEOUT_MS: 1000,
      } as any);
      await client.getProduct({ shopDomain: 'coffee.myshopify.com', accessToken: 'shpat_test' }, '9001');

      expect(calls[0].url).toBe('https://coffee.myshopify.com/admin/api/2026-04/graphql.json');
      expect((calls[0].headers as Record<string, string>)['x-shopify-access-token']).toBe('shpat_test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
