import { describe, expect, test } from 'bun:test';
import { PddClient } from '../src/pdd/client';
import type { PddConfig } from '../src/config';
import { CommissionLedger } from '../src/services/commission-ledger';
import { syncOrdersOnce } from '../src/workers/order-poller';

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

describe('syncOrdersOnce (PDD mock)', () => {
  test('首次拉取: 全部插入', async () => {
    const ledger = new CommissionLedger();
    const r = await syncOrdersOnce({
      pdd: new PddClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    expect(r.fetched).toBeGreaterThanOrEqual(3);
    expect(r.inserted).toBe(r.fetched);
    expect(r.updated).toBe(0);
    expect(ledger.size()).toBe(r.fetched);
  });

  test('重复拉取: 全部 updated 不再 inserted (幂等)', async () => {
    const ledger = new CommissionLedger();
    const pdd = new PddClient(mockCfg);
    await syncOrdersOnce({ pdd, ledger, cfg: mockCfg });
    const r2 = await syncOrdersOnce({ pdd, ledger, cfg: mockCfg });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBeGreaterThan(0);
  });

  test('订单写入 ledger 后,聚合统计 by_status 正确 (PDD 8 档→ 3 档)', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      pdd: new PddClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const stats = ledger.stats();
    // fixture 里 order_status 0/4/5/8 各一条 → paid=1, settled=2, invalid=1
    expect(stats.by_status.paid).toBe(1);
    expect(stats.by_status.settled).toBe(2);
    expect(stats.by_status.invalid).toBe(1);
    expect(stats.total_pay_amount_fen).toBeGreaterThan(0);
  });

  test('custom_parameters.sid 写入 externalId 字段', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      pdd: new PddClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const entries = ledger.list();
    for (const e of entries) {
      expect(e.externalId).toMatch(/^entry_pdd_/);
    }
  });

  test('custom_parameters.uid 写入 agentExternalId 字段,可被 by_agent 聚合', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      pdd: new PddClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const stats = ledger.stats();
    expect(Object.keys(stats.by_agent).length).toBeGreaterThan(0);
    // fixture 里包含 agt_demo (3 单) 和 agt_other (1 单)
    expect(stats.by_agent['agt_demo']).toBeDefined();
    expect(stats.by_agent['agt_demo']!.orders).toBe(3);
    expect(stats.by_agent['agt_other']!.orders).toBe(1);
  });

  test('by_position 聚合用 PDD pid 字符串', async () => {
    const ledger = new CommissionLedger();
    await syncOrdersOnce({
      pdd: new PddClient(mockCfg),
      ledger,
      cfg: mockCfg,
    });
    const stats = ledger.stats();
    // fixture 里所有订单 p_id 都是 '26829999_278234567'
    expect(stats.by_position['26829999_278234567']!.orders).toBe(4);
  });

  test('lookbackHours 选项被传递 (mock 模式下不影响结果)', async () => {
    const r = await syncOrdersOnce(
      { pdd: new PddClient(mockCfg), ledger: new CommissionLedger(), cfg: mockCfg },
      { lookbackHours: 168 },
    );
    expect(r.fetched).toBeGreaterThan(0);
  });
});
