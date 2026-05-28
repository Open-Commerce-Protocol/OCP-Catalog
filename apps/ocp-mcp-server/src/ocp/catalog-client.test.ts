import { describe, expect, test } from 'bun:test';
import { OcpClient } from '@ocp-catalog/ocp-client';
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
      entries: [
        {
          entry: {
            kind: 'CatalogEntry',
            catalog_id: 'channel_catalog_prod',
            entry_id: 'centry_1',
            provider_id: 'provider_1',
            object_id: 'object_1',
            title: 'CRM SaaS 华东渠道代理计划',
            attributes: {},
          },
          score: 1,
          explain: [],
        },
      ],
      explain: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
      const client = new CatalogClient({
        client: new OcpClient({ timeoutMs: 1000, userAgent: 'test' }),
      });
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
      expect(result.entries[0]?.entry.entry_id).toBe('centry_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('query maps shared client HTTP failures to MCP query errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { code: 'unavailable' },
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
      const client = new CatalogClient({
        client: new OcpClient({ timeoutMs: 1000, userAgent: 'test' }),
      });

      await expect(client.query('https://example.test/ocp/query', {
        query: '渠道 招商 代理',
        filters: {},
        limit: 5,
        offset: 0,
        explain: true,
      })).rejects.toMatchObject({
        code: 'catalog_query_failed',
        details: {
          status: 503,
          url: 'https://example.test/ocp/query',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
