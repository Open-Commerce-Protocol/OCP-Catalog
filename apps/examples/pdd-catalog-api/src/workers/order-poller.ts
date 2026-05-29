/**
 * Order Poller: 定时拉 PDD 订单 → 写入 commission_ledger。
 *
 * 默认行为:每次拉过去 24 小时的订单 (按更新时间 increment 接口)。
 * 用 increment.get 是因为 PDD 订单状态在最长 4 个月内仍可能变化
 * (维权 / 结算延后 / 处罚),按更新时间拉能捕获这些状态变化。
 *
 * 间隔由 PDD_ORDER_POLL_INTERVAL_SEC 控制,0 表示不启用。
 *
 * ⚠️ 真实联调注意:
 *   PDD increment.get 单次查询时间跨度上限是 30 分钟。
 *   当前实现单次调用走 24 小时跨度,真实模式下 PDD 会拒绝。
 *   生产环境需要把 lookback 切成 48 个 30 分钟窗口循环调用。
 *   PoC 阶段先 mock,真实联调时再加 window-stitching 逻辑。
 */
import type { PddClient } from '../pdd/client';
import { PddApiError } from '../pdd/client';
import type { PddConfig } from '../config';
import { mapOrderToLedgerEntry } from '../mapper/order-to-ledger';
import type { CommissionLedger } from '../services/commission-ledger';

export interface OrderPollerDeps {
  pdd: PddClient;
  ledger: CommissionLedger;
  cfg: PddConfig;
}

export async function syncOrdersOnce(
  deps: OrderPollerDeps,
  opts: { lookbackHours?: number } = {},
): Promise<{ fetched: number; inserted: number; updated: number }> {
  const lookbackHours = opts.lookbackHours ?? 24;
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - lookbackHours * 60 * 60;

  const res = await deps.pdd.listOrderIncrement({
    startUpdateTime: startTime,
    endUpdateTime: endTime,
    page: 1,
    pageSize: 100,
  });

  const orders = res.order_list ?? [];
  if (orders.length === 0) {
    return { fetched: 0, inserted: 0, updated: 0 };
  }

  const entries = orders.map(mapOrderToLedgerEntry);
  const { inserted, updated } = deps.ledger.upsertMany(entries);
  return { fetched: orders.length, inserted, updated };
}

export function startOrderPoller(deps: OrderPollerDeps): { stop: () => void } {
  const intervalSec = deps.cfg.PDD_ORDER_POLL_INTERVAL_SEC;
  if (intervalSec <= 0) {
    return { stop: () => {} };
  }

  const tick = async () => {
    try {
      const r = await syncOrdersOnce(deps);
      console.log(
        `[pdd-order-poller] fetched ${r.fetched} orders, ${r.inserted} new, ${r.updated} updated, ledger size=${deps.ledger.size()}`,
      );
    } catch (err) {
      if (err instanceof PddApiError) {
        console.warn(`[pdd-order-poller] PDD error: subCode=${err.subCode}`);
      } else {
        console.warn(
          `[pdd-order-poller] sync failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  const kickoff = setTimeout(tick, 4000);
  const handle = setInterval(tick, intervalSec * 1000);
  console.log(`[pdd-order-poller] started, interval=${intervalSec}s`);

  return {
    stop: () => {
      clearTimeout(kickoff);
      clearInterval(handle);
    },
  };
}
