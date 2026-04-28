import { describe, expect, test } from 'bun:test';
import { loadConfig } from '@ocp-catalog/config';
import { selectTransportConfig } from './config';

describe('selectTransportConfig', () => {
  test('defaults to HTTP transport', () => {
    const config = loadConfig({});

    expect(selectTransportConfig(config)).toEqual({
      httpPort: 4300,
      httpPath: '/mcp',
    });
  });

  test('reads HTTP settings', () => {
    const config = loadConfig({
      OCP_MCP_HTTP_PORT: '4301',
      OCP_MCP_HTTP_PATH: '/custom-mcp',
    });

    expect(selectTransportConfig(config)).toEqual({
      httpPort: 4301,
      httpPath: '/custom-mcp',
    });
  });
});
