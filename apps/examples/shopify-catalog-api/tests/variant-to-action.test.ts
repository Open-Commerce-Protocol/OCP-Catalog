import { describe, expect, test } from 'bun:test';
import { mapVariantToAction, variantsToActions } from '../src/mapper/variant-to-action';
import type { ShopifyVariant } from '../src/shopify/types';

const ctx = { productTitle: 'Organic Crew' };

describe('mapVariantToAction', () => {
  test('returns action with checkout url', () => {
    const v: ShopifyVariant = {
      id: 'gid://shopify/ProductVariant/100001',
      sku: 'OCC-BLK-M',
      title: 'Black / M',
      price: { amount: 4900, currency: 'USD' },
      checkout_url: 'https://demo.myshopify.com/checkouts/cn/100001',
      availability: { available: true },
      eligible: { native_checkout: true },
      options: [
        { name: 'Color', label: 'Black' },
        { name: 'Size', label: 'M' },
      ],
    };
    const a = mapVariantToAction(v, ctx);
    expect(a).not.toBeNull();
    expect(a!.action_id).toBe('action_ProductVariant/100001');
    expect(a!.action_type).toBe('url');
    expect(a!.entrypoint.url).toBe('https://demo.myshopify.com/checkouts/cn/100001');
    expect(a!.entrypoint.method).toBe('GET');
    expect(a!.label).toContain('Organic Crew');
    expect(a!.label).toContain('Color: Black');
    expect(a!.description).toContain('OCC-BLK-M');
    expect(a!.description).toContain('49 USD');
    expect(a!.description).toContain('native checkout supported');
    expect(a!.requires_user_confirmation).toBe(true);
  });

  test('skips when availability=false', () => {
    expect(
      mapVariantToAction(
        {
          id: 'gid://shopify/ProductVariant/x',
          checkout_url: 'https://demo/x',
          availability: { available: false },
        },
        ctx,
      ),
    ).toBeNull();
  });

  test('skips when no checkout_url', () => {
    expect(
      mapVariantToAction(
        {
          id: 'gid://shopify/ProductVariant/x',
          availability: { available: true },
        },
        ctx,
      ),
    ).toBeNull();
  });
});

describe('variantsToActions', () => {
  test('filters out null entries', () => {
    const result = variantsToActions(
      [
        {
          id: 'gid://shopify/ProductVariant/1',
          checkout_url: 'https://demo/1',
          availability: { available: true },
        },
        {
          id: 'gid://shopify/ProductVariant/2',
          checkout_url: 'https://demo/2',
          availability: { available: false },
        },
      ],
      ctx,
    );
    expect(result).toHaveLength(1);
    expect(result[0].action_id).toBe('action_ProductVariant/1');
  });
  test('handles undefined', () => {
    expect(variantsToActions(undefined, ctx)).toEqual([]);
  });
});
