/**
 * Order Poller: 定时拉 JD 订单 → 写入 commission_ledger。
 *
 * 默认行为:每次拉过去 24 小时的订单 (按更新时间 type=3)。
 * 用 type=3 是因为 JD 订单状态在最长 4 个月内仍可能变化 (维权 / 结算延后),
 * 按更新时间拉能捕获到这些迟来的状态变化。
 *
 * ⚠️ JD order.row.query 强制 endTime-startTime ≤ 1 小时(否则报 code=453),
 *    所以这里把 lookback 切成 1 小时一段循环拉,每段内部还要按 pageNo 翻页。
 *
 * 间隔由 JDUNION_ORDER_POLL_INTERVAL_SEC 控制,0 表示不启用。
 */
import type { JdUnionClient } from '../jd/client';
import { JdApiError, formatBeijingTimestamp } from '../jd/client';
import type { JdUnionConfig } from '../config';
import { mapOrderToLedgerEntry } from '../mapper/order-to-ledger';
import type { CommissionLedger } from '../services/commission-ledger';

export interface OrderPollerDeps {
  jd: JdUnionClient;
  ledger: CommissionLedger;
  cfg: JdUnionConfig;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function syncOrdersOnce(
  deps: OrderPollerDeps,
  opts: { lookbackHours?: number } = {},
): Promise<{ fetched: number; inserted: number; updated: number }> {
  const lookbackHours = opts.lookbackHours ?? 24;
  const endMs = Date.now();
  const totalStartMs = endMs - lookbackHours * ONE_HOUR_MS;

  let fetched = 0;
  let inserted = 0;
  let updated = 0;

  // 每窗口 1 小时,从最早往最新切片
  for (let winStartMs = totalStartMs; winStartMs < endMs; winStartMs += ONE_HOUR_MS) {
    const winEndMs = Math.min(winStartMs + ONE_HOUR_MS, endMs);
    const startStr = formatBeijingTimestamp(new Date(winStartMs));
    const endStr = formatBeijingTimestamp(new Date(winEndMs));

    let pageNo = 1;
    for (;;) {
      const res = await deps.jd.listOrderRows({
        type: 3,
        startTime: startStr,
        endTime: endStr,
        pageNo,
        pageSize: 500,
      });
      const orders = res.data ?? [];
      if (orders.length > 0) {
        const entries = orders.map(mapOrderToLedgerEntry);
        const upserted = deps.ledger.upsertMany(entries);
        fetched += orders.length;
        inserted += upserted.inserted;
        updated += upserted.updated;
      }
      if (!res.hasMore || orders.length === 0) break;
      pageNo += 1;
      if (pageNo > 50) break; // 防呆:单窗口超过 25000 条订单不太可能,断开
    }
  }

  return { fetched, inserted, updated };
}

export function startOrderPoller(deps: OrderPollerDeps): { stop: () => void } {
  const intervalSec = deps.cfg.JDUNION_ORDER_POLL_INTERVAL_SEC;
  if (intervalSec <= 0) {
    return { stop: () => {} };
  }

  const tick = async () => {
    try {
      const r = await syncOrdersOnce(deps);
      console.log(
        `[jdunion-order-poller] fetched ${r.fetched} orders, ${r.inserted} new, ${r.updated} updated, ledger size=${deps.ledger.size()}`,
      );
    } catch (err) {
      if (err instanceof JdApiError) {
        console.warn(`[jdunion-order-poller] JD error: subCode=${err.subCode}`);
      } else {
        console.warn(
          `[jdunion-order-poller] sync failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  const kickoff = setTimeout(tick, 4000);
  const handle = setInterval(tick, intervalSec * 1000);
  console.log(`[jdunion-order-poller] started, interval=${intervalSec}s`);

  return {
    stop: () => {
      clearTimeout(kickoff);
      clearInterval(handle);
    },
  };
}
