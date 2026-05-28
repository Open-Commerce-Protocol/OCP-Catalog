import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { OcpClient, type OcpClientOptions } from '@ocp-catalog/ocp-client';
import { errorResult } from './errors';
import { selectTransportConfig, type McpGatewayConfig } from './config';
import { CatalogClient } from './ocp/catalog-client';
import { RegistrationClient } from './ocp/registration-client';
import {
  getOcpCatalogGuideMarkdown,
  OCP_CATALOG_GUIDE_URI,
  OCP_CATALOG_INSTRUCTIONS,
} from './ocp/self-description';
import { registerOcpTools } from './tools/registry';
import type { ToolDeps } from './tools/context';

export async function startMcpServer(config: McpGatewayConfig) {
  const transportConfig = selectTransportConfig(config);
  startHttpMcpServer(config, transportConfig.httpPort, transportConfig.httpPath);
}

export function createMcpServer(config: McpGatewayConfig) {
  const server = new McpServer({
    name: 'ocp-mcp-server',
    version: '0.1.0',
  }, {
    instructions: OCP_CATALOG_INSTRUCTIONS,
  });
  const deps = createToolDeps(config);

  server.registerResource(
    'ocp_catalog_guide',
    OCP_CATALOG_GUIDE_URI,
    {
      title: 'OCP Catalog agent guide',
      description: 'Self-description for the OCP Catalog MCP gateway, including protocol concepts and recommended tool workflow.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: getOcpCatalogGuideMarkdown(),
      }],
    }),
  );

  registerOcpTools(server, deps, toolResult);

  return server;
}

function createToolDeps(config: McpGatewayConfig): ToolDeps {
  const clientOptions = createOcpClientOptions(config);
  const protocolClient = new OcpClient(clientOptions);
  const queryClient = config.OCP_MCP_API_KEY
    ? new OcpClient({ ...clientOptions, apiKey: config.OCP_MCP_API_KEY })
    : protocolClient;

  return {
    config,
    registrationClient: new RegistrationClient(protocolClient),
    catalogClient: new CatalogClient({
      client: protocolClient,
      queryClient,
    }),
  };
}

function createOcpClientOptions(config: McpGatewayConfig): OcpClientOptions {
  return {
    timeoutMs: config.OCP_MCP_REQUEST_TIMEOUT_MS,
    userAgent: config.OCP_MCP_USER_AGENT,
    activity: {
      apiUrl: optionalConfigString(config.OCP_ACTIVITY_PUBLIC_BASE_URL),
      apiKey: optionalConfigString(config.OCP_ACTIVITY_API_KEY) ?? optionalConfigString(config.API_KEY_DEV),
      sourceKind: 'mcp_gateway',
      clientKind: 'mcp',
      sourceName: 'ocp-mcp-server',
      clientName: config.OCP_MCP_USER_AGENT,
      publicVisibility: 'aggregate_only',
    },
  };
}

function optionalConfigString(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
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
