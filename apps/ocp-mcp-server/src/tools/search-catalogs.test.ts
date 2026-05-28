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
            registration_id: 'ocp_registry_public',
            result_count: calls.length === 1 ? 0 : 1,
            items: calls.length === 1
              ? []
              : [
                  {
                    catalog_id: validRouteHint.catalog_id,
                    catalog_name: validRouteHint.catalog_name,
                    description: validRouteHint.description,
                    score: 1,
                    matched_query_packs: ['ocp.query.keyword.v1'],
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
