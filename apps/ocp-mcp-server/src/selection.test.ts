import { describe, expect, test } from 'bun:test';
import { selectBestCatalog } from './ocp/selection';
import { createToolDeps, searchResult, validRouteHint } from './test-fixtures';
import { findAndQueryCatalogTool } from './tools/find-and-query-catalog';

describe('catalog selection', () => {
  test('prefers healthy verified catalogs', () => {
    const selected = selectBestCatalog([
      { catalog_id: 'degraded', health_status: 'degraded', verification_status: 'verified' },
      { catalog_id: 'healthy', health_status: 'healthy', verification_status: 'verified' },
    ]);

    expect(selected.catalog_id).toBe('healthy');
  });

  test('find_and_query_catalog searches then queries the chosen catalog', async () => {
    const result = await findAndQueryCatalogTool({
      registration_base_url: 'http://localhost:4100',
      catalog_query: 'commerce',
      query: 'wireless headphones',
      query_pack: 'ocp.query.keyword.v1',
    }, createToolDeps());

    expect(result.selected_catalog.catalog_id).toBe('cat_local_dev');
    expect(result.query_result.entries).toHaveLength(1);
    expect(result.query_result.entries[0]?.entry.title).toBe('Demo Headphones');
  });

  test('find_and_query_catalog forwards explicit semantic query mode', async () => {
    let forwardedQueryPack: string | undefined;
    let forwardedQueryMode: string | undefined;
    const deps = createToolDeps();
    const semanticRouteHint = {
      ...validRouteHint,
      manifest_url: 'http://localhost:4000/ocp/manifest-semantic',
      supported_query_packs: [
        ...validRouteHint.supported_query_packs,
        'ocp.query.semantic.v1',
      ],
    };
    deps.registrationClient.search = async () => ({
      ...searchResult,
      items: searchResult.items.map((item) => ({
        ...item,
        route_hint: semanticRouteHint,
        matched_query_packs: [
          ...item.matched_query_packs,
          'ocp.query.semantic.v1',
        ],
      })),
    });
    const baseManifest = await deps.catalogClient.getManifest('http://localhost:4000/ocp/manifest');
    deps.catalogClient.getManifest = async () => ({
      ...baseManifest,
      query_capabilities: baseManifest.query_capabilities.map((capability) => ({
        ...capability,
        query_packs: [
          ...capability.query_packs,
          {
            pack_id: 'ocp.query.semantic.v1',
            query_modes: ['semantic' as const],
            metadata: {},
          },
        ],
      })),
    });
    deps.catalogClient.query = async (_url, body) => {
      forwardedQueryPack = body.query_pack;
      forwardedQueryMode = body.query_mode;
      return {
        ocp_version: '1.0',
        kind: 'CatalogQueryResult',
        id: 'qres_semantic',
        catalog_id: body.catalog_id ?? 'cat_local_dev',
        query_pack: body.query_pack,
        query_mode: body.query_mode ?? 'semantic',
        query: body.query,
        result_count: 0,
        page: {
          limit: body.limit ?? 10,
          offset: body.offset ?? 0,
          has_more: false,
        },
        entries: [],
        policy_summary: {
          selected_query_pack: body.query_pack,
          query_mode: body.query_mode ?? 'semantic',
          accepted_filters: [],
          rejected_filters: [],
          supports_explain: true,
          warnings: [],
        },
        explain: [],
      };
    };

    await findAndQueryCatalogTool({
      registration_base_url: 'http://localhost:4100',
      catalog_query: 'commerce',
      query: 'comfortable wireless headphones for travel',
      query_pack: 'ocp.query.semantic.v1',
      query_mode: 'semantic',
    }, deps);

    expect(forwardedQueryPack).toBe('ocp.query.semantic.v1');
    expect(forwardedQueryMode).toBe('semantic');
  });
});
