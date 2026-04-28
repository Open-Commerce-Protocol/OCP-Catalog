import { loadConfig } from '@ocp-catalog/config';

export type McpGatewayConfig = ReturnType<typeof loadConfig>;

export function loadMcpGatewayConfig() {
  return loadConfig();
}

export function selectTransportConfig(config: McpGatewayConfig) {
  return {
    httpPort: config.OCP_MCP_HTTP_PORT,
    httpPath: normalizePath(config.OCP_MCP_HTTP_PATH),
  };
}

function normalizePath(value: string) {
  if (value === '/') return value;
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}
