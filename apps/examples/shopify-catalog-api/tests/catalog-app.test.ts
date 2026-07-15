import { describe, expect, test } from 'bun:test';
import { createShopifyCatalogApp } from '../src/app';
import { loadShopifyConfig } from '../src/config';
import { ShopifyCatalogClient } from '../src/shopify/mcp-client';

function app() {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'true',
    SHOPIFY_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4320',
  } as NodeJS.ProcessEnv);
  return createShopifyCatalogApp({
    shopify: new ShopifyCatalogClient(cfg),
    cfg,
  });
}

describe('Shopify Catalog Node routes', () => {
  test('root route describes the Catalog instead of surfacing an internal error', async () => {
    const res = await app().handle(new Request('http://localhost/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.service).toBe('shopify-catalog-api');
    expect(body.catalog_id).toBe('cat_shopify_global');
    expect(body.endpoints.query).toBe('http://localhost:4320/ocp/query');
  });

  test('unknown routes return a structured 404 instead of an internal error', async () => {
    const res = await app().handle(new Request('http://localhost/not-found'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  test('query route still returns Catalog entries', async () => {
    const res = await app().handle(new Request('http://localhost/ocp/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'CatalogQueryRequest',
        query: 'shirt',
        limit: 2,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe('CatalogQueryResult');
    expect(body.catalog_id).toBe('cat_shopify_global');
    expect(body.entries).toHaveLength(2);
  });
});
