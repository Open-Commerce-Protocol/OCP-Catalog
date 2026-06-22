import { describe, expect, test } from 'bun:test';
import { OcpMcpBrokerClient } from './ocp-mcp-client';

describe('OcpMcpBrokerClient', () => {
  test('reports search_catalogs responses without catalogs as a registry error', async () => {
    const client = createClient();
    (client as unknown as { callTool: () => Promise<unknown> }).callTool = async () => ({
      catalog_id: 'cat_test',
    });

    const result = await client.fanoutSearch({ query: 'headphones' });

    expect(result.hits).toEqual([]);
    expect(result.per_catalog).toEqual([
      expect.objectContaining({
        catalog_id: 'ocp_mcp',
        ok: false,
        error: 'search_catalogs failed: mcp search_catalogs returned invalid catalogs',
      }),
    ]);
  });

  test('reports non-array search_catalogs catalogs as a registry error', async () => {
    const client = createClient();
    (client as unknown as { callTool: () => Promise<unknown> }).callTool = async () => ({
      catalogs: {},
    });

    const result = await client.fanoutSearch({ query: 'headphones' });

    expect(result.hits).toEqual([]);
    expect(result.per_catalog).toEqual([
      expect.objectContaining({
        catalog_id: 'ocp_mcp',
        ok: false,
        error: 'search_catalogs failed: mcp search_catalogs returned invalid catalogs',
      }),
    ]);
  });

  test('fails loudly when query_catalog returns no entries array', async () => {
    const client = createClient();
    (client as unknown as { callTool: () => Promise<unknown> }).callTool = async () => ({
      catalog_id: 'cat_test',
      catalog_name: 'Test Catalog',
    });

    await expect((client as unknown as {
      queryOne: (
        catalog: { catalog_id: string; catalog_name: string; route_hint: { supported_query_packs: string[] } },
        query: string,
        limit: number,
      ) => Promise<unknown>;
    }).queryOne({
      catalog_id: 'cat_test',
      catalog_name: 'Test Catalog',
      route_hint: { supported_query_packs: ['ocp.query.semantic.v1'] },
    }, 'headphones', 5)).rejects.toThrow('mcp query_catalog returned invalid entries for catalog cat_test');
  });
});

function createClient(): OcpMcpBrokerClient {
  return new OcpMcpBrokerClient({
    SKILL_GATEWAY_PORT: 4330,
    SKILL_GATEWAY_HOST: '127.0.0.1',
    SKILL_GATEWAY_PUBLIC_BASE_URL: 'http://localhost:4330',
    SKILL_GATEWAY_API_KEYS: new Set(['test_key']),
    SKILL_GATEWAY_UPSTREAM: 'ocp_mcp',
    SKILL_GATEWAY_OCP_MCP_URL: 'http://localhost:4300/mcp',
    SKILL_GATEWAY_OCP_REGISTRATION_URL: 'http://localhost:4100',
    SKILL_GATEWAY_FANOUT_TIMEOUT_MS: 1000,
    SKILL_GATEWAY_CATALOGS: [],
    SKILL_GATEWAY_TELEMETRY_SINK: 'in-memory',
    SKILL_GATEWAY_TELEMETRY_JSONL_PATH: './var/telemetry.jsonl',
  });
}
