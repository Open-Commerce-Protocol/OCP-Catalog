/**
 * Mapper: PDD 行级订单 → 内部 CommissionLedgerEntry。
 *
 * 与 alimama / JD order-to-ledger 同位,差异点:
 *   - PDD 金额是 **整数分** (不需要 yuanToFen,直接当 fen 用)
 *   - PDD 时间是 **Unix 秒** (×1000 转 Date)
 *   - PDD order_status 有 **8 档** (alimama / JD 都是 3-4 档),需要合并映射
 *   - PDD 透传字段叫 custom_parameters,**是一个 JSON 字符串**
 *     需 JSON.parse 出 {uid, sid},分别填 agentExternalId 和 externalId
 *   - PDD 没有 commissionRate 字段直接给基点,需要从 promotion_rate (千分位) ×10 换算
 *   - PDD 有 share_amount (扣除平台服务费后的实际到手),作为 realCommission 更准确
 */
import type { PddOrderItem } from '../pdd/types';

export type LedgerOrderStatus = 'paid' | 'settled' | 'invalid' | 'under_dispute' | 'unknown';

export interface CommissionLedgerEntry {
  /** PDD 订单号 (order_sn,去重主键,通常含日期前缀的字符串) */
  tradeId: string;
  /** 推广位 PID,形如 "26829999_278234567" */
  pddPid: string | null;
  /** 商品 ID */
  goodsId: number;
  /** 商品名 */
  goodsName: string | null;
  /** 数量 */
  goodsQuantity: number | null;
  /** 用户付款金额(分) */
  payAmount: number;
  /** 预估佣金 (promotion_amount,分,毛佣金) */
  estimatedCommission: number;
  /** 实际佣金 (share_amount,分,扣完 PDD 服务费后的到手佣金;未结算时为 null) */
  realCommission: number | null;
  /** PDD 平台服务费(分) */
  serviceFee: number | null;
  /** 佣金率 (基点,promotion_rate ×10) */
  commissionRateBp: number | null;
  /** 状态 */
  orderStatus: LedgerOrderStatus;
  /** 原始 order_status (备查,PDD 8 档完整保留) */
  rawOrderStatus: number;
  /** 状态描述(PDD 原样字段) */
  orderStatusDesc: string | null;
  /** 下单时间 */
  payTime: Date | null;
  /** 结算时间 (优先 settle,缺失 fallback 到 verify) */
  earningTime: Date | null;
  /** 解析自 custom_parameters.sid (== OCP entry_id) */
  externalId: string | null;
  /** 解析自 custom_parameters.uid (per-Agent 归因) */
  agentExternalId: string | null;
  /** 原始 custom_parameters 字符串 (备查;解析失败时 externalId/agentExternalId 仍为 null) */
  rawCustomParameters: string | null;
  /** 订单类型: 1=领券订单 2=直接购买 */
  orderType: number | null;
  /** 原始 payload */
  raw: PddOrderItem;
  /** 最后更新时间 (本地) */
  updatedAt: Date;
}

/**
 * order_status 8 档 → 5 档 LedgerOrderStatus 合并:
 *   0 已下单, 1 已支付, 2 已成团, 3 已收货 → 'paid'   (订单流转中,佣金预估)
 *   4 审核成功, 8 已结算                   → 'settled' (佣金到账)
 *   5 审核失败, 10 已处罚                   → 'invalid' (佣金不计)
 *   其他                                    → 'unknown'
 */
const ORDER_STATUS_MAP: Record<number, LedgerOrderStatus> = {
  0: 'paid',
  1: 'paid',
  2: 'paid',
  3: 'paid',
  4: 'settled',
  8: 'settled',
  5: 'invalid',
  10: 'invalid',
};

/** Unix 秒 → Date;非法值返 null */
function secToDate(sec: number | null | undefined): Date | null {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 安全 parse custom_parameters JSON 字符串。
 * 解析失败时不抛,返 {} (externalId/agentExternalId 会落 null)。
 */
function parseCustomParameters(s: string | undefined | null): {
  uid?: string;
  sid?: string;
} {
  if (!s || typeof s !== 'string') return {};
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      return {
        uid: typeof parsed.uid === 'string' ? parsed.uid : undefined,
        sid: typeof parsed.sid === 'string' ? parsed.sid : undefined,
      };
    }
  } catch {
    // 静默吞,custom_parameters 偶发非法 JSON 不阻塞 ledger
  }
  return {};
}

export function mapOrderToLedgerEntry(order: PddOrderItem): CommissionLedgerEntry {
  const cp = parseCustomParameters(order.custom_parameters);

  // 已结算状态才把 share_amount 当 realCommission;未结算时为 null
  const status = ORDER_STATUS_MAP[order.order_status] ?? 'unknown';
  const realCommission =
    status === 'settled' && order.share_amount !== undefined && order.share_amount !== null
      ? order.share_amount
      : null;

  return {
    tradeId: order.order_sn,
    pddPid: order.p_id ?? null,
    goodsId: order.goods_id,
    goodsName: order.goods_name ?? null,
    goodsQuantity: order.goods_quantity ?? null,
    payAmount: order.order_amount ?? 0,
    estimatedCommission: order.promotion_amount ?? 0,
    realCommission,
    serviceFee: order.service_amount ?? null,
    commissionRateBp:
      order.promotion_rate !== undefined && order.promotion_rate !== null
        ? Math.round(order.promotion_rate * 10)
        : null,
    orderStatus: status,
    rawOrderStatus: order.order_status,
    orderStatusDesc: order.order_status_desc ?? null,
    payTime: secToDate(order.order_pay_time) ?? secToDate(order.order_create_time),
    earningTime:
      secToDate(order.order_settle_time) ?? secToDate(order.order_verify_time),
    externalId: cp.sid ?? null,
    agentExternalId: cp.uid ?? null,
    rawCustomParameters: order.custom_parameters ?? null,
    orderType: order.type ?? null,
    raw: order,
    updatedAt: new Date(),
  };
}
