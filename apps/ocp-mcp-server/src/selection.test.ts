import { describe, expect, test } from 'bun:test';
import { selectBestCatalog } from './ocp/selection';
import { createToolDeps } from './test-fixtures';
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
    expect(result.query_result.entries[0]?.title).toBe('Demo Headphones');
  });
});
