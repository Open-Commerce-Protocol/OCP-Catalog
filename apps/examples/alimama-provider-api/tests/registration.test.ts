import { describe, expect, test } from 'bun:test';
import { buildProviderRegistration } from '../src/services/registration';
import type { AlimamaConfig } from '../src/config';

const cfg: AlimamaConfig = {
  OCP_CATALOG_BASE_URL: 'http://localhost:4000',
  OCP_CATALOG_ID: 'cat_local_dev',
  OCP_PROVIDER_ID: 'alimama_test',
  OCP_API_KEY: 'dev-api-key',
  OCP_PROVIDER_BASE_URL: 'http://localhost:4300',
  OCP_PROVIDER_ADMIN_KEY: 'dev-admin-key',
  OCP_PROVIDER_HOOK_SECRET: 'dev-hook-secret',
  PROVIDER_PORT: 4300,
  ALIMAMA_MOCK: true,
  ALIMAMA_ADZONE_ID: 'mock_adzone_001',
  ALIMAMA_BASE_URL: 'https://gw.api.taobao.com/router/rest',
  OCP_AUTO_SYNC: false,
};

describe('buildProviderRegistration', () => {
  test('返回结构完整且 ocp_version/kind 正确', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(reg.ocp_version).toBe('1.0');
    expect(reg.kind).toBe('ProviderRegistration');
    expect(reg.registration_version).toBe(1);
    expect(reg.catalog_id).toBe('cat_local_dev');
  });

  test('id 由 provider_id + version 拼接,可识别', () => {
    const reg = buildProviderRegistration(cfg, 7);
    expect(reg.id).toBe('reg_alimama_test_v7');
  });

  test('provider 元信息含 provider_id / homepage / domains', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(reg.provider.provider_id).toBe('alimama_test');
    expect(reg.provider.entity_type).toBe('merchant');
    expect(reg.provider.homepage).toBe('http://localhost:4300');
    expect(reg.provider.domains).toEqual(['localhost']);
  });

  test('object_declarations 含 OCP catalog 要求的最低 required_fields', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(reg.object_declarations.length).toBe(1);
    const guaranteed = reg.object_declarations[0]!.guaranteed_fields;
    // OCP catalog 的 ObjectContract 至少要这三个
    expect(guaranteed).toContain('ocp.commerce.product.core.v1#/title');
    expect(guaranteed).toContain('ocp.commerce.price.v1#/currency');
    expect(guaranteed).toContain('ocp.commerce.price.v1#/amount');
  });

  test('sync.preferred_capabilities 含 ocp.push.batch', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(reg.object_declarations[0]!.sync.preferred_capabilities).toContain('ocp.push.batch');
  });

  test('provider_endpoints 不声明未定稿的 affiliate resolve 协议', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(reg.object_declarations[0]!.sync.provider_endpoints).toEqual({});
  });

  test('updated_at 是合法 ISO 时间', () => {
    const reg = buildProviderRegistration(cfg, 1);
    expect(() => new Date(reg.updated_at).toISOString()).not.toThrow();
  });

  test('域名解析正确(自定义 host)', () => {
    const customCfg = { ...cfg, OCP_PROVIDER_BASE_URL: 'https://alimama.example.com:8080' };
    const reg = buildProviderRegistration(customCfg, 1);
    expect(reg.provider.domains).toEqual(['alimama.example.com']);
  });
});
