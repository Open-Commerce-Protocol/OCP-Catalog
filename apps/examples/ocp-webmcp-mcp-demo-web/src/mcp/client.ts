export type OcpMcpToolResult = {
  structuredContent?: unknown;
  content?: Array<Record<string, unknown>>;
  isError?: boolean;
  [key: string]: unknown;
};

export type OcpMcpToolMetadata = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type OcpMcpHttpClient = {
  endpoint: string;
  initialize: () => Promise<Record<string, unknown>>;
  listTools: () => Promise<OcpMcpToolMetadata[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<OcpMcpToolResult>;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type JsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: number | string | null;
      result: Record<string, unknown>;
      error?: never;
    }
  | {
      jsonrpc: '2.0';
      id: number | string | null;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
      result?: never;
    };

export type OcpMcpHttpClientOptions = {
  endpoint?: string;
  fetchImpl?: FetchLike;
};

const mcpProtocolVersion = '2025-03-26';

export function createOcpMcpHttpClient(options: OcpMcpHttpClientOptions = {}): OcpMcpHttpClient {
  const endpoint = options.endpoint ?? '/api/ocp-mcp';
  const fetchImpl = options.fetchImpl ?? fetch;
  let nextId = 1;

  return {
    endpoint,
    async initialize() {
      return await postJsonRpc('initialize', {
        protocolVersion: mcpProtocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'ocp-webmcp-mcp-demo-web',
          version: '0.1.0',
        },
      });
    },
    async listTools() {
      const result = await postJsonRpc('tools/list', {});
      const tools = result.tools;
      if (!Array.isArray(tools)) {
        throw new Error('MCP tools/list did not return a tools array');
      }

      return tools.map(normalizeToolMetadata);
    },
    async callTool(name, args) {
      return await postJsonRpc('tools/call', {
        name,
        arguments: args,
      }) as OcpMcpToolResult;
    },
  };

  async function postJsonRpc(method: string, params: Record<string, unknown>) {
    const id = nextId++;
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': mcpProtocolVersion,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
      });

      const payload = await parseMcpResponse(response);
      if (isJsonRpcError(payload)) {
        throw new Error(payload.error.message || `MCP JSON-RPC error ${payload.error.code}`);
      }

      return payload.result;
  }
}

function isJsonRpcError(payload: JsonRpcResponse): payload is Extract<JsonRpcResponse, { error: unknown }> {
  return 'error' in payload && payload.error !== undefined;
}

function normalizeToolMetadata(value: unknown): OcpMcpToolMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP tools/list returned an invalid tool entry');
  }

  const tool = value as Record<string, unknown>;
  if (typeof tool.name !== 'string' || !tool.name.trim()) {
    throw new Error('MCP tools/list returned a tool without a name');
  }

  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : undefined,
    inputSchema: tool.inputSchema,
  };
}

async function parseMcpResponse(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const payload = contentType.includes('text/event-stream')
    ? parseSseJsonRpc(text)
    : parseJsonRpc(text);

  if (!response.ok && 'error' in payload) return payload;
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${text || response.statusText}`);
  }

  return payload;
}

function parseJsonRpc(text: string): JsonRpcResponse {
  if (!text.trim()) {
    throw new Error('MCP response body was empty');
  }

  return JSON.parse(text) as JsonRpcResponse;
}

function parseSseJsonRpc(text: string): JsonRpcResponse {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    throw new Error('MCP SSE response did not contain data');
  }

  return JSON.parse(dataLines[dataLines.length - 1] ?? '') as JsonRpcResponse;
}
