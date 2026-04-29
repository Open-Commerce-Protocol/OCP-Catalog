import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server';
import { testConfig } from './test-fixtures';

describe('MCP server self-description', () => {
  test('exposes OCP Catalog instructions, guide resource, and description tool', async () => {
    const server = createMcpServer(testConfig);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain('OCP Catalog');
      expect(client.getInstructions()).toContain('search_catalogs');

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('describe_ocp_catalog');
      expect(tools.tools.find((tool) => tool.name === 'query_catalog')?.description).toContain('Typical workflow');

      const description = await client.callTool({ name: 'describe_ocp_catalog', arguments: {} });
      expect(JSON.stringify(description.structuredContent)).toContain('Registration node');
      expect(JSON.stringify(description.structuredContent)).toContain('resolve_catalog_entry');

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain('ocp://catalog/guide');

      const guide = await client.readResource({ uri: 'ocp://catalog/guide' });
      expect(guide.contents[0]).toMatchObject({
        uri: 'ocp://catalog/guide',
        mimeType: 'text/markdown',
      });
      expect('text' in guide.contents[0] ? guide.contents[0].text : '').toContain('Route hint');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
