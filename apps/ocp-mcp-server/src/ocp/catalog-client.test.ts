import { describe, expect, test } from 'bun:test';
import { CatalogClient } from './catalog-client';

describe('CatalogClient', () => {
  test('query fills pagination when a catalog omits page metadata', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: 'qres_channel',
      catalog_id: 'channel_catalog_prod',
      query_pack: 'ocp.query.keyword.v1',
      query: '渠道 招商 代理',
      result_count: 1,
      items: [
        {
          entry_id: 'centry_1',
          provider_id: 'provider_1',
          object_id: 'object_1',
          title: 'CRM SaaS 华东渠道代理计划',
          score: 1,
          attributes: {},
          explain: [],
        },
      ],
      explain: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
      const client = new CatalogClient({ timeoutMs: 1000, userAgent: 'test' });
      const result = await client.query('https://example.test/ocp/query', {
        query: '渠道 招商 代理',
        filters: {},
        limit: 5,
        offset: 0,
        explain: true,
      });

      expect(result.page).toEqual({
        limit: 5,
        offset: 0,
        has_more: false,
      });
      expect(result.items[0]?.entry_id).toBe('centry_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
