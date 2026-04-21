import { describe, expect, test } from 'bun:test';
import type { CatalogQueryRequest } from '@ocp-catalog/ocp-schema';
import { __queryServiceTestOnly } from './query-service';

const filters: CatalogQueryRequest['filters'] = {
  min_amount: 50,
  max_amount: 150,
  in_stock_only: true,
  has_image: true,
};

describe('query-service commerce helpers', () => {
  test('matches extended commerce filters', () => {
    expect(__queryServiceTestOnly.matchesFilters({
      amount: 99,
      availability_status: 'in_stock',
      has_image: true,
    }, filters)).toBe(true);

    expect(__queryServiceTestOnly.matchesFilters({
      amount: 199,
      availability_status: 'in_stock',
      has_image: true,
    }, filters)).toBe(false);

    expect(__queryServiceTestOnly.matchesFilters({
      amount: 99,
      availability_status: 'out_of_stock',
      has_image: true,
    }, filters)).toBe(false);
  });

  test('applies commerce quality score to richer, in-stock products', () => {
    const richScore = __queryServiceTestOnly.commerceQualityScore({
      amount: 99,
      list_amount: 129,
      has_product_url: true,
      has_image: true,
      availability_status: 'in_stock',
      quality_tier: 'rich',
    }, {});

    const thinScore = __queryServiceTestOnly.commerceQualityScore({
      amount: 99,
      has_product_url: false,
      has_image: false,
      availability_status: 'out_of_stock',
      quality_tier: 'basic',
    }, {});

    expect(richScore).toBeGreaterThan(thinScore);
  });

  test('boosts sku matches in keyword scoring', () => {
    const score = __queryServiceTestOnly.scoreProjection({
      title: 'Travel Headphones',
      sku: 'sku-123',
      brand: 'North Audio',
      category: 'electronics',
      text: 'travel headphones north audio electronics sku-123',
    }, ['sku-123']);

    expect(score).toBeGreaterThanOrEqual(5);
  });
});
