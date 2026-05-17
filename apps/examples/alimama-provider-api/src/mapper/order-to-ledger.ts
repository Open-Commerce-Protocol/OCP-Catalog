/**
 * Mapper: 阿里 order.get 单条订单 → 内部 CommissionLedgerEntry。
 *
 * 翻译规则:
 *   - alipay_total_price (字符串"元") → payAmount (分,integer)
 *   - pub_share_pre_fee / pub_share_fee (字符串"元") → estimatedCommission / realCommission (分)
 *   - tk_status (12/13/14/15 数字) → orderStatus 人类可读
 *   - tb_paid_time (string) → payTime (Date)
 */
import type { AlimamaOrder } from '../alimama/types';

export type LedgerOrderStatus = 'paid' | 'settled' | 'invalid' | 'under_dispute' | 'unknown';

export interface CommissionLedgerEntry {
  /** Alimama 订单 ID（去重主键） */
  tradeId: string;
  /** Adzone ID（用于按 agent 归因） */
  alimamaAdzoneId: number | null;
  /** 商品 ID */
  itemId: number;
  /** 商品标题 */
  itemTitle: string | null;
  /** 用户付款金额（分） */
  payAmount: number;
  /** 预估佣金（分） */
  estimatedCommission: number;
  /** 实际到账佣金（分,只在 status=settled 时有） */
  realCommission: number | null;
  /** 状态 */
  orderStatus: LedgerOrderStatus;
  /** 原始 tk_status（备查） */
  rawTkStatus: number;
  /** 用户付款时间 */
  payTime: Date | null;
  /** 佣金到账时间 */
  earningTime: Date | null;
  /** 我们透传给阿里的 external_id（== OCP entry_id） */
  externalId: string | null;
  /** 原始 payload(备查) */
  raw: AlimamaOrder;
  /** 最后更新时间(本地) */
  updatedAt: Date;
}

const TK_STATUS_MAP: Record<number, LedgerOrderStatus> = {
  12: 'paid',
  13: 'settled',
  14: 'invalid',
  15: 'under_dispute',
};

/** 元字符串(如 "199.00") → 分 (integer);异常返 0 */
function yuanToFen(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function parseAlimamaTime(s: string | undefined | null): Date | null {
  if (!s) return null;
  // alimama 格式 "YYYY-MM-DD HH:mm:ss"
  // 当 +08:00 处理,避免被 UTC 解释
  const normalized = s.replace(' ', 'T') + '+08:00';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapOrderToLedgerEntry(order: AlimamaOrder): CommissionLedgerEntry {
  return {
    tradeId: String(order.trade_id),
    alimamaAdzoneId: order.adzone_id ?? null,
    itemId: order.item_id,
    itemTitle: order.item_title ?? null,
    payAmount: yuanToFen(order.alipay_total_price),
    estimatedCommission: yuanToFen(order.pub_share_pre_fee),
    realCommission:
      order.pub_share_fee !== undefined ? yuanToFen(order.pub_share_fee) : null,
    orderStatus: TK_STATUS_MAP[order.tk_status] ?? 'unknown',
    rawTkStatus: order.tk_status,
    payTime: parseAlimamaTime(order.tb_paid_time),
    earningTime: parseAlimamaTime(order.tk_earning_time),
    externalId: null, // 真实 API 里这个字段叫别的名,等接通时确认
    raw: order,
    updatedAt: new Date(),
  };
}
