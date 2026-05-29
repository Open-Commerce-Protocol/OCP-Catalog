import { describe, expect, test } from 'bun:test';
import { loadPddConfig } from '../src/config';

const validBase = {
  PDD_CATALOG_ID: 'cat_pdd_test',
  PDD_CATALOG_NAME: 'PDD Test Catalog',
  PDD_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4330',
  PDD_CATALOG_ADMIN_KEY: 'dev-admin-key',
};

describe('loadPddConfig', () => {
  test('minimal catalog config + mock defaults', () => {
    const cfg = loadPddConfig(validBase as any);
    expect(cfg.PDD_MOCK).toBe(true);
    expect(cfg.PDD_CATALOG_PORT).toBe(4330);
    expect(cfg.PDD_PID).toBe('mock_pid_001');
    expect(cfg.PDD_DEFAULT_PAGE_SIZE).toBe(20);
    expect(cfg.PDD_ORDER_POLL_INTERVAL_SEC).toBe(0);
    expect(cfg.PDD_CUSTOM_PARAMS_MODE).toBe('enabled');
  });

  test('uses built-in catalog defaults when env is empty', () => {
    const cfg = loadPddConfig({} as any);
    expect(cfg.PDD_CATALOG_ID).toBe('cat_pdd_affiliate');
    expect(cfg.PDD_CATALOG_PUBLIC_BASE_URL).toBe('http://localhost:4330');
    expect(cfg.PDD_BASE_URL).toBe('https://gw-api.pinduoduo.com/api/router');
  });

  test('PDD_CATALOG_PUBLIC_BASE_URL must be a URL', () => {
    expect(() =>
      loadPddConfig({
        ...validBase,
        PDD_CATALOG_PUBLIC_BASE_URL: 'not-a-url',
      } as any),
    ).toThrow();
  });

  test('PDD_MOCK=false requires ClientId + ClientSecret', () => {
    expect(() =>
      loadPddConfig({ ...validBase, PDD_MOCK: 'false' } as any),
    ).toThrow(/PDD_CLIENT_ID/);
  });

  test('PDD_MOCK=false 拒绝 mock 默认的 PID 占位值', () => {
    expect(() =>
      loadPddConfig({
        ...validBase,
        PDD_MOCK: 'false',
        PDD_CLIENT_ID: 'real_cid',
        PDD_CLIENT_SECRET: 'real_secret',
        // 不传 PDD_PID,会用默认值 'mock_pid_001'
      } as any),
    ).toThrow(/PDD_PID/);
  });

  test('PDD_MOCK=false with all credentials passes', () => {
    const cfg = loadPddConfig({
      ...validBase,
      PDD_MOCK: 'false',
      PDD_CLIENT_ID: 'real_cid',
      PDD_CLIENT_SECRET: 'real_secret',
      PDD_PID: '26829999_278234567',
    } as any);
    expect(cfg.PDD_MOCK).toBe(false);
    expect(cfg.PDD_CLIENT_ID).toBe('real_cid');
    expect(cfg.PDD_PID).toBe('26829999_278234567');
  });

  test('PDD_CATALOG_PORT string is coerced to number', () => {
    const cfg = loadPddConfig({
      ...validBase,
      PDD_CATALOG_PORT: '4400',
    } as any);
    expect(cfg.PDD_CATALOG_PORT).toBe(4400);
    expect(typeof cfg.PDD_CATALOG_PORT).toBe('number');
  });

  test('PDD_CUSTOM_PARAMS_MODE 只接受 enabled/disabled', () => {
    expect(() =>
      loadPddConfig({
        ...validBase,
        PDD_CUSTOM_PARAMS_MODE: 'bogus',
      } as any),
    ).toThrow();

    const cfg = loadPddConfig({
      ...validBase,
      PDD_CUSTOM_PARAMS_MODE: 'disabled',
    } as any);
    expect(cfg.PDD_CUSTOM_PARAMS_MODE).toBe('disabled');
  });
});
