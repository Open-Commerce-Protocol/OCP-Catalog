import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './index';

const originalCwd = process.cwd();
const tempDir = join(originalCwd, '.tmp', 'config-tests');

beforeEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  test('reads values from .env in current tree', () => {
    writeFileSync(join(tempDir, '.env'), 'CATALOG_ID=cat_from_dotenv\nPROVIDER_API_PORT=4300\n');

    const config = loadConfig({});

    expect(config.CATALOG_ID).toBe('cat_from_dotenv');
    expect(config.PROVIDER_API_PORT).toBe(4300);
  });

  test('explicit env overrides .env values', () => {
    writeFileSync(join(tempDir, '.env'), 'CATALOG_ID=cat_from_dotenv\n');

    const config = loadConfig({ CATALOG_ID: 'cat_from_env' });

    expect(config.CATALOG_ID).toBe('cat_from_env');
  });

  test('reads MCP gateway defaults from explicit env', () => {
    const config = loadConfig({
      OCP_MCP_DEFAULT_REGISTRATION_URL: 'http://localhost:4100',
      OCP_MCP_REQUEST_TIMEOUT_MS: '15000',
      OCP_MCP_USER_AGENT: 'ocp-mcp-server/test',
      OCP_MCP_API_KEY: 'gateway-key',
      OCP_MCP_TRANSPORT: 'http',
      OCP_MCP_HTTP_PORT: '4301',
      OCP_MCP_HTTP_PATH: '/custom-mcp',
    });

    expect(config.OCP_MCP_DEFAULT_REGISTRATION_URL).toBe('http://localhost:4100');
    expect(config.OCP_MCP_REQUEST_TIMEOUT_MS).toBe(15000);
    expect(config.OCP_MCP_USER_AGENT).toBe('ocp-mcp-server/test');
    expect(config.OCP_MCP_API_KEY).toBe('gateway-key');
    expect(config.OCP_MCP_TRANSPORT).toBe('http');
    expect(config.OCP_MCP_HTTP_PORT).toBe(4301);
    expect(config.OCP_MCP_HTTP_PATH).toBe('/custom-mcp');
  });
});
