import { describe, expect, test } from 'bun:test';
import { __providerServiceTestOnly } from './provider-service';

const now = new Date();

describe('provider-service quality helpers', () => {
  test('summarizes product feed quality for publish readiness', () => {
    const summary = __providerServiceTestOnly.summarizeProductQuality([
      {
        id: 'pprod_1',
        providerId: 'provider-1',
        sku: 'sku-1',
        title: 'Travel Headphones',
        summary: 'Wireless noise cancelling headphones.',
        brand: 'North Audio',
        category: 'electronics',
        productUrl: 'https://provider.example/products/sku-1',
        imageUrls: ['https://provider.example/images/sku-1.jpg'],
        currency: 'USD',
        amount: 12999,
        listAmount: 15999,
        priceType: 'fixed',
        availabilityStatus: 'in_stock',
        quantity: 4,
        status: 'active',
        attributes: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'pprod_2',
        providerId: 'provider-1',
        sku: 'sku-2',
        title: 'Budget Cable',
        summary: 'USB-C charging cable.',
        brand: '',
        category: 'accessories',
        productUrl: '',
        imageUrls: [],
        currency: 'USD',
        amount: 999,
        listAmount: null,
        priceType: 'fixed',
        availabilityStatus: 'out_of_stock',
        quantity: 0,
        status: 'active',
        attributes: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(summary.product_count).toBe(2);
    expect(summary.ready_for_publish_count).toBe(1);
    expect(summary.missing_product_url_count).toBe(1);
    expect(summary.missing_image_count).toBe(1);
    expect(summary.out_of_stock_count).toBe(1);
  });

  test('marks readiness false when no active products meet baseline', () => {
    const readiness = __providerServiceTestOnly.buildPublishReadiness({
      product_count: 2,
      ready_for_publish_count: 0,
      missing_price_count: 1,
      missing_list_price_count: 2,
      missing_product_url_count: 1,
      missing_image_count: 2,
      missing_brand_or_category_count: 2,
      out_of_stock_count: 1,
      active_count: 2,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blocking_issues).toContain('No active products meet the standard commerce publish baseline.');
    expect(readiness.warnings.length).toBeGreaterThan(0);
  });
});
