import { describe, expect, test } from 'bun:test';
import type { JdOrderRow } from '../src/jd/types';
import { mapOrderToLedgerEntry } from '../src/mapper/order-to-ledger';

function makeOrder(overrides: Partial<JdOrderRow> = {}): JdOrderRow {
  return {
    id: 200001112223334441,
    parentId: 200001112223334440,
    skuId: 100012345678,
    skuName: 'SONY WH-1000XM5',
    skuNum: 1,
    estimateCosPrice: 2499.0,
    estimateFee: 74.97,
    actualCosPrice: null,
    actualFee: null,
    commissionRate: 3.0,
    orderTime: 1715769600000,
    finishTime: null,
    modifyTime: 1715769600000,
    validCode: 15,
    positionId: 900000001,
    unionId: 1234567890,
    subUnionId: 'agt_demo',
    ext1: 'entry_jdunion_100012345678',
    ...overrides,
  };
}

describe('mapOrderToLedgerEntry', () => {
  test('validCode 15 → paid', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ validCode: 15 }));
    expect(e.orderStatus).toBe('paid');
    expect(e.rawValidCode).toBe(15);
  });

  test('validCode 16 → settled', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ validCode: 16 }));
    expect(e.orderStatus).toBe('settled');
  });

  test('validCode 17 → invalid', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ validCode: 17 }));
    expect(e.orderStatus).toBe('invalid');
  });

  test('未知 validCode → unknown,但 rawValidCode 保留', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ validCode: 99 }));
    expect(e.orderStatus).toBe('unknown');
    expect(e.rawValidCode).toBe(99);
  });

  test('yuanToFen: 2499.00 → 249900', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ estimateCosPrice: 2499.0 }));
    expect(e.payAmount).toBe(249900);
    expect(typeof e.payAmount).toBe('number');
  });

  test('yuanToFen 处理浮点尾差: 0.1+0.2', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ estimateCosPrice: 0.1 + 0.2 }));
    expect(e.payAmount).toBe(30);
  });

  test('未结算时 realCommission=null', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ actualFee: null, validCode: 15 }));
    expect(e.realCommission).toBeNull();
  });

  test('已结算时 realCommission 是分', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ actualFee: 27.04, validCode: 16 }),
    );
    expect(e.realCommission).toBe(2704);
  });

  test('commissionRate ×100 → commissionRateBp', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ commissionRate: 3.5 }));
    expect(e.commissionRateBp).toBe(350);
  });

  test('unix 毫秒 → Date 对象', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ orderTime: 1715769600000, finishTime: 1715942400000 }),
    );
    expect(e.payTime).toBeInstanceOf(Date);
    expect(e.earningTime).toBeInstanceOf(Date);
    expect(e.payTime!.getTime()).toBe(1715769600000);
  });

  test('finishTime 缺失时 fallback 到 payMonth', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ finishTime: null, payMonth: 1717200000000 }),
    );
    expect(e.earningTime!.getTime()).toBe(1717200000000);
  });

  test('subUnionId 写入 agentSubUnionId,ext1 写入 externalId', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ subUnionId: 'agt_abc', ext1: 'entry_jdunion_xyz' }),
    );
    expect(e.agentSubUnionId).toBe('agt_abc');
    expect(e.externalId).toBe('entry_jdunion_xyz');
  });

  test('tradeId 优先用 id;id 缺失时用 sku+orderTime 合成', () => {
    const withId = mapOrderToLedgerEntry(makeOrder({ id: 12345 }));
    expect(withId.tradeId).toBe('12345');

    const withoutId = mapOrderToLedgerEntry(
      makeOrder({ id: undefined, skuId: 999, orderTime: 1715769600000 }),
    );
    expect(withoutId.tradeId).toBe('999_1715769600000');
  });
});
