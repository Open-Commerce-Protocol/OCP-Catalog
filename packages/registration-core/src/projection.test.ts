import { describe, expect, test } from 'bun:test';
import { supportedQueryPacks } from './projection';

describe('registration projection', () => {
  test('supportedQueryPacks returns query pack ids, not query capability ids', () => {
    expect(supportedQueryPacks({
      query_capabilities: [
        {
          capability_id: 'ocp.commerce.product.search.v1',
          query_packs: [
            { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'] },
            { pack_id: 'ocp.query.filter.v1', query_modes: ['filter'] },
          ],
        },
      ],
    })).toEqual(['ocp.query.keyword.v1', 'ocp.query.filter.v1']);
  });
});
