import { describe, expect, test } from 'bun:test';
import { queryCatalogTool } from './query-catalog';
import { resolveCatalogEntryTool } from './resolve-catalog-entry';
import { createToolDeps, validRouteHint } from '../test-fixtures';

describe('query and resolve tools', () => {
  test('query_catalog rejects unsupported query packs', async () => {
    await expect(queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.fake.v1',
      query: 'headphones',
    }, createToolDeps())).rejects.toMatchObject({ code: 'invalid_query_pack' });
  });

  test('query_catalog rejects unsupported filter fields', async () => {
    await expect(queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.keyword.v1',
      query: 'headphones',
      filters: {
        seller: 'unsupported',
      },
    }, createToolDeps())).rejects.toMatchObject({ code: 'invalid_filter_field' });
  });

  test('query_catalog forwards a valid keyword request and normalizes results', async () => {
    const result = await queryCatalogTool({
      route_hint: validRouteHint,
      query_pack: 'ocp.query.keyword.v1',
      query: 'wireless headphones',
      filters: {
        category: 'electronics',
      },
      limit: 10,
      explain: true,
    }, createToolDeps());

    expect(result.entries[0]).toMatchObject({
      entry_id: 'entry_1',
      title: 'Demo Headphones',
    });
    expect(result.page.limit).toBe(10);
  });

  test('resolve_catalog_entry returns resolved attributes and actions', async () => {
    const result = await resolveCatalogEntryTool({
      route_hint: validRouteHint,
      entry_id: 'entry_1',
    }, createToolDeps());

    expect(result.entry_id).toBe('entry_1');
    expect(result.actions[0]?.action_id).toBe('view_product');
  });
});
