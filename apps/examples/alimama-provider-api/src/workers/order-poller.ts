/**
 * Order Poller: 定时拉 alimama 订单 → 写入 commission_ledger。
 *
 * 默认行为:每次拉过去 24 小时的订单（涵盖延迟下单)。
 * 真接 Alimama 后建议改成"拉过去 7 天",因为订单状态 4 个月内还可能变化(维权扣回)。
 *
 * 间隔由 ORDER_POLL_INTERVAL_SEC 控制,0 表示不启用。
 */
import type { AlimamaClient } from '../alimama/client';
import { AlimamaApiError } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { mapOrderToLedgerEntry } from '../mapper/order-to-ledger';
import type { CommissionLedger } from '../services/commission-ledger';

export interface OrderPollerDeps {
  alimama: AlimamaClient;
  ledger: CommissionLedger;
  cfg: AlimamaConfig;
}

function fmtAlimamaTime(d: Date): string {
  // alimama 要求格式 "YYYY-MM-DD HH:mm:ss"（北京时间）
  const tzOffset = 8 * 60 * 60 * 1000;
  const beijing = new Date(d.getTime() + tzOffset);
  return beijing.toISOString().replace('T', ' ').slice(0, 19);
}

export async function syncOrdersOnce(
  deps: OrderPollerDeps,
  opts: { lookbackHours?: number } = {},
): Promise<{ fetched: number; inserted: number; updated: number }> {
  const lookbackHours = opts.lookbackHours ?? 24;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - lookbackHours * 60 * 60 * 1000);

  const res = await deps.alimama.listOrders({
    startTime: fmtAlimamaTime(startTime),
    endTime: fmtAlimamaTime(endTime),
    queryType: 'pay_time',
    pageNo: 1,
    pageSize: 100,
  });

  const orders = res.tbk_order_get_response?.results?.n_tbk_order ?? [];
  if (orders.length === 0) {
    return { fetched: 0, inserted: 0, updated: 0 };
  }

  const entries = orders.map(mapOrderToLedgerEntry);
  const { inserted, updated } = deps.ledger.upsertMany(entries);

  return { fetched: orders.length, inserted, updated };
}

export function startOrderPoller(deps: OrderPollerDeps): { stop: () => void } {
  const intervalSec = deps.cfg.ORDER_POLL_INTERVAL_SEC;
  if (intervalSec <= 0) {
    return { stop: () => {} };
  }

  const tick = async () => {
    try {
      const r = await syncOrdersOnce(deps);
      console.log(
        `[order-poller] fetched ${r.fetched} orders, ${r.inserted} new, ${r.updated} updated, ledger size=${deps.ledger.size()}`,
      );
    } catch (err) {
      if (err instanceof AlimamaApiError) {
        console.warn(`[order-poller] alimama error: subCode=${err.subCode}`);
      } else {
        console.warn(
          `[order-poller] sync failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  const kickoff = setTimeout(tick, 4000); // 比 material poller 晚 1s,避免日志混淆
  const handle = setInterval(tick, intervalSec * 1000);
  console.log(`[order-poller] started, interval=${intervalSec}s`);

  return {
    stop: () => {
      clearTimeout(kickoff);
      clearInterval(handle);
    },
  };
}
