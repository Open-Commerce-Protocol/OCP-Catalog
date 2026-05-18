import { describe, expect, test } from 'bun:test';
import {
  mapOrderToLedgerEntry,
  type CommissionLedgerEntry,
} from '../src/mapper/order-to-ledger';
import type { AlimamaOrder } from '../src/alimama/types';
import fixture from './fixtures/order-get-sample.json';

const orders = fixture.tbk_order_get_response.results.n_tbk_order as AlimamaOrder[];

describe('mapOrderToLedgerEntry', () => {
  test('settled 订单 (tk_status=13) → status=settled, realCommission 有值', () => {
    const settled = orders.find((o) => o.tk_status === 13)!;
    const e = mapOrderToLedgerEntry(settled);
    expect(e.orderStatus).toBe('settled');
    expect(e.realCommission).not.toBeNull();
    expect(e.payAmount).toBe(19900); // 199.00 元 → 19900 分
    expect(e.estimatedCommission).toBe(2777); // 27.77 → 2777
    expect(e.realCommission).toBe(2777);
    expect(e.earningTime).not.toBeNull();
  });

  test('paid 订单 (tk_status=12) → status=paid, 无 realCommission', () => {
    const paid = orders.find((o) => o.tk_status === 12)!;
    const e = mapOrderToLedgerEntry(paid);
    expect(e.orderStatus).toBe('paid');
    expect(e.estimatedCommission).toBe(425); // 4.25 → 425
    expect(e.earningTime).toBeNull(); // 还没结算
  });

  test('invalid 订单 (tk_status=14) → status=invalid', () => {
    const invalid = orders.find((o) => o.tk_status === 14)!;
    const e = mapOrderToLedgerEntry(invalid);
    expect(e.orderStatus).toBe('invalid');
  });

  test('under_dispute 订单 (tk_status=15) → status=under_dispute', () => {
    const dispute = orders.find((o) => o.tk_status === 15)!;
    const e = mapOrderToLedgerEntry(dispute);
    expect(e.orderStatus).toBe('under_dispute');
  });

  test('未知 tk_status → status=unknown 但不 throw', () => {
    const weird: AlimamaOrder = {
      trade_id: '999',
      item_id: 1,
      tk_status: 99,
    };
    const e = mapOrderToLedgerEntry(weird);
    expect(e.orderStatus).toBe('unknown');
    expect(e.rawTkStatus).toBe(99);
  });

  test('价格字符串中带小数/空 → 安全转分', () => {
    expect(mapOrderToLedgerEntry({ trade_id: 1, item_id: 1, tk_status: 12, alipay_total_price: '12.50' }).payAmount).toBe(1250);
    expect(mapOrderToLedgerEntry({ trade_id: 2, item_id: 1, tk_status: 12 }).payAmount).toBe(0);
    expect(mapOrderToLedgerEntry({ trade_id: 3, item_id: 1, tk_status: 12, alipay_total_price: 'abc' }).payAmount).toBe(0);
  });

  test('trade_id 数字 → 字符串(用作 Map key)', () => {
    const o: AlimamaOrder = { trade_id: 123456, item_id: 1, tk_status: 12 };
    const e = mapOrderToLedgerEntry(o);
    expect(e.tradeId).toBe('123456');
    expect(typeof e.tradeId).toBe('string');
  });
});
