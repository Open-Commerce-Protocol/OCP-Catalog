import { describe, expect, test } from 'bun:test';
import {
  absolutize,
  buildTombstoneCommercialObject,
  htmlToPlainText,
  mapShopifyProductToCommercialObject,
  type MapperContext,
} from '../src/mapper/product-to-commercial-object';
import type { ShopifyProduct } from '../src/shopify/types';
import fixture from './fixtures/shopify-products.json';

const products = fixture as unknown as ShopifyProduct[];
const ctx: MapperContext = {
  providerId: 'shopify_provider_test',
  defaultCurrency: 'USD',
  storeDomain: 'local-dev-merchant.myshopify.com',
};

describe('absolutize', () => {
  test('// → https://', () => {
    expect(absolutize('//cdn.shopify.com/x.jpg')).toBe('https://cdn.shopify.com/x.jpg');
  });
  test('https://passthrough', () => {
    expect(absolutize('https://example.com/x')).toBe('https://example.com/x');
  });
  test('null / empty → undefined', () => {
    expect(absolutize(null)).toBeUndefined();
    expect(absolutize('')).toBeUndefined();
    expect(absolutize(undefined)).toBeUndefined();
  });
});

describe('htmlToPlainText', () => {
  test('strips tags', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });
  test('null/empty → undefined', () => {
    expect(htmlToPlainText(null)).toBeUndefined();
    expect(htmlToPlainText('')).toBeUndefined();
  });
});

describe('mapShopifyProductToCommercialObject', () => {
  const [wool, linen, draft] = products.map((p) => mapShopifyProductToCommercialObject(p, ctx));

  test('object_id strips Shopify GID prefix', () => {
    expect(wool.object_id).toBe('8001001');
    expect(wool.id).toBe('obj_shopify_provider_test_8001001');
    expect(wool.provider_id).toBe('shopify_provider_test');
    expect(wool.kind).toBe('CommercialObject');
  });

  test('status maps Shopify ACTIVE → active, DRAFT → draft', () => {
    expect(wool.status).toBe('active');
    expect(draft.status).toBe('draft');
  });

  test('source_url uses onlineStoreUrl', () => {
    expect(wool.source_url).toBe('https://local-dev-merchant.myshopify.com/products/heritage-wool-crewneck-sweater');
  });

  test('image_urls are deduped and absolute https://', () => {
    const productCore = wool.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    const urls = productCore!.data.image_urls as string[];
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith('https://')).toBe(true);
  });

  test('price uses lowest variant price', () => {
    const price = wool.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(129);
    expect(price!.data.currency).toBe('USD');
    // wool has compareAtPrice=149 only on first variant → list_amount surfaced
    expect(price!.data.list_amount).toBe(149);
  });

  test('inventory aggregates availableForSale across variants', () => {
    const inv = wool.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('in_stock');
    expect(inv!.data.quantity).toBe(42);
  });

  test('linen single-variant → fixed price, no list_amount', () => {
    const price = linen.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(89);
    expect(price!.data.price_type).toBe('fixed');
    expect((price!.data as any).list_amount).toBeUndefined();
  });

  test('draft with no variants → availability=unknown, status=draft', () => {
    const inv = draft.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('unknown');
    expect(draft.status).toBe('draft');
  });

  test('attributes include variants summary and Shopify timestamps', () => {
    const productCore = wool.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    const attrs = productCore!.data.attributes as Record<string, unknown>;
    expect(attrs.variant_count).toBe(2);
    expect(attrs.shopify_updated_at).toBe('2026-05-10T08:00:00Z');
    expect(attrs.handle).toBe('heritage-wool-crewneck-sweater');
  });
});

describe('buildTombstoneCommercialObject', () => {
  test('creates inactive object with zero price', () => {
    const t = buildTombstoneCommercialObject('gid://shopify/Product/9999', ctx);
    expect(t.status).toBe('inactive');
    expect(t.object_id).toBe('9999');
    const price = t.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(0);
  });
});
