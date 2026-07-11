import { expect, test } from 'bun:test';
import {
  listCatalogProducts,
  loadCatalogManifestOptions,
  loadCatalogManifestOptionsIsolated,
  searchCatalogOptions,
  selectLoadedCatalog,
  type CatalogOption,
} from './ocp-http';

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
    routeSupportedQueryPacks: ['ocp.query.keyword.v1', 'ocp.query.filter.v1'],
    queryPackOptions: [
    ],
  }]);
});

test('loads manifest query packs and modes for catalog options', async () => {
  const catalog = createCatalog({
    manifestUrl: 'https://catalog.example/ocp/manifest',
    queryPackOptions: [],
  });
  const nextCatalog = await loadCatalogManifestOptions(catalog, async (input) => {
    expect(String(input)).toBe('https://catalog.example/ocp/manifest');
    return Response.json({
      query_capabilities: [{
        capability_id: 'ocp.commerce.product.search.v1',
        query_packs: [
          { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword', 'hybrid'] },
          { pack_id: 'ocp.query.semantic.v1', query_modes: ['semantic'] },
        ],
      }],
    });
  });

  expect(nextCatalog.queryPackOptions).toEqual([
    { packId: 'ocp.query.keyword.v1', queryModes: ['keyword', 'hybrid'] },
    { packId: 'ocp.query.semantic.v1', queryModes: ['semantic'] },
  ]);
});

test('rejects malformed manifest query capabilities', async () => {
  await expect(loadCatalogManifestOptions(createCatalog({ manifestUrl: 'https://catalog.example/ocp/manifest' }), async () => (
    Response.json({ query_capabilities: [{ query_packs: [{ pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword', 'bogus'] }] }] })
  ))).rejects.toThrow('contains unsupported query_mode bogus');
});

test('keeps successful catalogs and records each manifest failure', async () => {
  const result = await loadCatalogManifestOptionsIsolated([
    createCatalog({ catalogId: 'cat_healthy', catalogName: 'Healthy', manifestUrl: 'https://healthy.example/manifest' }),
    createCatalog({ catalogId: 'cat_broken', catalogName: 'Broken', manifestUrl: 'https://broken.example/manifest' }),
  ], async (input) => {
    if (String(input).includes('broken')) return new Response('unavailable', { status: 503 });
    return validManifestResponse();
  });

  expect(result.catalogs.map((catalog) => catalog.catalogId)).toEqual(['cat_healthy']);
  expect(result.failures).toEqual([{
    catalogId: 'cat_broken',
    catalogName: 'Broken',
    manifestUrl: 'https://broken.example/manifest',
    error: 'Catalog manifest fetch failed: HTTP 503',
  }]);
});

  test('returns explicit failures and no selectable catalogs when every manifest fails', async () => {
  const result = await loadCatalogManifestOptionsIsolated([
    createCatalog({ catalogId: 'cat_one', catalogName: 'One', manifestUrl: 'https://one.example/manifest' }),
    createCatalog({ catalogId: 'cat_two', catalogName: 'Two', manifestUrl: undefined }),
  ], async () => new Response('down', { status: 502 }));

  expect(result.catalogs).toEqual([]);
  expect(result.failures).toHaveLength(2);
  expect(selectLoadedCatalog(result)).toBeUndefined();
});

test('recovers a failed catalog on retry without retaining stale failure state', async () => {
  const catalogs = [createCatalog({ catalogId: 'cat_retry', catalogName: 'Retry', manifestUrl: 'https://retry.example/manifest' })];
  let available = false;
  const fetchManifest = async () => available ? validManifestResponse() : new Response('down', { status: 503 });

  const first = await loadCatalogManifestOptionsIsolated(catalogs, fetchManifest);
  available = true;
  const retried = await loadCatalogManifestOptionsIsolated(catalogs, fetchManifest);

  expect(first.catalogs).toEqual([]);
  expect(first.failures).toHaveLength(1);
  expect(retried.catalogs.map((catalog) => catalog.catalogId)).toEqual(['cat_retry']);
  expect(retried.failures).toEqual([]);
});

test('explicitly rejects a requested failed catalog instead of falling back to a healthy catalog', () => {
  const healthy = createCatalog({ catalogId: 'cat_healthy', catalogName: 'Healthy' });
  const result = {
    catalogs: [healthy],
    failures: [{
      catalogId: 'cat_broken',
      catalogName: 'Broken',
      manifestUrl: 'https://broken.example/manifest',
      error: 'Catalog manifest fetch failed: HTTP 503',
    }],
  };

  expect(() => selectLoadedCatalog(result, 'cat_broken')).toThrow(
    'Requested Catalog Broken (cat_broken) failed to load from https://broken.example/manifest: Catalog manifest fetch failed: HTTP 503',
  );
  expect(selectLoadedCatalog(result, 'cat_healthy')).toBe(healthy);
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

test('isolates a hanging manifest with an explicit timeout', async () => {
  const result = await loadCatalogManifestOptionsIsolated([
    createCatalog({ catalogId: 'cat_hanging', catalogName: 'Hanging Catalog', manifestUrl: 'https://hanging.example/ocp/manifest' }),
    createCatalog({ catalogId: 'cat_ready', catalogName: 'Ready Catalog', manifestUrl: 'https://ready.example/ocp/manifest' }),
  ], async (input) => {
    if (String(input).includes('hanging.example')) return await new Promise<Response>(() => {});
    return validManifestResponse();
  }, 10);

  expect(result.catalogs.map((catalog) => catalog.catalogId)).toEqual(['cat_ready']);
  expect(result.failures).toEqual([expect.objectContaining({
    catalogId: 'cat_hanging',
    error: 'Catalog manifest fetch timed out after 10ms',
  })]);
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
    query_mode: 'keyword',
    query: 'shoes',
    limit: 12,
    offset: 0,
  });
});

test('queries catalog products with semantic mode when requested', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    query: 'lightweight headphones for commuting',
    queryMode: 'semantic',
    limit: 8,
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.semantic.v1',
    query_mode: 'semantic',
    query: 'lightweight headphones for commuting',
    limit: 8,
    offset: 0,
  });
});

test('queries catalog products with filter pack and structured filters', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    queryMode: 'filter',
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
    query_mode: 'filter',
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
    queryMode: 'filter',
    filters: { category: 'electronics' },
    limit: 10,
    offset: 20,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
})).rejects.toThrow('only support offset 0');

  expect(called).toBe(false);
});

