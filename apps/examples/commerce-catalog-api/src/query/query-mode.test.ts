import { describe, expect, test } from 'bun:test';
import { inferCommerceQueryMode } from './query-mode';

describe('inferCommerceQueryMode', () => {
  test('returns keyword when only query text is provided', () => {
    expect(inferCommerceQueryMode('wireless headphones', {})).toBe('keyword');
  });

  test('returns filter when only filters are provided', () => {
    expect(inferCommerceQueryMode('', { category: 'electronics' })).toBe('filter');
  });

  test('returns hybrid when query text and filters are both provided', () => {
    expect(inferCommerceQueryMode('wireless headphones', { category: 'electronics' })).toBe('hybrid');
  });
});
