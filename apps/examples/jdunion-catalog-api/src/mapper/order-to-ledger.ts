/**
 * Mapper: JD 行级订单 → 内部 CommissionLedgerEntry。
 *
 * 与 alimama order-to-ledger 同位,差异点:
 *   - JD 金额字段是 number 元 (不是字符串)        → yuanToFen 直接 *100 round
 *   - JD 时间字段是 unix 毫秒 (不是 'YYYY-MM-DD HH:mm:ss') → 直接 new Date(ms)
 *   - JD 状态码字段叫 validCode (不是 tk_status)  → 新映射表
 *   - JD 透传字段叫 ext1 (我们 resolve 时写入 OCP entry_id)
 *   - JD 增加 agentSubUnionId 字段记录 per-Agent 归因 (alimama 用 adzone_id 兼任)
 */
import type { JdOrderRow } from '../jd/types';

export type LedgerOrderStatus = 'paid' | 'settled' | 'invalid' | 'under_dispute' | 'unknown';

export interface CommissionLedgerEntry {
  /** JD 订单行 ID(去重主键,JD 单订单一商品一条) */
  tradeId: string;
  /** JD 父订单号 */
  parentTradeId: string | null;
  /** 推广位 ID (jdPositionId,等价于 alimama adzoneId) */
  jdPositionId: number | null;
  /** 联盟 ID */
  jdUnionId: number | null;
  /** SKU */
  skuId: number;
  /** 商品名 */
  skuName: string | null;
  /** 数量 */
  skuNum: number | null;
  /** 用户付款金额(分) */
  payAmount: number;
  /** 预估佣金(分) */
  estimatedCommission: number;
  /** 实际佣金(分,只在 status=settled 时有) */
  realCommission: number | null;
  /** 佣金率 (基点,对齐 alimama) */
  commissionRateBp: number | null;
  /** 状态 */
  orderStatus: LedgerOrderStatus;
  /** 原始 validCode (备查) */
  rawValidCode: number;
  /** 用户下单时间 */
  payTime: Date | null;
  /** 订单完成 / 结算时间 */
  earningTime: Date | null;
  /** 透传给 JD 的 ext1 字段 (我们写入 OCP entry_id) */
  externalId: string | null;
  /** 透传给 JD 的 subUnionId (per-Agent 归因 key) */
  agentSubUnionId: string | null;
  /** 原始 payload (备查) */
  raw: JdOrderRow;
  /** 最后更新时间 (本地) */
  updatedAt: Date;
}

/**
 * validCode 映射 (主流取值):
 *   15 = 有效(订单已下单,佣金预估)
 *   16 = 完成(已结算,佣金到账)
 *   17 = 无效(退款 / 取消 / 违规)
 *   其他值落入 'unknown',rawValidCode 仍保留以便后续扩展
 */
const VALID_CODE_MAP: Record<number, LedgerOrderStatus> = {
  15: 'paid',
  16: 'settled',
  17: 'invalid',
};

/** number 元 → 分(integer);非法值返 0 */
function yuanToFen(v: number | null | undefined): number {
  if (v === undefined || v === null || !Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

/** unix 毫秒 → Date;非法值返 null */
function msToDate(ms: number | null | undefined): Date | null {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapOrderToLedgerEntry(order: JdOrderRow): CommissionLedgerEntry {
  return {
    tradeId: String(order.id ?? `${order.skuId}_${order.orderTime ?? 0}`),
    parentTradeId: order.parentId !== undefined ? String(order.parentId) : null,
    jdPositionId: order.positionId ?? null,
    jdUnionId: order.unionId ?? null,
    skuId: order.skuId,
    skuName: order.skuName ?? null,
    skuNum: order.skuNum ?? null,
    payAmount: yuanToFen(order.estimateCosPrice),
    estimatedCommission: yuanToFen(order.estimateFee),
    realCommission:
      order.actualFee !== undefined && order.actualFee !== null
        ? yuanToFen(order.actualFee)
        : null,
    commissionRateBp:
      order.commissionRate !== undefined && order.commissionRate !== null
        ? Math.round(order.commissionRate * 100)
        : null,
    orderStatus: VALID_CODE_MAP[order.validCode] ?? 'unknown',
    rawValidCode: order.validCode,
    payTime: msToDate(order.orderTime),
    earningTime: msToDate(order.finishTime) ?? msToDate(order.payMonth),
    externalId: order.ext1 ?? null,
    agentSubUnionId: order.subUnionId ?? null,
    raw: order,
    updatedAt: new Date(),
  };
}
