import { describe, expect, test } from 'bun:test';
import type { CatalogManifest } from '@ocp-catalog/ocp-schema';
import { supportedQueryPacks } from './projection';

describe('registration projection', () => {
  test('supportedQueryPacks returns query pack ids, not query capability ids', () => {
    expect(supportedQueryPacks({
      query_capabilities: [
        {
          capability_id: 'ocp.commerce.product.search.v1',
          query_packs: [
            { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'], metadata: {} },
            { pack_id: 'ocp.query.filter.v1', query_modes: ['filter'], metadata: {} },
          ],
        },
      ] as CatalogManifest['query_capabilities'],
    })).toEqual(['ocp.query.keyword.v1', 'ocp.query.filter.v1']);
  });
});
