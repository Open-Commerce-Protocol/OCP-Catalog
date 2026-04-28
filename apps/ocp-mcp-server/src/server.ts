import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { errorResult } from './errors';
import { selectTransportConfig, type McpGatewayConfig } from './config';
import { CatalogClient } from './ocp/catalog-client';
import { RegistrationClient } from './ocp/registration-client';
import {
  findAndQueryCatalogInput,
  inspectCatalogInput,
  queryCatalogInput,
  resolveCatalogEntryInput,
  searchCatalogsInput,
  type FindAndQueryCatalogInput,
  type InspectCatalogInput,
  type QueryCatalogInput,
  type ResolveCatalogEntryInput,
  type SearchCatalogsInput,
} from './schemas/tool-inputs';
import type { ToolDeps } from './tools/context';
import { findAndQueryCatalogTool } from './tools/find-and-query-catalog';
import { inspectCatalogTool } from './tools/inspect-catalog';
import { queryCatalogTool } from './tools/query-catalog';
import { resolveCatalogEntryTool } from './tools/resolve-catalog-entry';
import { searchCatalogsTool } from './tools/search-catalogs';

export async function startMcpServer(config: McpGatewayConfig) {
  const transportConfig = selectTransportConfig(config);
  if (transportConfig.transport === 'http') {
    startHttpMcpServer(config, transportConfig.httpPort, transportConfig.httpPath);
    return;
  }

  const server = createMcpServer(config);
  await server.connect(new StdioServerTransport());
}

export function createMcpServer(config: McpGatewayConfig) {
  const server = new McpServer({
    name: 'ocp-mcp-server',
    version: '0.1.0',
  });
  const deps = createToolDeps(config);

  server.registerTool(
    'search_catalogs',
    {
      title: 'Search OCP catalogs',
      description: 'Search an OCP Registration node for catalogs matching a user intent.',
      inputSchema: searchCatalogsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toolResult(() => searchCatalogsTool(args as SearchCatalogsInput, deps)),
  );

  server.registerTool(
    'inspect_catalog',
    {
      title: 'Inspect an OCP catalog',
      description: 'Fetch route hint and manifest details for a selected OCP catalog.',
      inputSchema: inspectCatalogInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toolResult(() => inspectCatalogTool(args as InspectCatalogInput, deps)),
  );

  server.registerTool(
    'query_catalog',
    {
      title: 'Query an OCP catalog',
      description: 'Query a selected OCP catalog using only manifest-supported capabilities.',
      inputSchema: queryCatalogInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toolResult(() => queryCatalogTool(args as QueryCatalogInput, deps)),
  );

  server.registerTool(
    'resolve_catalog_entry',
    {
      title: 'Resolve an OCP catalog entry',
      description: 'Resolve a selected OCP catalog entry into visible attributes and actions.',
      inputSchema: resolveCatalogEntryInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toolResult(() => resolveCatalogEntryTool(args as ResolveCatalogEntryInput, deps)),
  );

  server.registerTool(
    'find_and_query_catalog',
    {
      title: 'Find and query an OCP catalog',
      description: 'Search catalogs, choose the best candidate, and run a catalog query.',
      inputSchema: findAndQueryCatalogInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toolResult(() => findAndQueryCatalogTool(args as FindAndQueryCatalogInput, deps)),
  );

  return server;
}

function createToolDeps(config: McpGatewayConfig): ToolDeps {
  return {
    config,
    registrationClient: new RegistrationClient({
      timeoutMs: config.OCP_MCP_REQUEST_TIMEOUT_MS,
      userAgent: config.OCP_MCP_USER_AGENT,
    }),
    catalogClient: new CatalogClient({
      timeoutMs: config.OCP_MCP_REQUEST_TIMEOUT_MS,
      userAgent: config.OCP_MCP_USER_AGENT,
    }),
  };
}

async function toolResult(run: () => Promise<unknown>) {
  try {
    const result = await run();
    return {
      structuredContent: result as Record<string, unknown>,
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const result = errorResult(error);
    return {
      isError: true,
      structuredContent: result,
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
}

function startHttpMcpServer(config: McpGatewayConfig, port: number, path: string) {
  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== path) {
        return new Response('Not Found', { status: 404 });
      }

      if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const mcpServer = createMcpServer(config);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      try {
        await mcpServer.connect(transport);
        const response = await transport.handleRequest(request);
        queueMicrotask(() => {
          void transport.close();
          void mcpServer.close();
        });
        return response;
      } catch (error) {
        void transport.close();
        void mcpServer.close();
        return Response.json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal server error',
          },
          id: null,
        }, { status: 500 });
      }
    },
  });

  console.error(`OCP MCP HTTP server listening on http://localhost:${server.port}${path}`);
}
