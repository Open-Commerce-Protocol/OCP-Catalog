import { describe, expect, test } from 'bun:test';
import {
  absolutize,
  buildWcTombstoneCommercialObject,
  htmlToPlainText,
  mapWcProductToCommercialObject,
  safePrice,
  type MapperContext,
} from '../src/mapper/product-to-commercial-object';
import type { WcProduct, WcVariation } from '../src/woocommerce/types';
import products from './fixtures/wc-products.json';
import variations from './fixtures/wc-variations.json';

const ctx: MapperContext = {
  providerId: 'wc_provider_test',
  defaultCurrency: 'EUR',
  siteUrl: 'https://wc-demo.example.test',
};

const wcProducts = products as unknown as WcProduct[];

describe('helpers', () => {
  test('absolutize', () => {
    expect(absolutize('//cdn.x.test/y.jpg')).toBe('https://cdn.x.test/y.jpg');
    expect(absolutize('https://x.test/y')).toBe('https://x.test/y');
    expect(absolutize('')).toBeUndefined();
    expect(absolutize(null)).toBeUndefined();
  });
  test('htmlToPlainText', () => {
    expect(htmlToPlainText('<p>a <strong>b</strong></p>')).toBe('a b');
  });
  test('safePrice', () => {
    expect(safePrice('39.00')).toBe(39);
    expect(safePrice('')).toBe(0);
    expect(safePrice('not-a-number')).toBe(0);
  });
});

describe('mapWcProductToCommercialObject', () => {
  test('simple product, on sale → list_amount surfaced', () => {
    const apron = wcProducts[0];
    const obj = mapWcProductToCommercialObject(apron, ctx);
    expect(obj.object_id).toBe('901');
    expect(obj.id).toBe('obj_wc_provider_test_901');
    expect(obj.provider_id).toBe('wc_provider_test');
    expect(obj.status).toBe('active');
    expect(obj.source_url).toBe('https://wc-demo.example.test/product/cotton-apron-olive/');

    const core = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    expect(core!.data.brand).toBe('WC Demo Co');
    expect(core!.data.category).toBe('Aprons');
    expect(core!.data.sku).toBe('APRON-OL');
    const imgs = core!.data.image_urls as string[];
    expect(imgs.length).toBe(2);
    for (const u of imgs) expect(u.startsWith('https://')).toBe(true);

    const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(39);
    expect(price!.data.list_amount).toBe(45);
    expect(price!.data.currency).toBe('EUR');

    const inv = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('in_stock');
    expect(inv!.data.quantity).toBe(84);
  });

  test('variable product attaches variation details', () => {
    const blanket = { ...wcProducts[1], variation_details: (variations as any)['902'] as WcVariation[] };
    const obj = mapWcProductToCommercialObject(blanket, ctx);
    const core = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    const attrs = core!.data.attributes as Record<string, unknown>;
    expect(attrs.variant_count).toBe(2);
    expect((attrs.variations as any[])[0].sku).toBe('WTB-GRY-140');
    expect(obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1')!.data.amount).toBe(129);
  });

  test('draft product maps to draft + out_of_stock', () => {
    const draft = wcProducts[2];
    const obj = mapWcProductToCommercialObject(draft, ctx);
    expect(obj.status).toBe('draft');
    const inv = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('out_of_stock');
  });
});

describe('buildWcTombstoneCommercialObject', () => {
  test('inactive with zero price', () => {
    const t = buildWcTombstoneCommercialObject(999, ctx);
    expect(t.status).toBe('inactive');
    expect(t.object_id).toBe('999');
    const price = t.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(0);
  });
});
