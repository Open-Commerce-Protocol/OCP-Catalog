import { describe, expect, test } from 'bun:test';
import { RegistrationClient } from '../ocp/registration-client';
import { inspectCatalogTool } from './inspect-catalog';
import { searchCatalogsTool } from './search-catalogs';
import { createToolDeps, validRouteHint } from '../test-fixtures';
import type { ToolDeps } from './context';

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

  test('search_catalogs falls back to catalog listing when keyword search returns no results', async () => {
    const calls: string[] = [];
    const deps = createToolDeps({
      registrationClient: {
        search: async (
          _baseUrl: Parameters<RegistrationClient['search']>[0],
          body: Parameters<RegistrationClient['search']>[1],
        ) => {
          calls.push(body.query);
          return {
            ocp_version: '1.0',
            kind: 'CatalogSearchResult',
            id: `search_${calls.length}`,
            registration_id: 'registration_local_dev',
            result_count: calls.length === 1 ? 0 : 1,
            items: calls.length === 1
              ? []
              : [
                  {
                    catalog_id: validRouteHint.catalog_id,
                    catalog_name: validRouteHint.catalog_name,
                    description: validRouteHint.description,
                    score: 1,
                    matched_query_capabilities: ['ocp.query.keyword.v1'],
                    verification_status: validRouteHint.verification_status,
                    trust_tier: validRouteHint.trust_tier,
                    health_status: validRouteHint.health_status,
                    route_hint: validRouteHint,
                    explain: [],
                  },
                ],
            explain: [],
          };
        },
        resolve: async () => validRouteHint,
      } as unknown as ToolDeps['registrationClient'],
    });

    const result = await searchCatalogsTool({
      query: 'available services',
      limit: 5,
    }, deps);

    expect(calls).toEqual(['available services', '']);
    expect(result.result_count).toBe(1);
    expect(result.fallback_used).toBe(true);
  });
});
