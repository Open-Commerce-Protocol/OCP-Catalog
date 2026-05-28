import { expect, test } from 'bun:test';
import { createOcpMcpDemoWebMcpTools } from './tools';

test('page WebMCP tools are available without MCP gateway tools/list metadata', () => {
  const tools = createOcpMcpDemoWebMcpTools({
    getState: () => ({
      webMcpAvailable: true,
      registrationBaseUrl: 'https://ocp.deeplumen.io/registry',
      productCount: 0,
      history: [],
    }),
    listProducts: async () => ({ products: [] }),
    searchProducts: async () => ({ products: [] }),
    setDataSource: async () => ({ ok: true }),
    openProductPage: async () => ({ opened: true }),
    recordCall: () => {},
  });

  expect(tools).toHaveLength(5);
  expect(tools.map((tool) => tool.name)).toContain('ocp.mall.search_products');
  expect(tools.map((tool) => tool.name)).toContain('ocp.mall.open_product_page');
});
