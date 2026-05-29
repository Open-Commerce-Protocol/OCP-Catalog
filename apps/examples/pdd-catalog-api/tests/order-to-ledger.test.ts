import { describe, expect, test } from 'bun:test';
import type { PddOrderItem } from '../src/pdd/types';
import { mapOrderToLedgerEntry } from '../src/mapper/order-to-ledger';

function makeOrder(overrides: Partial<PddOrderItem> = {}): PddOrderItem {
  return {
    order_sn: '240518110000200001112223334441',
    goods_id: 250012345678,
    goods_name: '索尼 WH-1000XM5',
    goods_quantity: 1,
    order_amount: 249900,
    promotion_amount: 12495,
    service_amount: 1249,
    share_amount: 11246,
    goods_price: 249900,
    promotion_rate: 50,
    order_status: 0,
    order_status_desc: '已下单',
    order_create_time: 1715769600,
    order_pay_time: 1715769660,
    order_modify_at: 1715769660,
    p_id: '26829999_278234567',
    custom_parameters: '{"uid":"agt_demo","sid":"entry_pdd_250012345678"}',
    type: 2,
    ...overrides,
  };
}

describe('mapOrderToLedgerEntry — 状态映射', () => {
  test('order_status 0/1/2/3 全部 → paid (订单流转中)', () => {
    for (const code of [0, 1, 2, 3]) {
      const e = mapOrderToLedgerEntry(makeOrder({ order_status: code }));
      expect(e.orderStatus).toBe('paid');
      expect(e.rawOrderStatus).toBe(code);
    }
  });

  test('order_status 4 (审核成功) → settled', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_status: 4 }));
    expect(e.orderStatus).toBe('settled');
  });

  test('order_status 8 (已结算) → settled', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_status: 8 }));
    expect(e.orderStatus).toBe('settled');
  });

  test('order_status 5 (审核失败) → invalid', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_status: 5 }));
    expect(e.orderStatus).toBe('invalid');
  });

  test('order_status 10 (已处罚) → invalid', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_status: 10 }));
    expect(e.orderStatus).toBe('invalid');
  });

  test('未知 order_status → unknown,但 rawOrderStatus 保留', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_status: 99 }));
    expect(e.orderStatus).toBe('unknown');
    expect(e.rawOrderStatus).toBe(99);
  });
});

describe('mapOrderToLedgerEntry — 金额与佣金', () => {
  test('amount 字段直接用分,不需再 ×100', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ order_amount: 249900 }));
    expect(e.payAmount).toBe(249900);
    expect(typeof e.payAmount).toBe('number');
  });

  test('estimatedCommission = promotion_amount (毛佣金,分)', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ promotion_amount: 12495 }));
    expect(e.estimatedCommission).toBe(12495);
  });

  test('未结算时 realCommission = null (即使 share_amount 已有值)', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ order_status: 0, share_amount: 11246 }),
    );
    expect(e.realCommission).toBeNull();
  });

  test('已结算 (status=4/8) 时 realCommission = share_amount', () => {
    const settled4 = mapOrderToLedgerEntry(
      makeOrder({ order_status: 4, share_amount: 11246 }),
    );
    expect(settled4.realCommission).toBe(11246);

    const settled8 = mapOrderToLedgerEntry(
      makeOrder({ order_status: 8, share_amount: 22000 }),
    );
    expect(settled8.realCommission).toBe(22000);
  });

  test('serviceFee 字段透传', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ service_amount: 1249 }));
    expect(e.serviceFee).toBe(1249);
  });

  test('commissionRateBp = promotion_rate × 10 (50 千分位 → 500 bp)', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ promotion_rate: 50 }));
    expect(e.commissionRateBp).toBe(500);
  });

  test('promotion_rate 缺失 → commissionRateBp = null', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ promotion_rate: undefined }));
    expect(e.commissionRateBp).toBeNull();
  });
});

