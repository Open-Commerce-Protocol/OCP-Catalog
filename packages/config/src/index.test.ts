import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as configPackage from './index';

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

describe('config package infrastructure exports', () => {
  test('exports only reusable environment infrastructure, not global service config', () => {
    expect(configPackage).toHaveProperty('readDotEnv');
    expect(configPackage).toHaveProperty('loadEnv');
    expect(configPackage).toHaveProperty('runtimeBoolean');
    expect(configPackage).not.toHaveProperty('loadConfig');
    expect(configPackage).not.toHaveProperty('envSchema');
  });

  test('reads values from .env in current tree', () => {
    writeFileSync(join(tempDir, '.env'), 'CATALOG_ID=cat_from_dotenv\nPROVIDER_API_PORT=4300\n');

    const config = configPackage.loadEnv({});

    expect(config.CATALOG_ID).toBe('cat_from_dotenv');
    expect(config.PROVIDER_API_PORT).toBe('4300');
  });

  test('explicit env overrides .env values', () => {
    writeFileSync(join(tempDir, '.env'), 'CATALOG_ID=cat_from_dotenv\n');

    const config = configPackage.loadEnv({ CATALOG_ID: 'cat_from_env' });

    expect(config.CATALOG_ID).toBe('cat_from_env');
  });

  test('can disable .env loading for isolated service config tests', () => {
    writeFileSync(join(tempDir, '.env'), 'CATALOG_ID=cat_from_dotenv\n');

    const config = configPackage.loadEnv({}, { includeDotEnv: false });

    expect(config.CATALOG_ID).toBeUndefined();
  });

  test('parses string false as false for runtime boolean env values', () => {
    expect(configPackage.runtimeBoolean.parse('false')).toBe(false);
    expect(configPackage.runtimeBoolean.parse('0')).toBe(false);
    expect(configPackage.runtimeBoolean.parse('true')).toBe(true);
    expect(configPackage.runtimeBoolean.parse('1')).toBe(true);
  });

  test('rejects invalid runtime boolean env strings', () => {
    expect(() => configPackage.runtimeBoolean.parse('disabled')).toThrow();
  });
});
