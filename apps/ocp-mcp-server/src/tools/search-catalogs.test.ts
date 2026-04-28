import { describe, expect, test } from 'bun:test';
import { RegistrationClient } from '../ocp/registration-client';
import { inspectCatalogTool } from './inspect-catalog';
import { searchCatalogsTool } from './search-catalogs';
import { createToolDeps, validRouteHint } from '../test-fixtures';

describe('search and inspect tools', () => {
  test('search_catalogs returns normalized candidate summaries', async () => {
    const result = await searchCatalogsTool({
      query: 'commerce product',
      registration_base_url: 'http://localhost:4100',
      limit: 5,
    }, createToolDeps());

    expect(result.registration_base_url).toBe('http://localhost:4100');
    expect(result.catalogs[0]).toMatchObject({
      catalog_id: 'cat_local_dev',
      query_url: 'http://localhost:4000/ocp/query',
    });
  });

  test('inspect_catalog summarizes manifest capabilities', async () => {
    const result = await inspectCatalogTool({
      route_hint: validRouteHint,
    }, createToolDeps());

    expect(result.catalog_id).toBe('cat_local_dev');
    expect(result.supported_query_packs).toContain('ocp.query.keyword.v1');
    expect(result.supported_filter_fields).toContain('category');
  });

  test('registration client accepts legacy center_id search results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ocp_version: '1.0',
      kind: 'CatalogSearchResult',
      id: 'catsearch_legacy',
      center_id: 'center_local_dev',
      result_count: 1,
      items: [
        {
          catalog_id: 'cat_local_dev',
          catalog_name: 'Local OCP Catalog',
          score: 1,
          matched_query_capabilities: ['ocp.query.keyword.v1'],
          verification_status: 'verified',
          trust_tier: 'local_dev',
          health_status: 'healthy',
          route_hint: validRouteHint,
          explain: [],
        },
      ],
      explain: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
      const client = new RegistrationClient({ timeoutMs: 1000, userAgent: 'test' });
      const result = await client.search('https://ocp.deeplumen.io', {
        query: 'commerce',
        filters: {},
        limit: 5,
        explain: true,
      });

      expect(result.registration_id).toBe('center_local_dev');
      expect(result.items[0]?.catalog_id).toBe('cat_local_dev');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
