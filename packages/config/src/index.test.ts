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
});
