import { describe, expect, test } from 'bun:test';
import type { CatalogManifest } from '@ocp-catalog/ocp-schema';
import { manifest } from '../test-fixtures';
import { negotiateQueryPolicy } from './query-policy';

describe('query policy', () => {
  test('rejects a requested pack when the inferred query mode is unsupported', () => {
    expect(() => negotiateQueryPolicy(manifest, {
      query_pack: 'ocp.query.filter.v1',
      query: 'wireless headphones',
      filters: {},
    })).toThrowError(expect.objectContaining({
      code: 'invalid_query_mode',
      details: expect.objectContaining({
        query_pack: 'ocp.query.filter.v1',
        query_mode: 'keyword',
        supported_query_modes: ['filter', 'hybrid'],
      }),
    }));
  });

  test('rejects omitted pack selection when no pack supports the inferred query mode', () => {
    const keywordOnlyManifest: CatalogManifest = {
      ...manifest,
      query_capabilities: manifest.query_capabilities.map((capability) => ({
        ...capability,
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            query_modes: ['keyword'],
            metadata: {},
          },
        ],
      })),
    };

    expect(() => negotiateQueryPolicy(keywordOnlyManifest, {
      query: 'wireless headphones',
      filters: {
        category: 'electronics',
      },
    })).toThrowError(expect.objectContaining({
      code: 'invalid_query_mode',
      details: expect.objectContaining({
        query_mode: 'hybrid',
        supported_query_modes: ['keyword'],
        supported_query_packs: ['ocp.query.keyword.v1'],
      }),
    }));
  });

  test('rejects semantic mode without query text', () => {
    const semanticManifest: CatalogManifest = {
      ...manifest,
      query_capabilities: manifest.query_capabilities.map((capability) => ({
        ...capability,
        query_packs: [
          ...capability.query_packs,
          {
            pack_id: 'ocp.query.semantic.v1',
            query_modes: ['semantic'],
            metadata: {},
          },
        ],
      })),
    };

    expect(() => negotiateQueryPolicy(semanticManifest, {
      query_pack: 'ocp.query.semantic.v1',
      query_mode: 'semantic',
      query: '',
      filters: {},
    })).toThrowError(expect.objectContaining({
      code: 'invalid_query',
      details: expect.objectContaining({
        query_pack: 'ocp.query.semantic.v1',
        query_mode: 'semantic',
      }),
    }));
  });
});
