import { describe, expect, test } from 'bun:test';
import {
  absolutize,
  htmlToPlainText,
  mapProductToCommercialObject,
  summarizeAvailability,
  type MapperContext,
} from '../src/mapper/product-to-object';
import fixture from './fixtures/search-catalog-sample.json';
import type { ShopifyCatalogListPayload, ShopifyProduct } from '../src/shopify/types';

const payload = fixture as unknown as ShopifyCatalogListPayload;
const products = payload.products as ShopifyProduct[];

const ctx: MapperContext = {
  sourceId: 'shopify_global',
  catalogBaseUrl: 'http://localhost:4320',
};

describe('absolutize', () => {
  test('//cdn.shopify.com → https:', () => {
    expect(absolutize('//cdn.shopify.com/x.jpg')).toBe('https://cdn.shopify.com/x.jpg');
  });
  test('https:// passthrough', () => {
    expect(absolutize('https://example.com')).toBe('https://example.com');
  });
  test('bare host → https://', () => {
    expect(absolutize('example.com/x')).toBe('https://example.com/x');
  });
  test('empty / undefined → undefined', () => {
    expect(absolutize(undefined)).toBeUndefined();
    expect(absolutize('')).toBeUndefined();
    expect(absolutize('   ')).toBeUndefined();
  });
});

describe('htmlToPlainText', () => {
  test('strips tags and entities', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
    expect(htmlToPlainText('a&nbsp;&amp;&nbsp;b')).toBe('a & b');
  });
  test('undefined → undefined', () => {
    expect(htmlToPlainText(undefined)).toBeUndefined();
  });
});

describe('summarizeAvailability', () => {
  test('mixed → in_stock when any available', () => {
    expect(
      summarizeAvailability([
        { id: 'gid://shopify/ProductVariant/1', availability: { available: true } },
        { id: 'gid://shopify/ProductVariant/2', availability: { available: false } },
      ]),
    ).toBe('in_stock');
  });
  test('all unavailable → out_of_stock', () => {
    expect(
      summarizeAvailability([
        { id: 'gid://shopify/ProductVariant/1', availability: { available: false } },
      ]),
    ).toBe('out_of_stock');
  });
  test('unknown when no signal', () => {
    expect(summarizeAvailability([])).toBe('unknown');
    expect(summarizeAvailability(undefined)).toBe('unknown');
    expect(summarizeAvailability([{ id: 'gid://shopify/ProductVariant/1' }])).toBe('unknown');
  });
});

describe('mapProductToCommercialObject', () => {
  const [crew, beanie] = products.map((p) => mapProductToCommercialObject(p, ctx));

  test('id and object_id', () => {
    expect(crew.object_id).toBe('p/7f3a2b8c1d9e');
    expect(crew.id).toBe('obj_shopify_global_p/7f3a2b8c1d9e');
    expect(crew.provider_id).toBe('shopify_global');
    expect(crew.object_type).toBe('product');
    expect(crew.kind).toBe('CommercialObject');
  });

  test('source_url present and absolute', () => {
    expect(crew.source_url).toBe('https://demo.myshopify.com/products/organic-crew');
  });

  test('product.core descriptor has image_urls all absolute', () => {
    const productCore = crew.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    expect(productCore).toBeDefined();
    const imageUrls = productCore!.data.image_urls as string[];
    expect(imageUrls.length).toBeGreaterThan(0);
    for (const u of imageUrls) {
      expect(u.startsWith('https://')).toBe(true);
    }
  });

  test('beanie has //-prefixed image absolutized to https://', () => {
    const productCore = beanie.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    const imageUrls = productCore!.data.image_urls as string[];
    expect(imageUrls[0].startsWith('https://')).toBe(true);
  });

  test('price descriptor is in major units', () => {
    const price = crew.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(49);
    expect(price!.data.currency).toBe('USD');
    expect(price!.data.price_type).toBe('range');
  });

  test('price_type=fixed when min==max', () => {
    const price = beanie.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.price_type).toBe('fixed');
    expect(price!.data.amount).toBe(22);
  });

  test('inventory reflects aggregate availability', () => {
    const inv = crew.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('in_stock');
  });

  test('attributes include has_native_checkout and variant_count', () => {
    const productCore = crew.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    const attrs = productCore!.data.attributes as Record<string, unknown>;
    expect(attrs.has_native_checkout).toBe(true);
    expect(attrs.variant_count).toBe(2);
    expect(attrs.price_max).toBe(59);
  });
});
