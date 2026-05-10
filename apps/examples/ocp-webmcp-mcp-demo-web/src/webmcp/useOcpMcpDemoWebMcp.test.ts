import { expect, test } from 'bun:test';
import { shouldRegisterOcpMcpDemoTools } from './useOcpMcpDemoWebMcp';

test('waits for MCP tool metadata before registering WebMCP tools', () => {
  expect(shouldRegisterOcpMcpDemoTools([])).toBe(false);
  expect(shouldRegisterOcpMcpDemoTools([
    { name: 'describe_ocp_catalog', description: 'Describe OCP' },
  ])).toBe(true);
});
