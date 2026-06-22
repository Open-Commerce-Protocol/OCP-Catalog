import { describe, expect, test } from 'bun:test';
import { loadJdUnionConfig } from '../src/config';

const validBase = {
  JDUNION_CATALOG_ID: 'cat_jdunion_test',
  JDUNION_CATALOG_NAME: 'JD Union Test Catalog',
  JDUNION_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4320',
  JDUNION_CATALOG_ADMIN_KEY: 'dev-admin-key',
};

describe('loadJdUnionConfig', () => {
  test('minimal catalog config + mock defaults', () => {
    const cfg = loadJdUnionConfig(validBase as any);
    expect(cfg.JDUNION_MOCK).toBe(true);
    expect(cfg.JDUNION_CATALOG_PORT).toBe(4320);
    expect(cfg.JDUNION_POSITION_ID).toBe('mock_position_001');
    expect(cfg.JDUNION_DEFAULT_PAGE_SIZE).toBe(20);
    expect(cfg.JDUNION_ORDER_POLL_INTERVAL_SEC).toBe(0);
    expect(cfg.JDUNION_RESOLVE_STRATEGY).toBe('goods_promotion');
  });

  test('uses built-in catalog defaults when env is empty', () => {
    const cfg = loadJdUnionConfig({} as any);
    expect(cfg.JDUNION_CATALOG_ID).toBe('cat_jdunion_affiliate');
    expect(cfg.JDUNION_CATALOG_PUBLIC_BASE_URL).toBe('http://localhost:4320');
    expect(cfg.JDUNION_BASE_URL).toBe('https://api.jd.com/routerjson');
  });

  test('JDUNION_CATALOG_PUBLIC_BASE_URL must be a URL', () => {
    expect(() =>
      loadJdUnionConfig({
        ...validBase,
        JDUNION_CATALOG_PUBLIC_BASE_URL: 'not-a-url',
      } as any),
    ).toThrow();
  });

  test('JDUNION_MOCK=false requires AppKey + AppSecret', () => {
    expect(() =>
      loadJdUnionConfig({ ...validBase, JDUNION_MOCK: 'false' } as any),
    ).toThrow(/JDUNION_APP_KEY/);
  });

  test('JDUNION_MOCK=false requires UnionId even when key/secret present', () => {
    expect(() =>
      loadJdUnionConfig({
        ...validBase,
        JDUNION_MOCK: 'false',
        JDUNION_APP_KEY: 'real_key',
        JDUNION_APP_SECRET: 'real_secret',
      } as any),
    ).toThrow(/JDUNION_UNION_ID/);
  });

  test('JDUNION_MOCK=false with all credentials passes', () => {
    const cfg = loadJdUnionConfig({
      ...validBase,
      JDUNION_MOCK: 'false',
      JDUNION_APP_KEY: 'real_key',
      JDUNION_APP_SECRET: 'real_secret',
      JDUNION_UNION_ID: '1234567890',
      JDUNION_POSITION_ID: '900000001',
    } as any);
    expect(cfg.JDUNION_MOCK).toBe(false);
    expect(cfg.JDUNION_APP_KEY).toBe('real_key');
    expect(cfg.JDUNION_UNION_ID).toBe('1234567890');
    expect(cfg.JDUNION_POSITION_ID).toBe('900000001');
  });

  test('JDUNION_CATALOG_PORT string is coerced to number', () => {
    const cfg = loadJdUnionConfig({
      ...validBase,
      JDUNION_CATALOG_PORT: '4400',
    } as any);
    expect(cfg.JDUNION_CATALOG_PORT).toBe(4400);
    expect(typeof cfg.JDUNION_CATALOG_PORT).toBe('number');
  });

  test('JDUNION_RESOLVE_STRATEGY only accepts known values', () => {
    expect(() =>
      loadJdUnionConfig({
        ...validBase,
        JDUNION_RESOLVE_STRATEGY: 'bogus_value',
      } as any),
    ).toThrow();

    const cfg = loadJdUnionConfig({
      ...validBase,
      JDUNION_RESOLVE_STRATEGY: 'promotion_common',
    } as any);
    expect(cfg.JDUNION_RESOLVE_STRATEGY).toBe('promotion_common');
  });
});
