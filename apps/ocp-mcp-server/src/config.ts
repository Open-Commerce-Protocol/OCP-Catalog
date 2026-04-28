import { loadConfig } from '@ocp-catalog/config';

export type McpGatewayConfig = ReturnType<typeof loadConfig>;

export function loadMcpGatewayConfig() {
  return loadConfig();
}
