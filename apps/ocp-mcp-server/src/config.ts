import { loadEnv, type LoadEnvOptions } from '@ocp-catalog/config';
import { z } from 'zod';

export const mcpGatewayConfigSchema = z.object({
  OCP_MCP_DEFAULT_REGISTRATION_URL: z.string().url().default('https://ocp.deeplumen.io/registry'),
  OCP_MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  OCP_MCP_USER_AGENT: z.string().default('ocp-mcp-server/0.1.0'),
  OCP_MCP_API_KEY: z.string().default(''),
  OCP_MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  OCP_MCP_HTTP_PATH: z.string().regex(/^\/[A-Za-z0-9._~/-]*$/).default('/mcp'),
  OCP_ACTIVITY_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4400'),
  OCP_ACTIVITY_API_KEY: z.string().default(''),
  OCP_MCP_SKILL_GATEWAY_URL: z.string().url().default('http://localhost:4330'),
  OCP_MCP_SKILL_GATEWAY_KEY: z.string().default(''),
});

export type McpGatewayConfig = z.infer<typeof mcpGatewayConfigSchema>;

export function loadMcpGatewayConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
) {
  return mcpGatewayConfigSchema.parse(loadEnv(env, options));
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
