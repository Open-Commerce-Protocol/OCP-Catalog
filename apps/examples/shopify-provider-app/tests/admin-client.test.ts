import { describe, expect, test } from 'bun:test';
import { PRODUCT_FIELDS } from '../src/shopify/admin-client';

describe('Shopify Admin product selection', () => {
  test('does not request ProductVariant fields removed from the 2026-04 API', () => {
    expect(PRODUCT_FIELDS).not.toMatch(/\bweight\b/);
    expect(PRODUCT_FIELDS).not.toMatch(/\bweightUnit\b/);
  });
});
