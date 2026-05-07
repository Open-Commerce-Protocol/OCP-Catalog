import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './server';
import { testConfig } from './test-fixtures';
import { OCP_TOOL_DEFINITIONS } from './tools/definitions';

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
      expect(client.getInstructions()).toContain('prefer find_and_query_catalog');
      expect(client.getInstructions()).toContain('prices');
      expect(client.getInstructions()).toContain('inventory');

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(OCP_TOOL_DEFINITIONS.map((tool) => tool.id).sort());
      const findAndQuery = tools.tools.find((tool) => tool.name === 'find_and_query_catalog');
      expect(findAndQuery?.description).toContain('Use this first');
      expect(findAndQuery?.description).toContain('products');
      expect(findAndQuery?.description).toContain('prices');
      expect(findAndQuery?.description).toContain('inventory');
      expect(findAndQuery?.description).toContain('suppliers');
      expect(findAndQuery?.description).toContain('purchasable');

      const queryCatalog = tools.tools.find((tool) => tool.name === 'query_catalog');
      expect(queryCatalog?.description).toContain('product');
      expect(queryCatalog?.description).toContain('availability');
      expect(queryCatalog?.description).toContain('SKU');

      const resolveEntry = tools.tools.find((tool) => tool.name === 'resolve_catalog_entry');
      expect(resolveEntry?.description).toContain('purchase');
      expect(resolveEntry?.description).toContain('contact');
      expect(resolveEntry?.description).toContain('provider-owned');

      const queryProperties = queryCatalog?.inputSchema.properties as Record<string, { description?: string }> | undefined;
      expect(queryProperties?.filters?.description).toContain('Do not invent fields');
      expect(queryProperties?.query_pack?.description).toContain('Omit when uncertain');
      expect(queryProperties?.route_hint?.description).toContain('Prefer passing this');

      const description = await client.callTool({ name: 'describe_ocp_catalog', arguments: {} });
      expect(JSON.stringify(description.structuredContent)).toContain('Registration node');
      expect(JSON.stringify(description.structuredContent)).toContain('resolve_catalog_entry');
      expect(JSON.stringify(description.structuredContent)).toContain('wireless headphones');
      expect(JSON.stringify(description.structuredContent)).toContain('find_and_query_catalog');

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain('ocp://catalog/guide');

      const guide = await client.readResource({ uri: 'ocp://catalog/guide' });
      expect(guide.contents[0]).toMatchObject({
        uri: 'ocp://catalog/guide',
        mimeType: 'text/markdown',
      });
      expect('text' in guide.contents[0] ? guide.contents[0].text : '').toContain('Route hint');
      expect('text' in guide.contents[0] ? guide.contents[0].text : '').toContain('User Intent');
      expect('text' in guide.contents[0] ? guide.contents[0].text : '').toContain('Find products, compare prices, check stock');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
