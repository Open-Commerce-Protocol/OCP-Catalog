import { describe, expect, test } from 'bun:test';
import {
  KEYWORD_QUERY_PACK,
  SEMANTIC_QUERY_PACK,
  routeSupportedQueryPacks,
  selectSearchQueryPolicy,
} from './query-pack';

describe('selectSearchQueryPolicy', () => {
  test('prefers semantic pack when the catalog declares it', () => {
    expect(selectSearchQueryPolicy({
      query: 'comfortable shoes for travel',
      supportedQueryPacks: [KEYWORD_QUERY_PACK, SEMANTIC_QUERY_PACK],
    })).toEqual({ queryPack: SEMANTIC_QUERY_PACK, queryMode: 'semantic' });
  });

  test('uses keyword when semantic is not declared', () => {
    expect(selectSearchQueryPolicy({
      query: 'nike shoes',
      supportedQueryPacks: [KEYWORD_QUERY_PACK],
    })).toEqual({ queryPack: KEYWORD_QUERY_PACK });
  });

  test('does not invent a query pack for unsupported catalogs', () => {
    expect(selectSearchQueryPolicy({
      query: 'anything',
      supportedQueryPacks: ['ocp.query.filter.v1'],
    })).toBeUndefined();
  });

  test('omits query pack for blank queries', () => {
    expect(selectSearchQueryPolicy({
      query: '   ',
      supportedQueryPacks: [SEMANTIC_QUERY_PACK],
    })).toBeUndefined();
  });
});

describe('routeSupportedQueryPacks', () => {
  test('extracts string query packs from route_hint', () => {
    expect(routeSupportedQueryPacks({
      supported_query_packs: [SEMANTIC_QUERY_PACK, KEYWORD_QUERY_PACK],
    }, 'cat_test')).toEqual([SEMANTIC_QUERY_PACK, KEYWORD_QUERY_PACK]);
  });

  test('fails loudly when route_hint is missing query packs', () => {
    expect(() => routeSupportedQueryPacks({}, 'cat_test')).toThrow(
      'catalog cat_test route_hint.supported_query_packs is missing or invalid',
    );
    expect(() => routeSupportedQueryPacks(undefined, 'cat_test')).toThrow(
      'catalog cat_test route_hint is missing or invalid',
    );
  });

  test('fails loudly when route_hint query packs contain non-string values', () => {
    expect(() => routeSupportedQueryPacks({
      supported_query_packs: [SEMANTIC_QUERY_PACK, 123],
    }, 'cat_test')).toThrow('catalog cat_test route_hint.supported_query_packs contains non-string values');
  });
});
