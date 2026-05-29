import { describe, expect, test, beforeEach } from 'bun:test';
import { CommissionLedger } from '../src/services/commission-ledger';
import type { CommissionLedgerEntry } from '../src/mapper/order-to-ledger';

function makeEntry(overrides: Partial<CommissionLedgerEntry> = {}): CommissionLedgerEntry {
  return {
    tradeId: '240518110000abc',
    pddPid: '26829999_278234567',
    goodsId: 250012345678,
    goodsName: 'SONY WH-1000XM5',
    goodsQuantity: 1,
    payAmount: 249900,
    estimatedCommission: 12495,
    realCommission: null,
    serviceFee: 1249,
    commissionRateBp: 500,
    orderStatus: 'paid',
    rawOrderStatus: 0,
    orderStatusDesc: '已下单',
    payTime: new Date('2026-05-15T10:00:00Z'),
    earningTime: null,
    externalId: 'entry_pdd_250012345678',
    agentExternalId: 'agt_demo',
    rawCustomParameters: '{"uid":"agt_demo","sid":"entry_pdd_250012345678"}',
    orderType: 2,
    raw: {} as any,
    updatedAt: new Date('2026-05-15T11:00:00Z'),
    ...overrides,
  };
}

let ledger: CommissionLedger;

beforeEach(() => {
  ledger = new CommissionLedger();
});

describe('CommissionLedger (PDD)', () => {
  test('upsert + get by tradeId', () => {
    ledger.upsert(makeEntry({ tradeId: 't1' }));
    expect(ledger.size()).toBe(1);
    expect(ledger.get('t1')?.goodsId).toBe(250012345678);
  });

  test('upsertMany 区分 inserted vs updated', () => {
    const r1 = ledger.upsertMany([makeEntry({ tradeId: 't1' }), makeEntry({ tradeId: 't2' })]);
    expect(r1.inserted).toBe(2);
    expect(r1.updated).toBe(0);

    const r2 = ledger.upsertMany([
      makeEntry({ tradeId: 't1', orderStatus: 'settled' }),
      makeEntry({ tradeId: 't3' }),
    ]);
    expect(r2.inserted).toBe(1);
    expect(r2.updated).toBe(1);
    expect(ledger.get('t1')?.orderStatus).toBe('settled');
  });

  test('list 按 payTime 倒序', () => {
    ledger.upsertMany([
      makeEntry({ tradeId: 'old', payTime: new Date('2026-05-01T00:00:00Z') }),
      makeEntry({ tradeId: 'newest', payTime: new Date('2026-05-18T00:00:00Z') }),
      makeEntry({ tradeId: 'mid', payTime: new Date('2026-05-10T00:00:00Z') }),
    ]);
    const list = ledger.list();
    expect(list.map((e) => e.tradeId)).toEqual(['newest', 'mid', 'old']);
  });

  test('list limit 切片', () => {
    ledger.upsertMany([
      makeEntry({ tradeId: 'a', payTime: new Date('2026-05-18T00:00:00Z') }),
      makeEntry({ tradeId: 'b', payTime: new Date('2026-05-17T00:00:00Z') }),
      makeEntry({ tradeId: 'c', payTime: new Date('2026-05-16T00:00:00Z') }),
    ]);
    const list = ledger.list({ limit: 2 });
    expect(list.length).toBe(2);
    expect(list[0]!.tradeId).toBe('a');
  });

  test('stats: by_status 计数与总额', () => {
    ledger.upsertMany([
      makeEntry({ tradeId: '1', orderStatus: 'paid', payAmount: 10000, estimatedCommission: 500 }),
      makeEntry({
        tradeId: '2',
        orderStatus: 'settled',
        payAmount: 20000,
        estimatedCommission: 1000,
        realCommission: 1000,
      }),
      makeEntry({ tradeId: '3', orderStatus: 'invalid', payAmount: 5000, estimatedCommission: 250 }),
    ]);
    const s = ledger.stats();
    expect(s.total_orders).toBe(3);
    expect(s.by_status.paid).toBe(1);
    expect(s.by_status.settled).toBe(1);
    expect(s.by_status.invalid).toBe(1);
    expect(s.total_pay_amount_fen).toBe(35000);
    expect(s.total_estimated_commission_fen).toBe(1750);
    expect(s.total_real_commission_fen).toBe(1000);
  });

  test('stats: by_position 按 PDD pid 字符串聚合', () => {
    ledger.upsertMany([
      makeEntry({
        tradeId: '1',
        pddPid: '26829999_278234567',
        estimatedCommission: 500,
        realCommission: null,
      }),
      makeEntry({
        tradeId: '2',
        pddPid: '26829999_278234567',
        estimatedCommission: 700,
        realCommission: 700,
      }),
      makeEntry({
        tradeId: '3',
        pddPid: '26829999_999999999',
        estimatedCommission: 100,
        realCommission: null,
      }),
    ]);
    const s = ledger.stats();
    expect(s.by_position['26829999_278234567']!.orders).toBe(2);
    expect(s.by_position['26829999_278234567']!.estimated_commission_fen).toBe(1200);
    expect(s.by_position['26829999_278234567']!.real_commission_fen).toBe(700);
    expect(s.by_position['26829999_999999999']!.orders).toBe(1);
  });

  test('stats: by_agent 按 agentExternalId 聚合 (custom_parameters.uid)', () => {
    ledger.upsertMany([
      makeEntry({ tradeId: '1', agentExternalId: 'agt_alice', estimatedCommission: 500 }),
      makeEntry({ tradeId: '2', agentExternalId: 'agt_alice', estimatedCommission: 300 }),
      makeEntry({ tradeId: '3', agentExternalId: 'agt_bob', estimatedCommission: 1000 }),
      makeEntry({ tradeId: '4', agentExternalId: null, estimatedCommission: 50 }),
    ]);
    const s = ledger.stats();
    expect(s.by_agent['agt_alice']!.orders).toBe(2);
    expect(s.by_agent['agt_alice']!.estimated_commission_fen).toBe(800);
    expect(s.by_agent['agt_bob']!.orders).toBe(1);
    expect(s.by_agent['(unknown)']!.orders).toBe(1);
  });

  test('stats: pddPid=null 的订单归到 (unknown) by_position', () => {
    ledger.upsertMany([
      makeEntry({ tradeId: '1', pddPid: '26829999_278234567' }),
      makeEntry({ tradeId: '2', pddPid: null }),
    ]);
    const s = ledger.stats();
    expect(s.by_position['(unknown)']!.orders).toBe(1);
    expect(s.by_position['26829999_278234567']!.orders).toBe(1);
  });

  test('stats: 空 ledger', () => {
    const s = ledger.stats();
    expect(s.total_orders).toBe(0);
    expect(s.by_status.paid).toBe(0);
    expect(s.last_updated_at).toBeNull();
    expect(s.by_position).toEqual({});
    expect(s.by_agent).toEqual({});
  });

  test('stats: last_updated_at 取 max(updatedAt)', () => {
    const t1 = new Date('2026-05-15T10:00:00Z');
    const t2 = new Date('2026-05-18T12:00:00Z');
    ledger.upsertMany([
      makeEntry({ tradeId: '1', updatedAt: t1 }),
      makeEntry({ tradeId: '2', updatedAt: t2 }),
    ]);
    expect(ledger.stats().last_updated_at).toBe(t2.toISOString());
  });

  test('clear', () => {
    ledger.upsertMany([makeEntry({ tradeId: '1' }), makeEntry({ tradeId: '2' })]);
    ledger.clear();
    expect(ledger.size()).toBe(0);
  });
});
