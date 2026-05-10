export const chromeSetupSteps = [
  'Use Google Chrome 148 or newer.',
  'Open chrome://flags and search WebMCP.',
  'Enable WebMCP for testing.',
  'Enable WebMCP support in DevTools if your Chrome build shows that flag.',
  'Restart Chrome after changing the flags.',
  'Install the Chrome extension: WebMCP - Model Context Tool Inspector.',
  'Open this demo page in that Chrome window.',
  'Open the extension side panel and check that this page registers ocp.mall tools.',
];

export const protocolSteps = [
  {
    label: '先找目录',
    tool: 'ocp.mcp.search_catalogs',
    purpose: '向 Registration 节点询问“应该去哪个 Catalog 查”。这一步只找目录，不查商品。',
  },
  {
    label: '再看能力',
    tool: 'ocp.mcp.inspect_catalog',
    purpose: '读取选中 Catalog 的能力，例如支持什么 query_pack、过滤字段、语言和健康状态。',
  },
  {
    label: '进入目录检索',
    tool: 'ocp.mcp.query_catalog',
    purpose: '对已经选中的 Catalog 发起商品、服务或条目检索。',
  },
  {
    label: '解析选中结果',
    tool: 'ocp.mcp.resolve_catalog_entry',
    purpose: '当用户选中某条结果后，拿到最终详情、商品链接或 provider 提供的动作。',
  },
];

export const shortcutTool = {
  tool: 'ocp.mcp.find_and_query_catalog',
  purpose: '快捷组合工具：适合“不指定 Catalog，直接找商品/价格/库存”的普通问题。它会先找目录，再选一个 Catalog 查询，但不替代 inspect 和 resolve。',
};

export const agentPromptExample = `请使用当前页面暴露的 WebMCP 页面工具，不要自己抓 DOM。
如果我要浏览商品，调用 ocp.mall.list_products：
{
  "limit": 12,
  "offset": 0
}

如果我要搜索商品，调用 ocp.mall.search_products：
{
  "query": "shoes",
  "limit": 12
}

如果我要打开某个商品详情页，先用搜索或浏览结果里的 product_id，再调用 ocp.mall.open_product_page：
{
  "product_id": "返回结果里的商品 id"
}

如果我要换注册中心或 Catalog，调用 ocp.mall.set_data_source。
页面默认注册中心是 https://ocp.deeplumen.io，默认会发现 Commerce Product Search Catalog。`;
