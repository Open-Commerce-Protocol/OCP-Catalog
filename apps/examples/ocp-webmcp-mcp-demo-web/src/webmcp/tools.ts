import type { WebMcpTool } from '@ocp-catalog/webmcp-adapter';

export type DemoCallRecord = {
  id: string;
  toolName: string;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
};

export type OcpMcpDemoState = {
  webMcpAvailable: boolean;
  registrationBaseUrl: string;
  selectedCatalogId?: string;
  selectedCatalogName?: string;
  productCount: number;
  history: DemoCallRecord[];
};

export type ProductSearchInput = {
  query?: string;
  query_pack?: string;
  search_mode?: 'keyword' | 'filter' | 'semantic';
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
};

export type DataSourceInput = {
  registration_base_url?: string;
  catalog_id?: string;
};

export type OpenProductInput = {
  product_id?: string;
  product_url?: string;
  title?: string;
};

export type OcpMcpDemoContext = {
  getState: () => OcpMcpDemoState;
  listProducts: (input: ProductSearchInput) => Promise<unknown>;
  searchProducts: (input: ProductSearchInput) => Promise<unknown>;
  setDataSource: (input: DataSourceInput) => Promise<unknown>;
  openProductPage: (input: OpenProductInput) => Promise<unknown>;
  recordCall: (record: Omit<DemoCallRecord, 'id' | 'createdAt'>) => void;
};

export function createOcpMcpDemoWebMcpTools(context: OcpMcpDemoContext): WebMcpTool[] {
  return [
    {
      name: 'ocp.mall.get_page_state',
      description: 'Return the current OCP Catalog Mall page state, selected Registration node, selected Catalog, product count, and recent WebMCP calls.',
      handler: () => summarizeDemoState(context.getState()),
    },
    {
      name: 'ocp.mall.list_products',
      description: 'List products from the currently selected OCP Commerce Product Catalog using its HTTP clean-list query. Use this when the user wants to browse products without a search phrase.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of products to return. Defaults to 24.' },
          offset: { type: 'number', description: 'Must be 0. Deep offset pagination is disabled; narrow filters instead.' },
        },
      },
      handler: async (input) => runPageTool(context, 'ocp.mall.list_products', parseToolInput(input), context.listProducts),
    },
    {
      name: 'ocp.mall.search_products',
      description: 'Search products in the currently selected OCP Commerce Product Catalog. The page calls the selected Catalog HTTP query endpoint with a supported query pack.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product search phrase such as shoes, jacket, lipstick, or chocolate.' },
          query_pack: {
            type: 'string',
            enum: ['ocp.query.keyword.v1', 'ocp.query.filter.v1', 'ocp.query.semantic.v1'],
            description: 'Exact OCP query pack to use when the selected Catalog supports it.',
          },
          search_mode: {
            type: 'string',
            enum: ['keyword', 'filter', 'semantic'],
            description: 'Search mode shortcut. keyword uses text search, filter uses structured filters, semantic uses meaning-based retrieval.',
          },
          filters: {
            type: 'object',
            description: 'Structured Catalog filters for filter or hybrid searches, such as category, brand, currency, availability_status, provider_id, sku, min_amount, max_amount, in_stock_only, or has_image.',
          },
          limit: { type: 'number', description: 'Maximum number of products to return. Defaults to 24.' },
          offset: { type: 'number', description: 'Must be 0. Deep offset pagination is disabled; narrow filters instead.' },
        },
        required: ['query'],
      },
      handler: async (input) => runPageTool(context, 'ocp.mall.search_products', parseToolInput(input), context.searchProducts),
    },
    {
      name: 'ocp.mall.set_data_source',
      description: 'Choose the Registration node and/or Catalog used by this page. Use this before product search when the user asks to use a different OCP Registration node or Catalog.',
      inputSchema: {
        type: 'object',
        properties: {
          registration_base_url: { type: 'string', description: 'OCP Registration base URL, for example https://ocp.deeplumen.io/registry.' },
          catalog_id: { type: 'string', description: 'Catalog id returned by Registration search, for example cat_local_dev.' },
        },
      },
      handler: async (input) => runPageTool(context, 'ocp.mall.set_data_source', parseToolInput(input), context.setDataSource),
    },
    {
      name: 'ocp.mall.open_product_page',
      description: 'Open the detail page for a product currently shown in the OCP Catalog Mall. Prefer product_id returned by list/search results; product_url or exact title can also be used.',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Product id returned by ocp.mall.list_products or ocp.mall.search_products.' },
          product_url: { type: 'string', description: 'Direct product URL returned by the product result.' },
          title: { type: 'string', description: 'Exact product title when product_id is not available.' },
        },
      },
      handler: async (input) => runPageTool(context, 'ocp.mall.open_product_page', parseToolInput(input), context.openProductPage),
    },
  ];
}

export function summarizeDemoState(state: OcpMcpDemoState) {
  return {
    webMcpAvailable: state.webMcpAvailable,
    registrationBaseUrl: state.registrationBaseUrl,
    selectedCatalogId: state.selectedCatalogId,
    selectedCatalogName: state.selectedCatalogName,
    productCount: state.productCount,
    history: state.history.map((record) => ({
      id: record.id,
      toolName: record.toolName,
      input: record.input,
      result: record.result,
      error: record.error,
      createdAt: record.createdAt,
    })),
  };
}

async function runPageTool(
  context: OcpMcpDemoContext,
  toolName: string,
  input: Record<string, unknown>,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
) {
  try {
    const result = await handler(input);
    context.recordCall({ toolName, input, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WebMCP page tool failure';
    context.recordCall({ toolName, input, error: message });
    throw error;
  }
}

function parseToolInput(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('WebMCP tool input must be an object');
  }
  return input as Record<string, unknown>;
}