describe('mapOrderToLedgerEntry — 时间', () => {
  test('Unix 秒 → Date 对象 (× 1000)', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ order_pay_time: 1715769660, order_settle_time: 1716200000 }),
    );
    expect(e.payTime).toBeInstanceOf(Date);
    expect(e.payTime!.getTime()).toBe(1715769660 * 1000);
  });

  test('order_pay_time 缺失时 fallback 到 order_create_time', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ order_pay_time: undefined, order_create_time: 1715769600 }),
    );
    expect(e.payTime!.getTime()).toBe(1715769600 * 1000);
  });

  test('earningTime: order_settle_time 优先,缺失 fallback 到 order_verify_time', () => {
    const a = mapOrderToLedgerEntry(
      makeOrder({ order_settle_time: 1716200000, order_verify_time: 1715942800 }),
    );
    expect(a.earningTime!.getTime()).toBe(1716200000 * 1000);

    const b = mapOrderToLedgerEntry(
      makeOrder({ order_settle_time: undefined, order_verify_time: 1715942800 }),
    );
    expect(b.earningTime!.getTime()).toBe(1715942800 * 1000);
  });
});

describe('mapOrderToLedgerEntry — custom_parameters 解析', () => {
  test('正常 JSON 字符串 → uid/sid 解析到对应字段', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({
        custom_parameters: '{"uid":"agt_alice","sid":"entry_pdd_xyz"}',
      }),
    );
    expect(e.agentExternalId).toBe('agt_alice');
    expect(e.externalId).toBe('entry_pdd_xyz');
    expect(e.rawCustomParameters).toBe('{"uid":"agt_alice","sid":"entry_pdd_xyz"}');
  });

  test('只有 uid 没有 sid → externalId=null', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ custom_parameters: '{"uid":"agt_alice"}' }),
    );
    expect(e.agentExternalId).toBe('agt_alice');
    expect(e.externalId).toBeNull();
  });

  test('非法 JSON → 不抛错,uid/sid 都为 null,但 raw 保留', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ custom_parameters: '{"uid":' }),  // 不完整 JSON
    );
    expect(e.agentExternalId).toBeNull();
    expect(e.externalId).toBeNull();
    expect(e.rawCustomParameters).toBe('{"uid":');
  });

  test('custom_parameters 整个缺失 → 字段全 null', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ custom_parameters: undefined }),
    );
    expect(e.agentExternalId).toBeNull();
    expect(e.externalId).toBeNull();
    expect(e.rawCustomParameters).toBeNull();
  });

  test('JSON 是非对象 (数组 / 数字) → 解析返 {} 不抛', () => {
    const arr = mapOrderToLedgerEntry(
      makeOrder({ custom_parameters: '[1,2,3]' }),
    );
    expect(arr.agentExternalId).toBeNull();
    expect(arr.externalId).toBeNull();
  });
});

describe('mapOrderToLedgerEntry — 其他字段透传', () => {
  test('tradeId 直接用 order_sn (PDD order_sn 已经是字符串)', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ order_sn: '240518110000abcdef' }),
    );
    expect(e.tradeId).toBe('240518110000abcdef');
  });

  test('pddPid 透传', () => {
    const e = mapOrderToLedgerEntry(makeOrder({ p_id: '26829999_278234567' }));
    expect(e.pddPid).toBe('26829999_278234567');
  });

  test('orderType 透传', () => {
    const a = mapOrderToLedgerEntry(makeOrder({ type: 1 }));
    expect(a.orderType).toBe(1);
    const b = mapOrderToLedgerEntry(makeOrder({ type: 2 }));
    expect(b.orderType).toBe(2);
  });

  test('orderStatusDesc 透传(PDD 原样字段)', () => {
    const e = mapOrderToLedgerEntry(
      makeOrder({ order_status_desc: '审核成功' }),
    );
    expect(e.orderStatusDesc).toBe('审核成功');
  });
});
