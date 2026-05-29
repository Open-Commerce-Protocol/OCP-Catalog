import { describe, expect, test } from 'bun:test';
import { JdUnionClient, formatBeijingTimestamp } from '../src/jd/client';
import type { JdUnionConfig } from '../src/config';

const mockCfg: JdUnionConfig = {
  JDUNION_CATALOG_ID: 'cat_jdunion_test',
  JDUNION_CATALOG_NAME: 'JD Union Test',
  JDUNION_CATALOG_PUBLIC_BASE_URL: 'http://localhost:4320',
  JDUNION_CATALOG_ADMIN_KEY: 'dev-admin-key',
  JDUNION_CATALOG_PORT: 4320,
  JDUNION_MOCK: true,
  JDUNION_POSITION_ID: 'mock_position_001',
  JDUNION_BASE_URL: 'https://router.jd.com/api',
  JDUNION_QUERY_TIMEOUT_MS: 5000,
  JDUNION_DEFAULT_PAGE_SIZE: 20,
  JDUNION_ORDER_POLL_INTERVAL_SEC: 0,
  JDUNION_RESOLVE_STRATEGY: 'goods_promotion',
};

describe('JdUnionClient (mock mode)', () => {
  test('listGoods 返回 fixture 商品并按 pageSize 切片', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.listGoods({ pageIndex: 1, pageSize: 3 });
    expect(res.code).toBe(200);
    expect(res.data).toBeDefined();
    expect(res.data!.length).toBe(3);
    expect(res.totalCount).toBe(5);
    expect(res.hasMore).toBe(true);
    expect(res.data![0]!.skuId).toBe(100012345678);
    expect(res.data![0]!.priceInfo?.lowestPrice).toBe(2499);
  });

  test('listGoods pageSize >= fixture 总数时 hasMore=false', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.listGoods({ pageIndex: 1, pageSize: 50 });
    expect(res.data!.length).toBe(5);
    expect(res.hasMore).toBe(false);
  });

  test('getPromotionGoodsInfo 按 skuId 匹配单品', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.getPromotionGoodsInfo({ skuIds: [100023456789] });
    expect(res.code).toBe(200);
    expect(res.result?.length).toBe(1);
    expect(res.result![0]!.skuId).toBe(100023456789);
    expect(res.result![0]!.shortURL).toContain('u.jd.com');
  });

  test('getPromotionGoodsInfo 命中 0 条时兜底返第一条', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.getPromotionGoodsInfo({ skuIds: [999999999999] });
    expect(res.result?.length).toBe(1);
    // 不要求是哪一条,只要兜底有返回
    expect(res.result![0]!.skuId).toBeGreaterThan(0);
  });

  test('getPromotionGoodsInfo 支持批量(多个 sku)', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.getPromotionGoodsInfo({
      skuIds: [100012345678, 100045678901],
    });
    expect(res.result?.length).toBe(2);
    const ids = res.result!.map((r) => r.skuId).sort();
    expect(ids).toEqual([100012345678, 100045678901]);
  });

  test('getPromotionCommonLink 返回 u.jd.com 短链(mock 端 hash 稳定)', async () => {
    const client = new JdUnionClient(mockCfg);
    const a = await client.getPromotionCommonLink({
      materialId: 'https://item.jd.com/100012345678.html',
    });
    const b = await client.getPromotionCommonLink({
      materialId: 'https://item.jd.com/100012345678.html',
    });
    expect(a.shortURL).toContain('u.jd.com/mock_');
    expect(a.shortURL).toEqual(b.shortURL);
  });

  test('getPromotionCommonLink 不同 materialId 产生不同短链', async () => {
    const client = new JdUnionClient(mockCfg);
    const a = await client.getPromotionCommonLink({ materialId: 'a' });
    const b = await client.getPromotionCommonLink({ materialId: 'b' });
    expect(a.shortURL).not.toEqual(b.shortURL);
  });

  test('listOrderRows 返回 fixture 订单含混合状态', async () => {
    const client = new JdUnionClient(mockCfg);
    const res = await client.listOrderRows({
      type: 1,
      startTime: '2026-05-01 00:00:00',
      endTime: '2026-05-31 23:59:59',
      pageNo: 1,
      pageSize: 50,
    });
    expect(res.code).toBe(200);
    expect(res.data?.length).toBeGreaterThanOrEqual(3);
    const codes = new Set(res.data!.map((o) => o.validCode));
    expect(codes.has(15)).toBe(true);
    expect(codes.has(16)).toBe(true);
    expect(codes.has(17)).toBe(true);
  });
});

describe('formatBeijingTimestamp', () => {
  test('UTC 时间 → 北京时间 (+8h) 格式 YYYY-MM-DD HH:mm:ss', () => {
    const utc = new Date('2026-05-18T02:00:00Z');
    expect(formatBeijingTimestamp(utc)).toBe('2026-05-18 10:00:00');
  });

  test('跨日界:北京时间凌晨', () => {
    const utc = new Date('2026-05-18T16:30:45Z');
    expect(formatBeijingTimestamp(utc)).toBe('2026-05-19 00:30:45');
  });
});
