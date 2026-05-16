import { describe, expect, test } from 'bun:test';
import { loadAlimamaConfig } from '../src/config';

const validBase = {
  OCP_CATALOG_BASE_URL: 'http://localhost:4000',
  OCP_PROVIDER_ID: 'alimama_test',
  OCP_API_KEY: 'dev-api-key',
  OCP_PROVIDER_BASE_URL: 'http://localhost:4300',
};

describe('loadAlimamaConfig', () => {
  test('最小必填配置 + mock 默认 true', () => {
    const cfg = loadAlimamaConfig(validBase as any);
    expect(cfg.ALIMAMA_MOCK).toBe(true);
    expect(cfg.PROVIDER_PORT).toBe(4300);
    expect(cfg.ALIMAMA_ADZONE_ID).toBe('mock_adzone_001');
    expect(cfg.OCP_AUTO_SYNC).toBe(false);
  });

  test('缺必填字段 → 抛 ZodError', () => {
    expect(() => loadAlimamaConfig({} as any)).toThrow();
  });

  test('OCP_CATALOG_BASE_URL 非 URL → 抛 ZodError', () => {
    expect(() =>
      loadAlimamaConfig({ ...validBase, OCP_CATALOG_BASE_URL: 'not-a-url' } as any),
    ).toThrow();
  });

  test('ALIMAMA_MOCK=false 但缺 AppKey → 抛业务规则错误', () => {
    expect(() =>
      loadAlimamaConfig({ ...validBase, ALIMAMA_MOCK: 'false' } as any),
    ).toThrow(/ALIMAMA_APP_KEY/);
  });

  test('ALIMAMA_MOCK=false + AppKey/Secret 齐全 → 通过', () => {
    const cfg = loadAlimamaConfig({
      ...validBase,
      ALIMAMA_MOCK: 'false',
      ALIMAMA_APP_KEY: 'real_key',
      ALIMAMA_APP_SECRET: 'real_secret',
    } as any);
    expect(cfg.ALIMAMA_MOCK).toBe(false);
    expect(cfg.ALIMAMA_APP_KEY).toBe('real_key');
  });

  test('PROVIDER_PORT 字符串 "4400" 被 coerce 到数字', () => {
    const cfg = loadAlimamaConfig({ ...validBase, PROVIDER_PORT: '4400' } as any);
    expect(cfg.PROVIDER_PORT).toBe(4400);
    expect(typeof cfg.PROVIDER_PORT).toBe('number');
  });

  test('OCP_AUTO_SYNC=true 字符串被识别', () => {
    const cfg = loadAlimamaConfig({ ...validBase, OCP_AUTO_SYNC: 'true' } as any);
    expect(cfg.OCP_AUTO_SYNC).toBe(true);
  });
});
