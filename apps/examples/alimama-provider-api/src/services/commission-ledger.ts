/**
 * 佣金账本 - 内存版（PoC 阶段）。
 *
 * 真接 Alimama 之后(Day 7+) 替换为 Postgres 持久化 + Drizzle。
 * 当前限制:
 *   - 进程重启数据丢失
 *   - 单进程,多副本会数据分裂
 *   - 不支持大数据量(>10 万订单要考虑分页)
 *
 * 但接口设计跟未来 DB 版本对齐:
 *   - upsert by tradeId(幂等,允许 poller 多次重跑)
 *   - 按状态/adzone/时间聚合查询
 */
import type { CommissionLedgerEntry, LedgerOrderStatus } from '../mapper/order-to-ledger';

export interface LedgerStats {
  total_orders: number;
  by_status: Record<LedgerOrderStatus, number>;
  total_pay_amount_fen: number;
  total_estimated_commission_fen: number;
  total_real_commission_fen: number;
  by_adzone: Record<string, {
    orders: number;
    estimated_commission_fen: number;
    real_commission_fen: number;
  }>;
  last_updated_at: string | null;
}

export class CommissionLedger {
  private readonly entries = new Map<string, CommissionLedgerEntry>();

  /** Upsert by tradeId(同一订单状态变化时刷新) */
  upsert(entry: CommissionLedgerEntry): void {
    this.entries.set(entry.tradeId, entry);
  }

  /** 批量 upsert(returns 新增 vs 更新计数,便于 poller 日志) */
  upsertMany(entries: CommissionLedgerEntry[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;
    for (const e of entries) {
      if (this.entries.has(e.tradeId)) updated++;
      else inserted++;
      this.entries.set(e.tradeId, e);
    }
    return { inserted, updated };
  }

  get(tradeId: string): CommissionLedgerEntry | undefined {
    return this.entries.get(tradeId);
  }

  size(): number {
    return this.entries.size;
  }

  /** 全量列出(用于 /admin/ledger),按 payTime 倒序 */
  list(opts?: { limit?: number }): CommissionLedgerEntry[] {
    const arr = Array.from(this.entries.values());
    arr.sort((a, b) => {
      const ta = a.payTime?.getTime() ?? 0;
      const tb = b.payTime?.getTime() ?? 0;
      return tb - ta;
    });
    return opts?.limit ? arr.slice(0, opts.limit) : arr;
  }

  /** 聚合统计(用于 /admin/stats) */
  stats(): LedgerStats {
    const stats: LedgerStats = {
      total_orders: this.entries.size,
      by_status: {
        paid: 0,
        settled: 0,
        invalid: 0,
        under_dispute: 0,
        unknown: 0,
      },
      total_pay_amount_fen: 0,
      total_estimated_commission_fen: 0,
      total_real_commission_fen: 0,
      by_adzone: {},
      last_updated_at: null,
    };

    let latestUpdate = 0;
    for (const e of this.entries.values()) {
      stats.by_status[e.orderStatus]++;
      stats.total_pay_amount_fen += e.payAmount;
      stats.total_estimated_commission_fen += e.estimatedCommission;
      stats.total_real_commission_fen += e.realCommission ?? 0;

      const adzKey = e.alimamaAdzoneId !== null ? String(e.alimamaAdzoneId) : '(unknown)';
      if (!stats.by_adzone[adzKey]) {
        stats.by_adzone[adzKey] = {
          orders: 0,
          estimated_commission_fen: 0,
          real_commission_fen: 0,
        };
      }
      const slot = stats.by_adzone[adzKey];
      slot.orders++;
      slot.estimated_commission_fen += e.estimatedCommission;
      slot.real_commission_fen += e.realCommission ?? 0;

      const u = e.updatedAt.getTime();
      if (u > latestUpdate) latestUpdate = u;
    }

    if (latestUpdate > 0) {
      stats.last_updated_at = new Date(latestUpdate).toISOString();
    }

    return stats;
  }

  /** 清空(仅测试用) */
  clear(): void {
    this.entries.clear();
  }
}
