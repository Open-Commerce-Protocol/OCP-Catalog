import { describe, expect, test } from 'bun:test';
import { JdUnionClient } from '../src/jd/client';
import type { JdUnionConfig } from '../src/config';
import { CommissionLedger } from '../src/services/commission-ledger';
import { syncOrdersOnce } from '../src/workers/order-poller';

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

describe('syncOrdersOnce (mock)', () => {
  test('首次拉取: 全部插入', async () => {
    const ledger = new CommissionLedger();
    const r = await syncOrdersOnce({
      jd: new JdUnionClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    expect(r.fetched).toBeGreaterThanOrEqual(3);
    expect(r.inserted).toBeGreaterThan(0);
    expect(r.inserted).toBeLessThanOrEqual(r.fetched);
    expect(r.updated).toBe(r.fetched - r.inserted);
    expect(ledger.size()).toBe(r.inserted);
  });

  test('重复拉取: 全部 updated 不再 inserted (幂等)', async () => {
    const ledger = new CommissionLedger();
    const jd = new JdUnionClient(mockCfg);
    await syncOrdersOnce({ jd, ledger, cfg: mockCfg });
    const r2 = await syncOrdersOnce({ jd, ledger, cfg: mockCfg });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBeGreaterThan(0);
  });

  test('订单写入 ledger 后,聚合统计 by_status 正确', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      jd: new JdUnionClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const stats = ledger.stats();
    // fixture 里 validCode 15/16/17 各一条以上,期望至少有 paid 与 settled
    expect(stats.by_status.paid + stats.by_status.settled).toBeGreaterThan(0);
    expect(stats.total_pay_amount_fen).toBeGreaterThan(0);
  });

  test('订单 ext1 字段写入 externalId 字段', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      jd: new JdUnionClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const sample = ledger.list({ limit: 1 })[0]!;
    expect(sample.externalId).toMatch(/^entry_jdunion_/);
  });

  test('subUnionId 写入 agentSubUnionId 字段,可被 by_agent 聚合', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      jd: new JdUnionClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const stats = ledger.stats();
    expect(Object.keys(stats.by_agent).length).toBeGreaterThan(0);
    // fixture 里包含 agt_demo 和 agt_other 两个 Agent
    expect(stats.by_agent['agt_demo']).toBeDefined();
  });

  test('lookbackHours 选项被传递', async () => {
    // 仅校验函数签名接受 opts,mock 路径不会使用该参数
    const r = await syncOrdersOnce(
      { jd: new JdUnionClient(mockCfg), ledger: new CommissionLedger(), cfg: mockCfg },
      { lookbackHours: 168 },
    );
    expect(r.fetched).toBeGreaterThan(0);
  });
});
