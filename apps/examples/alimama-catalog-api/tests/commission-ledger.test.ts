import { describe, expect, test, beforeEach } from 'bun:test';
import { CommissionLedger } from '../src/services/commission-ledger';
import { mapOrderToLedgerEntry } from '../src/mapper/order-to-ledger';
import fixture from './fixtures/order-get-sample.json';
import type { AlimamaOrder } from '../src/alimama/types';

const orders = fixture.tbk_order_get_response.results.n_tbk_order as AlimamaOrder[];

describe('CommissionLedger', () => {
  let ledger: CommissionLedger;
  beforeEach(() => {
    ledger = new CommissionLedger();
  });

  test('upsertMany 一次插入 4 条, size=4', () => {
    const entries = orders.map(mapOrderToLedgerEntry);
    const r = ledger.upsertMany(entries);
    expect(r.inserted).toBe(4);
    expect(r.updated).toBe(0);
    expect(ledger.size()).toBe(4);
  });

  test('再次 upsert 同一组 → 全部 updated, size 不变', () => {
    const entries = orders.map(mapOrderToLedgerEntry);
    ledger.upsertMany(entries);
    const r = ledger.upsertMany(entries);
    expect(r.inserted).toBe(0);
    expect(r.updated).toBe(4);
    expect(ledger.size()).toBe(4);
  });

  test('stats 按状态聚合正确', () => {
    ledger.upsertMany(orders.map(mapOrderToLedgerEntry));
    const s = ledger.stats();
    expect(s.total_orders).toBe(4);
    expect(s.by_status.settled).toBe(1);
    expect(s.by_status.paid).toBe(1);
    expect(s.by_status.invalid).toBe(1);
    expect(s.by_status.under_dispute).toBe(1);
  });

  test('stats 总金额加和(分)', () => {
    ledger.upsertMany(orders.map(mapOrderToLedgerEntry));
    const s = ledger.stats();
    // 199 + 59 + 249 + 25.80 = 532.80 元 = 53280 分
    expect(s.total_pay_amount_fen).toBe(53280);
    // 估算佣金:27.77 + 4.25 + 56.03 + 1.16 = 89.21 元 = 8921 分
    expect(s.total_estimated_commission_fen).toBe(8921);
    // 实际佣金:只有 settled 那条 27.77 元
    expect(s.total_real_commission_fen).toBe(2777);
  });

  test('stats 按 adzone 聚合(本 fixture 都是同一 adzone)', () => {
    ledger.upsertMany(orders.map(mapOrderToLedgerEntry));
    const s = ledger.stats();
    expect(Object.keys(s.by_adzone)).toEqual(['999999001']);
    expect(s.by_adzone['999999001']!.orders).toBe(4);
  });

  test('list 按 payTime 倒序', () => {
    ledger.upsertMany(orders.map(mapOrderToLedgerEntry));
    const list = ledger.list({ limit: 10 });
    expect(list.length).toBe(4);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!.payTime?.getTime() ?? 0;
      const b = list[i + 1]!.payTime?.getTime() ?? 0;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  test('limit 生效', () => {
    ledger.upsertMany(orders.map(mapOrderToLedgerEntry));
    const list = ledger.list({ limit: 2 });
    expect(list.length).toBe(2);
  });

  test('空 ledger 的 stats 返合理空状态', () => {
    const s = ledger.stats();
    expect(s.total_orders).toBe(0);
    expect(s.total_pay_amount_fen).toBe(0);
    expect(s.last_updated_at).toBeNull();
    expect(s.by_status.settled).toBe(0);
  });
});