test('derives query mode from explicit semantic query pack', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    query: 'headphones',
    queryPack: 'ocp.query.semantic.v1',
    limit: 10,
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.semantic.v1',
    query_mode: 'semantic',
    query: 'headphones',
    limit: 10,
    offset: 0,
  });
});

test('derives query mode from explicit filter query pack', async () => {
  const requests: unknown[] = [];
  await listCatalogProducts(createCatalog(), {
    queryPack: 'ocp.query.filter.v1',
    filters: { has_image: true },
    limit: 10,
  }, async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ entries: [] });
  });

  expect(requests[0]).toEqual({
    catalog_id: 'cat_local_dev',
    query_pack: 'ocp.query.filter.v1',
    query_mode: 'filter',
    filters: { has_image: true },
    limit: 10,
    offset: 0,
  });
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

test('rejects query mode not declared by selected query pack before calling catalog', async () => {
  let called = false;
  await expect(listCatalogProducts(createCatalog(), {
    query: 'headphones',
    queryPack: 'ocp.query.filter.v1',
    queryMode: 'semantic',
    limit: 10,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
  })).rejects.toThrow('does not support query_mode semantic');

  expect(called).toBe(false);
});

test('rejects semantic mode without query text before calling catalog', async () => {
  let called = false;
  await expect(listCatalogProducts(createCatalog(), {
    queryMode: 'semantic',
    limit: 10,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
  })).rejects.toThrow('semantic query_mode requires query text');

  expect(called).toBe(false);
});

test('rejects filter pack with query text and no filters before calling catalog', async () => {
  let called = false;
  await expect(listCatalogProducts(createCatalog(), {
    query: 'headphones',
    queryPack: 'ocp.query.filter.v1',
    limit: 10,
  }, async () => {
    called = true;
    return Response.json({ entries: [] });
  })).rejects.toThrow('filter query_pack cannot be used with query text without filters');

  expect(called).toBe(false);
});

function createCatalog(overrides: Partial<CatalogOption> = {}): CatalogOption {
  return {
    catalogId: 'cat_local_dev',
    catalogName: 'Commerce Product Search Catalog',
    queryUrl: 'https://catalog.example/ocp/query',
    routeSupportedQueryPacks: ['ocp.query.keyword.v1', 'ocp.query.filter.v1', 'ocp.query.semantic.v1'],
    queryPackOptions: [
      { packId: 'ocp.query.keyword.v1', queryModes: ['keyword', 'hybrid'] },
      { packId: 'ocp.query.filter.v1', queryModes: ['filter', 'hybrid'] },
      { packId: 'ocp.query.semantic.v1', queryModes: ['semantic', 'hybrid'] },
    ],
    ...overrides,
  };
}

function validManifestResponse() {
  return Response.json({
    query_capabilities: [{
      query_packs: [{ pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'] }],
    }],
  });
}
