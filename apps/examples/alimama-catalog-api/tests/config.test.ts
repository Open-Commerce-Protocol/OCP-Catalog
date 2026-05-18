import { describe, expect, test } from 'bun:test';
import { loadAlimamaConfig } from '../src/config';

const validBase = {
  ALIMAMA_CATALOG_ID: 'cat_alimama_test',
  ALIMAMA_CATALOG_NAME: 'Alimama Test Catalog',
  ALIMAMA_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4310',
  ALIMAMA_CATALOG_ADMIN_KEY: 'dev-admin-key',
};

describe('loadAlimamaConfig', () => {
  test('minimal catalog config + mock defaults', () => {
    const cfg = loadAlimamaConfig(validBase as any);
    expect(cfg.ALIMAMA_MOCK).toBe(true);
    expect(cfg.ALIMAMA_CATALOG_PORT).toBe(4310);
    expect(cfg.ALIMAMA_ADZONE_ID).toBe('mock_adzone_001');
    expect(cfg.ALIMAMA_DEFAULT_PAGE_SIZE).toBe(20);
    expect(cfg.ALIMAMA_ORDER_POLL_INTERVAL_SEC).toBe(0);
  });

  test('uses built-in catalog defaults when env is empty', () => {
    const cfg = loadAlimamaConfig({} as any);
    expect(cfg.ALIMAMA_CATALOG_ID).toBe('cat_alimama_affiliate');
    expect(cfg.ALIMAMA_CATALOG_PUBLIC_BASE_URL).toBe('http://localhost:4310');
  });

  test('ALIMAMA_CATALOG_PUBLIC_BASE_URL must be a URL', () => {
    expect(() =>
      loadAlimamaConfig({ ...validBase, ALIMAMA_CATALOG_PUBLIC_BASE_URL: 'not-a-url' } as any),
    ).toThrow();
  });

  test('ALIMAMA_MOCK=false requires AppKey and AppSecret', () => {
    expect(() =>
      loadAlimamaConfig({ ...validBase, ALIMAMA_MOCK: 'false' } as any),
    ).toThrow(/ALIMAMA_APP_KEY/);
  });

  test('ALIMAMA_MOCK=false with credentials passes', () => {
    const cfg = loadAlimamaConfig({
      ...validBase,
      ALIMAMA_MOCK: 'false',
      ALIMAMA_APP_KEY: 'real_key',
      ALIMAMA_APP_SECRET: 'real_secret',
    } as any);
    expect(cfg.ALIMAMA_MOCK).toBe(false);
    expect(cfg.ALIMAMA_APP_KEY).toBe('real_key');
  });

  test('ALIMAMA_CATALOG_PORT string is coerced to number', () => {
    const cfg = loadAlimamaConfig({ ...validBase, ALIMAMA_CATALOG_PORT: '4400' } as any);
    expect(cfg.ALIMAMA_CATALOG_PORT).toBe(4400);
    expect(typeof cfg.ALIMAMA_CATALOG_PORT).toBe('number');
  });
});
