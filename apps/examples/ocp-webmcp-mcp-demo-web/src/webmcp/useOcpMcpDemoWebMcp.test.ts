import { expect, test } from 'bun:test';
import { createOcpMcpDemoWebMcpTools } from './tools';

test('page WebMCP tools are available without MCP gateway tools/list metadata', () => {
  const tools = createOcpMcpDemoWebMcpTools({
    getState: () => ({
      webMcpAvailable: true,
      registrationBaseUrl: 'https://ocp.deeplumen.io',
      productCount: 0,
      history: [],
    }),
    listProducts: async () => ({ products: [] }),
    searchProducts: async () => ({ products: [] }),
    setDataSource: async () => ({ ok: true }),
    recordCall: () => {},
  });

  expect(tools).toHaveLength(4);
  expect(tools.map((tool) => tool.name)).toContain('ocp.mall.search_products');
});
