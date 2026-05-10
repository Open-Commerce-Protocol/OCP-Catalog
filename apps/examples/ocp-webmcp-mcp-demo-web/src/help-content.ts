export const chromeSetupSteps = [
  'Use Google Chrome 148 or newer.',
  'Open chrome://flags and search WebMCP.',
  'Enable WebMCP support in DevTools.',
  'Enable WebMCP for testing.',
  'Restart Chrome after changing the flags.',
  'Open this demo page in that Chrome window.',
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

export const agentPromptExample = `请使用当前页面暴露的 WebMCP 工具，并按 OCP Catalog 的分步流程执行：
1. 调用 ocp.mcp.search_catalogs，在 https://ocp.deeplumen.io 这个 Registration 节点查找合适的 commerce product catalog。
2. 对选中的 catalog 调用 ocp.mcp.inspect_catalog，确认它支持哪些 query_pack 和过滤字段。
3. 调用 ocp.mcp.query_catalog，在该 catalog 中查询 shoes，limit 设为 5。
4. 如果我选中了某个结果，再调用 ocp.mcp.resolve_catalog_entry 获取详情和链接。

如果只是快速演示，也可以使用快捷组合工具 ocp.mcp.find_and_query_catalog：
{
  "registration_base_url": "https://ocp.deeplumen.io",
  "catalog_query": "commerce product catalog",
  "query": "shoes",
  "limit": 5
}
请把目录选择过程、商品名称、价格、库存状态和商品链接总结给我。`;
