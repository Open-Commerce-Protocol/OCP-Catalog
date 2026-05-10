import { expect, test } from 'bun:test';
import { createOcpMcpDemoWebMcpTools, summarizeDemoState, type OcpMcpDemoContext } from './tools';

test('registers one WebMCP tool per OCP MCP tool plus page state', () => {
  const tools = createOcpMcpDemoWebMcpTools(createContext(), [
    { name: 'describe_ocp_catalog', description: 'Describe OCP', inputSchema: { type: 'object' } },
    { name: 'find_and_query_catalog', description: 'Find catalog items', inputSchema: { type: 'object' } },
  ]);
  expect(tools.map((tool) => tool.name)).toEqual([
    'ocp.mcp.get_page_state',
    'ocp.mcp.describe_ocp_catalog',
    'ocp.mcp.find_and_query_catalog',
  ]);
  expect(tools[2]?.description).toBe('Find catalog items');
  expect(tools[2]?.inputSchema).toEqual({ type: 'object' });
});

test('forwards WebMCP calls to the matching OCP MCP tool and records the result', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const records: Array<{ toolName: string; input: unknown; result?: unknown; error?: string }> = [];
  const tools = createOcpMcpDemoWebMcpTools(createContext({
    callMcpTool: async (name, args) => {
      calls.push({ name, args });
      return { structuredContent: { entries: [{ title: 'Demo Shoes' }] } };
    },
    recordCall: (record) => {
      records.push(record);
    },
  }), [
    { name: 'find_and_query_catalog', description: 'Find catalog items', inputSchema: { type: 'object' } },
  ]);

  const tool = tools.find((candidate) => candidate.name === 'ocp.mcp.find_and_query_catalog');
  if (!tool) throw new Error('missing find_and_query_catalog tool');

  const result = await tool.handler({ query: 'shoes', limit: 5 });

  expect(result).toEqual({ structuredContent: { entries: [{ title: 'Demo Shoes' }] } });
  expect(calls).toEqual([{ name: 'find_and_query_catalog', args: { query: 'shoes', limit: 5 } }]);
  expect(records).toEqual([{
    toolName: 'ocp.mcp.find_and_query_catalog',
    input: { query: 'shoes', limit: 5 },
    result: { structuredContent: { entries: [{ title: 'Demo Shoes' }] } },
  }]);
});

test('page state summary exposes call history without leaking raw endpoint', async () => {
  const state = summarizeDemoState({
    webMcpAvailable: true,
    mcpEndpoint: '/api/ocp-mcp',
    history: [{
      id: 'call-1',
      toolName: 'ocp.mcp.find_and_query_catalog',
      input: { query: 'shoes' },
      result: { structuredContent: { ok: true } },
      createdAt: '2026-05-10T00:00:00.000Z',
    }],
  });

  expect(state.webMcpAvailable).toBe(true);
  expect(state.mcpEndpoint).toBe('/api/ocp-mcp');
  expect(state.history).toHaveLength(1);
  expect(JSON.stringify(state)).not.toContain('localhost:4300');
});

function createContext(overrides: Partial<OcpMcpDemoContext> = {}): OcpMcpDemoContext {
  return {
    getState: () => ({ webMcpAvailable: true, mcpEndpoint: '/api/ocp-mcp', history: [] }),
    callMcpTool: async () => ({ structuredContent: { ok: true } }),
    recordCall: () => {},
    ...overrides,
  };
}
