import { expect, test } from 'bun:test';
import { createOcpMcpDemoWebMcpTools, summarizeDemoState, type OcpMcpDemoContext } from './tools';

test('registers page-native WebMCP tools without MCP server metadata', () => {
  const tools = createOcpMcpDemoWebMcpTools(createContext());
  expect(tools.map((tool) => tool.name)).toEqual([
    'ocp.mall.get_page_state',
    'ocp.mall.list_products',
    'ocp.mall.search_products',
    'ocp.mall.set_data_source',
    'ocp.mall.open_product_page',
  ]);
  expect(tools.find((tool) => tool.name === 'ocp.mall.search_products')?.description).toContain('Search products');
  expect(tools.find((tool) => tool.name === 'ocp.mall.search_products')?.inputSchema).toMatchObject({
    properties: {
      query_pack: {
        enum: ['ocp.query.keyword.v1', 'ocp.query.filter.v1', 'ocp.query.semantic.v1'],
      },
      search_mode: {
        enum: ['keyword', 'filter', 'semantic'],
      },
    },
  });
  expect(tools.find((tool) => tool.name === 'ocp.mall.open_product_page')?.description).toContain('Open the detail page');
});

test('forwards WebMCP product search to page logic and records the result', async () => {
  const calls: unknown[] = [];
  const records: Array<{ toolName: string; input: unknown; result?: unknown; error?: string }> = [];
  const tools = createOcpMcpDemoWebMcpTools(createContext({
    searchProducts: async (input) => {
      calls.push(input);
      return { products: [{ title: 'Demo Shoes' }] };
    },
    recordCall: (record) => {
      records.push(record);
    },
  }));

  const tool = tools.find((candidate) => candidate.name === 'ocp.mall.search_products');
  if (!tool) throw new Error('missing search_products tool');

  const result = await tool.handler({
    query: 'shoes',
    query_pack: 'ocp.query.semantic.v1',
    filters: { in_stock_only: true },
    limit: 5,
  });

  expect(result).toEqual({ products: [{ title: 'Demo Shoes' }] });
  expect(calls).toEqual([{
    query: 'shoes',
    query_pack: 'ocp.query.semantic.v1',
    filters: { in_stock_only: true },
    limit: 5,
  }]);
  expect(records).toEqual([{
    toolName: 'ocp.mall.search_products',
    input: {
      query: 'shoes',
      query_pack: 'ocp.query.semantic.v1',
      filters: { in_stock_only: true },
      limit: 5,
    },
    result: { products: [{ title: 'Demo Shoes' }] },
  }]);
});

test('page state summary exposes selected data source and call history', async () => {
  const state = summarizeDemoState({
    webMcpAvailable: true,
    registrationBaseUrl: 'https://ocp.deeplumen.io/registry',
    selectedCatalogId: 'cat_local_dev',
    selectedCatalogName: 'Commerce Product Search Catalog',
    productCount: 12,
    history: [{
      id: 'call-1',
      toolName: 'ocp.mall.search_products',
      input: { query: 'shoes' },
      result: { ok: true },
      createdAt: '2026-05-10T00:00:00.000Z',
    }],
  });

  expect(state.webMcpAvailable).toBe(true);
  expect(state.registrationBaseUrl).toBe('https://ocp.deeplumen.io/registry');
  expect(state.selectedCatalogId).toBe('cat_local_dev');
  expect(state.productCount).toBe(12);
  expect(state.history).toHaveLength(1);
});

test('forwards WebMCP product page open requests to page logic and records the result', async () => {
  const calls: unknown[] = [];
  const records: Array<{ toolName: string; input: unknown; result?: unknown; error?: string }> = [];
  const tools = createOcpMcpDemoWebMcpTools(createContext({
    openProductPage: async (input) => {
      calls.push(input);
      return { opened: true, productUrl: 'https://example.test/products/shoe-1' };
    },
    recordCall: (record) => {
      records.push(record);
    },
  }));

  const tool = tools.find((candidate) => candidate.name === 'ocp.mall.open_product_page');
  if (!tool) throw new Error('missing open_product_page tool');

  const result = await tool.handler({ product_id: 'shoe-1' });

  expect(result).toEqual({ opened: true, productUrl: 'https://example.test/products/shoe-1' });
  expect(calls).toEqual([{ product_id: 'shoe-1' }]);
  expect(records).toEqual([{
    toolName: 'ocp.mall.open_product_page',
    input: { product_id: 'shoe-1' },
    result: { opened: true, productUrl: 'https://example.test/products/shoe-1' },
  }]);
});

function createContext(overrides: Partial<OcpMcpDemoContext> = {}): OcpMcpDemoContext {
  return {
    getState: () => ({
      webMcpAvailable: true,
      registrationBaseUrl: 'https://ocp.deeplumen.io/registry',
      selectedCatalogId: 'cat_local_dev',
      selectedCatalogName: 'Commerce Product Search Catalog',
      productCount: 0,
      history: [],
    }),
    listProducts: async () => ({ products: [] }),
    searchProducts: async () => ({ products: [] }),
    setDataSource: async () => ({ ok: true }),
    openProductPage: async () => ({ opened: true }),
    recordCall: () => {},
    ...overrides,
  };
}
