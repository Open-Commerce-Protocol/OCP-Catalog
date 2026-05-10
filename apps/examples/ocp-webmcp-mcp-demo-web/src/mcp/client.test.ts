import { expect, test } from 'bun:test';
import { createOcpMcpHttpClient } from './client';

test('posts MCP tools/call with streamable HTTP headers and parses JSON-RPC result', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createOcpMcpHttpClient({
    endpoint: '/api/ocp-mcp',
    fetchImpl: async (input, init) => {
      requests.push({ input, init });
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          structuredContent: { ok: true },
          content: [{ type: 'text', text: 'ok' }],
        },
      });
    },
  });

  const result = await client.callTool('find_and_query_catalog', { query: 'shoes' });

  expect(result.structuredContent).toEqual({ ok: true });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.input).toBe('/api/ocp-mcp');
  expect(requests[0]?.init?.method).toBe('POST');
  const headers = new Headers(requests[0]?.init?.headers);
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('accept')).toBe('application/json, text/event-stream');
  expect(headers.get('mcp-protocol-version')).toBe('2025-03-26');
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'find_and_query_catalog',
      arguments: { query: 'shoes' },
    },
  });
});

test('lists tools from the MCP gateway metadata endpoint', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createOcpMcpHttpClient({
    endpoint: '/api/ocp-mcp',
    fetchImpl: async (input, init) => {
      requests.push({ input, init });
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [{
            name: 'find_and_query_catalog',
            description: 'Find and query OCP catalogs.',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string', description: 'User query' } },
              required: ['query'],
            },
          }],
        },
      });
    },
  });

  const tools = await client.listTools();

  expect(tools).toEqual([{
    name: 'find_and_query_catalog',
    description: 'Find and query OCP catalogs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'User query' } },
      required: ['query'],
    },
  }]);
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
});

test('reports MCP JSON-RPC errors with server message', async () => {
  const client = createOcpMcpHttpClient({
    endpoint: '/api/ocp-mcp',
    fetchImpl: async () => Response.json({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'Invalid tool input' },
    }, { status: 400 }),
  });

  await expect(client.callTool('find_and_query_catalog', {})).rejects.toThrow('Invalid tool input');
});
