import { expect, test } from 'bun:test';
import { agentPromptExample, chromeSetupSteps, protocolSteps, shortcutTool } from './help-content';

test('help content explains Chrome WebMCP flags and agent prompt', () => {
  expect(chromeSetupSteps.join(' ')).toContain('chrome://flags');
  expect(chromeSetupSteps.join(' ')).toContain('WebMCP');
  expect(chromeSetupSteps.join(' ')).toContain('WebMCP - Model Context Tool Inspector');
  expect(agentPromptExample).toContain('搜索对应商品');
  expect(agentPromptExample).toContain('打开刚才搜索结果中的对应商品页面');
});

test('help content separates registration discovery from catalog retrieval', () => {
  expect(protocolSteps.map((step) => step.tool)).toEqual([
    'ocp.mcp.search_catalogs',
    'ocp.mcp.inspect_catalog',
    'ocp.mcp.query_catalog',
    'ocp.mcp.resolve_catalog_entry',
  ]);
  expect(protocolSteps[0].purpose).toContain('只找目录');
  expect(protocolSteps[2].purpose).toContain('Catalog');
  expect(shortcutTool.tool).toBe('ocp.mcp.find_and_query_catalog');
  expect(shortcutTool.purpose).toContain('快捷组合工具');
  expect(agentPromptExample).toContain('当前页面提供的 WebMCP 能力');
});
