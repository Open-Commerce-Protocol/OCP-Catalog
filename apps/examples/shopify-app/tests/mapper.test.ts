import { describe, expect, test } from 'bun:test';
import { commercialObjectSchema } from '@ocp-catalog/ocp-schema';
import {
  buildTombstoneCommercialObject,
  mapShopifyProductToCommercialObject,
  providerIdForShop,
  type MapperContext,
} from '../src/mapper/product-to-commercial-object';
import type { ShopifyProduct } from '../src/shopify/types';
import fixture from './fixtures/shopify-products.json';

const products = fixture as unknown as ShopifyProduct[];
const ctx: MapperContext = { providerId: 'shopify_app_demo', defaultCurrency: 'USD', storeDomain: 'demo-embedded.myshopify.com' };

describe('providerIdForShop', () => {
  test('derives a stable provider id from the shop domain', () => {
    expect(providerIdForShop('mds0my-wh.myshopify.com')).toBe('shopify_app_mds0my_wh');
    expect(providerIdForShop('coffee.myshopify.com')).toBe('shopify_app_coffee');
  });
});

describe('mapShopifyProductToCommercialObject', () => {
  const [dripper, kettle] = products.map((p) => mapShopifyProductToCommercialObject(p, ctx));

  test('object id + provider id', () => {
    expect(dripper.object_id).toBe('9001');
    expect(dripper.provider_id).toBe('shopify_app_demo');
    expect(dripper.id).toBe('obj_shopify_app_demo_9001');
  });
  test('lowest variant price + compareAt list_amount', () => {
    const price = dripper.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(24);
    expect(price!.data.list_amount).toBe(30);
    expect(price!.data.currency).toBe('USD');
  });
  test('inventory aggregates availableForSale', () => {
    const inv = dripper.descriptors.find((d) => d.pack_id === 'ocp.commerce.inventory.v1');
    expect(inv!.data.availability_status).toBe('in_stock');
    expect(inv!.data.quantity).toBe(120);
  });
  test('images all absolute https', () => {
    const core = dripper.descriptors.find((d) => d.pack_id === 'ocp.commerce.product.core.v1');
    for (const u of core!.data.image_urls as string[]) expect(u.startsWith('https://')).toBe(true);
  });
  test('single-variant kettle → fixed price, no list_amount', () => {
    const price = kettle.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
    expect(price!.data.amount).toBe(59);
    expect(price!.data.price_type).toBe('fixed');
    expect((price!.data as any).list_amount).toBeUndefined();
  });
  test('all mapped fixture products satisfy the OCP CommercialObject schema', () => {
    for (const product of products) {
      expect(() => commercialObjectSchema.parse(mapShopifyProductToCommercialObject(product, ctx))).not.toThrow();
    }
    expect(() => commercialObjectSchema.parse(buildTombstoneCommercialObject('gid://shopify/Product/9001', ctx))).not.toThrow();
  });
});
