import { describe, expect, test } from 'bun:test';
import { __registrationServiceTestOnly } from './registration-service';

describe('registration-service catalog quality summary', () => {
  test('summarizes provider catalog quality from entry projections', () => {
    const summary = __registrationServiceTestOnly.summarizeCatalogProviderQuality([
      {
        entryStatus: 'active',
        projection: {
          quality_tier: 'rich',
          availability_status: 'in_stock',
          has_image: true,
          has_product_url: true,
        },
      },
      {
        entryStatus: 'active',
        projection: {
          quality_tier: 'standard',
          availability_status: 'out_of_stock',
          has_image: false,
          has_product_url: true,
        },
      },
      {
        entryStatus: 'inactive',
        projection: {
          quality_tier: 'basic',
          availability_status: 'unknown',
          has_image: false,
          has_product_url: false,
        },
      },
    ]);

    expect(summary.object_count).toBe(3);
    expect(summary.active_entry_count).toBe(2);
    expect(summary.rich_entry_count).toBe(1);
    expect(summary.standard_entry_count).toBe(1);
    expect(summary.basic_entry_count).toBe(1);
    expect(summary.out_of_stock_count).toBe(1);
    expect(summary.missing_image_count).toBe(2);
    expect(summary.missing_product_url_count).toBe(1);
  });
});
