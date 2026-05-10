export const chromeSetupSteps = [
  '使用 Google Chrome 148 或更新版本。',
  '在地址栏打开 chrome://flags，搜索 WebMCP。',
  '启用 WebMCP for testing。',
  '如果页面中还有 WebMCP support in DevTools，也一起启用。',
  '重启 Chrome。',
  '安装 Chrome 扩展：WebMCP - Model Context Tool Inspector。',
  '用同一个 Chrome 打开这个商城页面。',
  '打开扩展侧边栏，确认当前页面显示可用工具后即可体验。',
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

export const agentPromptExample = `请使用当前页面提供的 WebMCP 能力来帮我浏览商品。
当我说“看看有哪些商品”时，请读取商品列表。
当我说“找鞋子 / 口红 / 巧克力”时，请搜索对应商品。
当我说“打开这个商品”时，请打开刚才搜索结果中的对应商品页面。
如果我指定了新的注册中心或商品目录，请先切换数据源，再继续搜索。`;
