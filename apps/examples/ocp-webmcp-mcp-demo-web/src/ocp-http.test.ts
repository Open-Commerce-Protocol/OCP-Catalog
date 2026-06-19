import { expect, test } from 'bun:test';
import { listCatalogProducts, searchCatalogOptions, type CatalogOption } from './ocp-http';

test('searches registration and extracts selectable catalog options', async () => {
  const options = await searchCatalogOptions('https://ocp.example', async (input, init) => {
    expect(String(input)).toBe('https://ocp.example/ocp/catalogs/search');
    expect(init?.method).toBe('POST');
    return Response.json({
      items: [{
        catalog_id: 'cat_local_dev',
        catalog_name: 'Commerce Product Search Catalog',
        route_hint: {
          catalog_id: 'cat_local_dev',
          catalog_name: 'Commerce Product Search Catalog',
          query_url: 'https://catalog.example/ocp/query',
          supported_query_packs: ['ocp.query.keyword.v1', 'ocp.query.filter.v1'],
        },
      }],
    });
  });

  expect(options).toEqual([{
    catalogId: 'cat_local_dev',
    catalogName: 'Commerce Product Search Catalog',
    queryUrl: 'https://catalog.example/ocp/query',
    manifestUrl: undefined,
    resolveUrl: undefined,
    supportedQueryPacks: ['ocp.query.keyword.v1', 'ocp.query.filter.v1'],
  }]);
});

test('lists catalog products with clean list body when query is empty', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), { query: '', limit: 12 }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    limit: 12,
    offset: 0,
  });
});

test('queries catalog products with keyword pack when query is present', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), { query: 'shoes', limit: 12 }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.keyword.v1',
    query: 'shoes',
    limit: 12,
    offset: 0,
  });
});

test('queries catalog products with semantic mode when requested', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    query: 'lightweight headphones for commuting',
    searchMode: 'semantic',
    limit: 8,
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.semantic.v1',
    query: 'lightweight headphones for commuting',
    limit: 8,
    offset: 0,
  });
});

test('queries catalog products with filter pack and structured filters', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    searchMode: 'filter',
    filters: {
      category: 'electronics',
      in_stock_only: true,
      brand: '',
    },
    limit: 10,
    offset: 0,
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.filter.v1',
    filters: {
      category: 'electronics',
      in_stock_only: true,
    },
    limit: 10,
    offset: 0,
  });
});

test('rejects deep offset before calling catalog', async () => {
  let called = false;
  await expect(listCatalogProducts(createCatalog(), {
    searchMode: 'filter',
    filters: { category: 'electronics' },
    limit: 10,
    offset: 20,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
  })).rejects.toThrow('only support offset 0');

  expect(called).toBe(false);
});

test('rejects unsupported requested query packs before calling catalog', async () => {
  let called = false;
  await expect(listCatalogProducts(createCatalog(), {
    query: 'headphones',
    queryPack: 'ocp.query.unknown.v1',
    limit: 10,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
  })).rejects.toThrow('does not support query_pack ocp.query.unknown.v1');

  expect(called).toBe(false);
});

function createCatalog(): CatalogOption {
  return {
    catalogId: 'cat_local_dev',
    catalogName: 'Commerce Product Search Catalog',
    queryUrl: 'https://catalog.example/ocp/query',
    supportedQueryPacks: ['ocp.query.keyword.v1', 'ocp.query.filter.v1', 'ocp.query.semantic.v1'],
  };
}
