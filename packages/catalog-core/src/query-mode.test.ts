import { describe, expect, test } from 'bun:test';
import { inferQueryMode } from './query-mode';

describe('inferQueryMode', () => {
  test('returns keyword when only query text is provided', () => {
    expect(inferQueryMode('wireless headphones', {})).toBe('keyword');
  });

  test('returns filter when only filters are provided', () => {
    expect(inferQueryMode('', { category: 'electronics' })).toBe('filter');
  });

  test('returns hybrid when query text and filters are both provided', () => {
    expect(inferQueryMode('wireless headphones', { category: 'electronics' })).toBe('hybrid');
  });
});
