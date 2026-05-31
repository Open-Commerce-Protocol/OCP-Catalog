import { describe, expect, test } from 'bun:test';
import { PddClient, unixSeconds } from '../src/pdd/client';
import type { PddConfig } from '../src/config';

const mockCfg: PddConfig = {
  PDD_CATALOG_ID: 'cat_pdd_test',
  PDD_CATALOG_NAME: 'PDD Test',
  PDD_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4330',
  PDD_CATALOG_ADMIN_KEY: 'dev-admin-key',
  PDD_CATALOG_PORT: 4330,
  PDD_MOCK: true,
  PDD_PID: 'mock_pid_001',
  PDD_BASE_URL: 'https://gw-api.pinduoduo.com/api/router',
  PDD_QUERY_TIMEOUT_MS: 5000,
  PDD_DEFAULT_PAGE_SIZE: 20,
  PDD_ORDER_POLL_INTERVAL_SEC: 0,
  PDD_CUSTOM_PARAMS_MODE: 'enabled',
};

describe('PddClient (mock mode)', () => {
  test('listGoods 返回 fixture 商品并按 pageSize 切片', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.listGoods({ page: 1, pageSize: 3 });
    expect(res.goods_list?.length).toBe(3);
    expect(res.total_count).toBe(5);
    expect(res.goods_list?.[0]!.goods_id).toBe(250012345678);
    // PDD 价格是分:¥2499.00 = 249900 分
    expect(res.goods_list?.[0]!.min_group_price).toBe(249900);
  });

  test('listGoods pageSize >= 总数时 hasMore 隐式 false', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.listGoods({ page: 1, pageSize: 50 });
    expect(res.goods_list?.length).toBe(5);
  });

  test('generatePromotionUrl 返回 deterministic 短链 (mock hash 稳定)', async () => {
    const client = new PddClient(mockCfg);
    const a = await client.generatePromotionUrl({ goodsIdList: [250012345678] });
    const b = await client.generatePromotionUrl({ goodsIdList: [250012345678] });
    expect(a.length).toBe(1);
    expect(a[0]!.short_url).toContain('p.pinduoduo.com');
    expect(a[0]!.short_url).toEqual(b[0]!.short_url);
  });

  test('generatePromotionUrl 不同 goodsId 产生不同短链', async () => {
    const client = new PddClient(mockCfg);
    const a = await client.generatePromotionUrl({ goodsIdList: [250012345678] });
    const b = await client.generatePromotionUrl({ goodsIdList: [250023456789] });
    expect(a[0]!.short_url).not.toEqual(b[0]!.short_url);
  });

  test('generatePromotionUrl 不同 customParameters 产生不同短链 (per-Agent 归因)', async () => {
    const client = new PddClient(mockCfg);
    const a = await client.generatePromotionUrl({
      goodsIdList: [250012345678],
      customParameters: '{"uid":"agt_alice"}',
    });
    const b = await client.generatePromotionUrl({
      goodsIdList: [250012345678],
      customParameters: '{"uid":"agt_bob"}',
    });
    expect(a[0]!.short_url).not.toEqual(b[0]!.short_url);
  });

  test('generatePromotionUrl 批量(多个 goods)返回数组', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.generatePromotionUrl({
      goodsIdList: [250012345678, 250023456789, 250034567890],
    });
    expect(res.length).toBe(3);
    for (const item of res) {
      expect(item.short_url).toContain('p.pinduoduo.com');
    }
  });

  test('getGoodsDetail 返回 fixture 商品(共用 promotion fixture)', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.getGoodsDetail({ goodsIdList: [250012345678] });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.short_url).toContain('p.pinduoduo.com');
  });

  test('listOrderIncrement 返回 fixture 订单含 4 个状态', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.listOrderIncrement({
      startUpdateTime: 1715000000,
      endUpdateTime: 1716000000,
      page: 1,
      pageSize: 100,
    });
    expect(res.order_list?.length).toBe(4);
    const statuses = new Set(res.order_list?.map((o) => o.order_status));
    expect(statuses.has(0)).toBe(true);  // 已下单
    expect(statuses.has(4)).toBe(true);  // 审核成功
    expect(statuses.has(5)).toBe(true);  // 审核失败
    expect(statuses.has(8)).toBe(true);  // 已结算
  });

  test('listOrderIncrement: custom_parameters 是 JSON 字符串', async () => {
    const client = new PddClient(mockCfg);
    const res = await client.listOrderIncrement({
      startUpdateTime: 1715000000,
      endUpdateTime: 1716000000,
      page: 1,
      pageSize: 100,
    });
    const sample = res.order_list?.[0]!;
    expect(typeof sample.custom_parameters).toBe('string');
    const parsed = JSON.parse(sample.custom_parameters!);
    expect(parsed.uid).toMatch(/^agt_/);
    expect(parsed.sid).toMatch(/^entry_pdd_/);
  });
});

describe('unixSeconds', () => {
  test('Date → Unix 秒字符串', () => {
    const d = new Date('2026-05-18T10:00:00Z');
    expect(unixSeconds(d)).toBe(String(Math.floor(d.getTime() / 1000)));
  });

  test('返回值是字符串(可直接进 signed params)', () => {
    const result = unixSeconds(new Date());
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d+$/);
  });

  test('秒级精度(无毫秒部分)', () => {
    const d = new Date('2026-05-18T10:00:00.456Z');
    expect(unixSeconds(d)).not.toContain('.');
    expect(unixSeconds(d)).not.toContain('456');
  });
});
