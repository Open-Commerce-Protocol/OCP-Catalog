import type { WebMcpTool } from '@ocp-catalog/webmcp-adapter';
import type { OcpMcpToolMetadata, OcpMcpToolResult } from '../mcp/client';

export type DemoCallRecord = {
  id: string;
  toolName: string;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
};

export type OcpMcpDemoState = {
  webMcpAvailable: boolean;
  mcpEndpoint: string;
  history: DemoCallRecord[];
};

export type OcpMcpDemoContext = {
  getState: () => OcpMcpDemoState;
  callMcpTool: (name: string, args: Record<string, unknown>) => Promise<OcpMcpToolResult>;
  recordCall: (record: Omit<DemoCallRecord, 'id' | 'createdAt'>) => void;
};

export function createOcpMcpDemoWebMcpTools(
  context: OcpMcpDemoContext,
  mcpTools: readonly OcpMcpToolMetadata[],
): WebMcpTool[] {
  return [
    {
      name: 'ocp.mcp.get_page_state',
      description: 'Return the current OCP WebMCP MCP demo state, including recent tool call history.',
      handler: () => summarizeDemoState(context.getState()),
    },
    ...mcpTools.map((definition): WebMcpTool => ({
      name: toWebMcpToolName(definition.name),
      description: definition.description ?? `Call OCP MCP tool ${definition.name}.`,
      inputSchema: definition.inputSchema,
      handler: async (input) => {
        const args = parseToolInput(input);
        const toolName = toWebMcpToolName(definition.name);
        try {
          const result = await context.callMcpTool(definition.name, args);
          context.recordCall({ toolName, input: args, result });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown MCP call failure';
          context.recordCall({ toolName, input: args, error: message });
          throw error;
        }
      },
    })),
  ];
}

export function summarizeDemoState(state: OcpMcpDemoState) {
  return {
    webMcpAvailable: state.webMcpAvailable,
    mcpEndpoint: state.mcpEndpoint,
    history: state.history.map((record) => ({
      id: record.id,
      toolName: record.toolName,
      input: record.input,
      result: record.result,
      error: record.error,
      createdAt: record.createdAt,
    })),
  };
}

function parseToolInput(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('WebMCP tool input must be an object');
  }
  return input as Record<string, unknown>;
}

export function toWebMcpToolName(mcpToolName: string) {
  return `ocp.mcp.${mcpToolName}`;
}
