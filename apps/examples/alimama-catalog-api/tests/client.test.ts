import { describe, expect, test } from 'bun:test';
import { AlimamaClient, AlimamaApiError } from '../src/alimama/client';
import type { AlimamaConfig } from '../src/config';

const mockCfg: AlimamaConfig = {
  ALIMAMA_CATALOG_ID: 'cat_alimama_test',
  ALIMAMA_CATALOG_NAME: 'Alimama Test Catalog',
  ALIMAMA_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4310',
  ALIMAMA_CATALOG_ADMIN_KEY: 'dev-admin-key',
  ALIMAMA_CATALOG_PORT: 4310,
  ALIMAMA_MOCK: true,
  ALIMAMA_ADZONE_ID: 'mock_adzone_001',
  ALIMAMA_BASE_URL: 'https://gw.api.taobao.com/router/rest',
  ALIMAMA_QUERY_TIMEOUT_MS: 5000,
  ALIMAMA_DEFAULT_PAGE_SIZE: 20,
  ALIMAMA_ORDER_POLL_INTERVAL_SEC: 0,
};

describe('AlimamaClient (mock 模式)', () => {
  test('listMaterial 返回 fixture 数据', async () => {
    const client = new AlimamaClient(mockCfg);
    const res = await client.listMaterial({ pageNo: 1, pageSize: 10 });
    expect(res.tbk_dg_material_optional_response.result_list.map_data.length).toBeGreaterThan(0);
    expect(res.tbk_dg_material_optional_response.total_results).toBeGreaterThan(0);
  });

  test('listMaterial pageSize 切片生效', async () => {
    const client = new AlimamaClient(mockCfg);
    const small = await client.listMaterial({ pageNo: 1, pageSize: 2 });
    expect(small.tbk_dg_material_optional_response.result_list.map_data.length).toBe(2);
    // total_results 仍是 fixture 全集
    expect(small.tbk_dg_material_optional_response.total_results).toBe(6);
  });

  test('listMaterial 不发起真实网络请求（即使 ALIMAMA_BASE_URL 是无效地址）', async () => {
    const client = new AlimamaClient({
      ...mockCfg,
      ALIMAMA_BASE_URL: 'http://invalid.localhost.nope:9999/router' as any,
    });
    // 如果意外走了网络,会因为 DNS 失败抛错;mock 模式应安全返回
    const res = await client.listMaterial({ pageNo: 1, pageSize: 5 });
    expect(res.tbk_dg_material_optional_response.result_list.map_data.length).toBe(5);
  });

  test('generatePrivilegeLink 返回 fixture,含 coupon_click_url', async () => {
    const client = new AlimamaClient(mockCfg);
    const res = await client.generatePrivilegeLink({ itemId: '700123456001' });
    const data = res.tbk_privilege_get_response.result.data;
    expect(data.coupon_click_url).toMatch(/^https:\/\/s\.click\.taobao\.com\//);
    expect(data.coupon_info).toBeTruthy();
  });

  test('generatePrivilegeLink 即使 externalId 不同也返同 fixture (mock 不参数化)', async () => {
    const client = new AlimamaClient(mockCfg);
    const a = await client.generatePrivilegeLink({ itemId: 'x', externalId: 'e1' });
    const b = await client.generatePrivilegeLink({ itemId: 'x', externalId: 'e2' });
    expect(a.tbk_privilege_get_response.result.data.coupon_click_url).toEqual(
      b.tbk_privilege_get_response.result.data.coupon_click_url,
    );
  });

  test('getMaterialByItemId 只返回精确匹配的物料', async () => {
    const client = new AlimamaClient(mockCfg);
    const matched = await client.getMaterialByItemId({ itemId: '700123456001' });
    expect(matched?.num_iid).toBe(700123456001);

    const missing = await client.getMaterialByItemId({ itemId: 'missing-item-id' });
    expect(missing).toBeNull();
  });
});

describe('AlimamaClient (real 模式守卫)', () => {
  test('real 模式但 cfg 没 AppKey/Secret → callTop 抛错', async () => {
    const realCfg = { ...mockCfg, ALIMAMA_MOCK: false };
    const client = new AlimamaClient(realCfg);
    await expect(client.listMaterial({ pageNo: 1, pageSize: 5 })).rejects.toThrow(/AppKey/);
  });
});

describe('AlimamaApiError', () => {
  test('保留 subCode 和 details', () => {
    const err = new AlimamaApiError('isv.access-limit', 'rate limited', { foo: 'bar' });
    expect(err.subCode).toBe('isv.access-limit');
    expect(err.message).toBe('rate limited');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.name).toBe('AlimamaApiError');
  });
});
