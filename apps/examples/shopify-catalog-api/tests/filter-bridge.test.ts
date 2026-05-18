import { describe, expect, test } from 'bun:test';
import { catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import { bridgeFilters } from '../src/mapper/filter-bridge';

function req(filters: Record<string, unknown>) {
  return catalogQueryRequestSchema.parse({ query: 'x', filters });
}

describe('bridgeFilters', () => {
  test('in_stock_only → available, accepted', () => {
    const r = bridgeFilters(req({ in_stock_only: true }), { mode: 'global' });
    expect(r.shopifyFilters.available).toBe(true);
    expect(r.acceptedFilters).toContain('in_stock_only');
    expect(r.rejectedFilters).toHaveLength(0);
  });

  test('unsupported filters rejected with warning', () => {
    const r = bridgeFilters(
      req({ category: 'apparel', brand: 'acme', min_amount: 10, max_amount: 50, currency: 'USD' }),
      { mode: 'global' },
    );
    expect(r.rejectedFilters).toEqual(
      expect.arrayContaining(['category', 'brand', 'min_amount', 'max_amount', 'currency']),
    );
    expect(r.warnings.length).toBeGreaterThanOrEqual(5);
    expect(r.shopifyFilters.ships_to).toBeUndefined();
  });

  test('ships_to layered in only for global mode', () => {
    const g = bridgeFilters(req({}), { mode: 'global', shipsToCountry: 'US' });
    expect(g.shopifyFilters.ships_to).toEqual({ country: 'US' });

    const s = bridgeFilters(req({}), { mode: 'storefront', shipsToCountry: 'US' });
    expect(s.shopifyFilters.ships_to).toBeUndefined();
    expect(s.warnings.some((w) => w.includes('ships_to'))).toBe(false);
  });

  test('storefront drops ships_to even if accidentally configured', () => {
    const r = bridgeFilters(req({}), { mode: 'storefront' });
    expect(r.shopifyFilters.ships_to).toBeUndefined();
  });
});
