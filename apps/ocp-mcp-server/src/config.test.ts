import { describe, expect, test } from 'bun:test';
import { loadMcpGatewayConfig, selectTransportConfig } from './config';

describe('selectTransportConfig', () => {
  test('defaults to HTTP transport from the MCP service schema', () => {
    const config = loadMcpGatewayConfig({}, { includeDotEnv: false });

    expect(selectTransportConfig(config)).toEqual({
      httpPort: 4300,
      httpPath: '/mcp',
    });
  });

  test('reads HTTP settings', () => {
    const config = loadMcpGatewayConfig({
      OCP_MCP_HTTP_PORT: '4301',
      OCP_MCP_HTTP_PATH: '/custom-mcp',
    }, { includeDotEnv: false });

    expect(selectTransportConfig(config)).toEqual({
      httpPort: 4301,
      httpPath: '/custom-mcp',
    });
  });
});
