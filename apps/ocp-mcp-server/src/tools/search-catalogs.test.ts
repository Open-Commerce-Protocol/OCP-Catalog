import { describe, expect, test } from 'bun:test';
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
});
