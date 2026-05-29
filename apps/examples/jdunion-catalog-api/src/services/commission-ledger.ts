/**
 * 佣金账本 - 内存版 (PoC 阶段)。
 *
 * 接口与 alimama CommissionLedger 同构,差异点:
 *   - 聚合维度多一个 by_agent (用 agentSubUnionId 分组),
 *     这是 JD 特有的 per-Agent 归因能力。alimama 那边 adzone_id 兼任两个角色没法拆。
 *   - by_position 字段命名替换 alimama 的 by_adzone (JD 用 positionId 不叫 adzone)
 *
 * 限制 (沿用 alimama PoC 决策):
 *   - 进程重启数据丢失
 *   - 单进程,多副本会数据分裂
 *   - >10 万订单要考虑分页 / 持久化
 *
 * 接口设计保持 DB 版本可平滑迁移:upsert by tradeId 幂等。
 */
import type {
  CommissionLedgerEntry,
  LedgerOrderStatus,
} from '../mapper/order-to-ledger';

export interface LedgerStats {
  total_orders: number;
  by_status: Record<LedgerOrderStatus, number>;
  total_pay_amount_fen: number;
  total_estimated_commission_fen: number;
  total_real_commission_fen: number;
  /** 按推广位 positionId 聚合 (等价于 alimama 的 by_adzone) */
  by_position: Record<
    string,
    {
      orders: number;
      estimated_commission_fen: number;
      real_commission_fen: number;
    }
  >;
  /** 按 Agent 标识 (subUnionId) 聚合,alimama 没有该维度 */
  by_agent: Record<
    string,
    {
      orders: number;
      estimated_commission_fen: number;
      real_commission_fen: number;
    }
  >;
  last_updated_at: string | null;
}

export class CommissionLedger {
  private readonly entries = new Map<string, CommissionLedgerEntry>();

  /** Upsert by tradeId (同一订单状态变化时刷新) */
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
      by_position: {},
      by_agent: {},
      last_updated_at: null,
    };

    let latestUpdate = 0;
    for (const e of this.entries.values()) {
      stats.by_status[e.orderStatus]++;
      stats.total_pay_amount_fen += e.payAmount;
      stats.total_estimated_commission_fen += e.estimatedCommission;
      stats.total_real_commission_fen += e.realCommission ?? 0;

      // by_position
      const posKey = e.jdPositionId !== null ? String(e.jdPositionId) : '(unknown)';
      if (!stats.by_position[posKey]) {
        stats.by_position[posKey] = {
          orders: 0,
          estimated_commission_fen: 0,
          real_commission_fen: 0,
        };
      }
      const posSlot = stats.by_position[posKey];
      posSlot.orders++;
      posSlot.estimated_commission_fen += e.estimatedCommission;
      posSlot.real_commission_fen += e.realCommission ?? 0;

      // by_agent
      const agentKey = e.agentSubUnionId ?? '(unknown)';
      if (!stats.by_agent[agentKey]) {
        stats.by_agent[agentKey] = {
          orders: 0,
          estimated_commission_fen: 0,
          real_commission_fen: 0,
        };
      }
      const agentSlot = stats.by_agent[agentKey];
      agentSlot.orders++;
      agentSlot.estimated_commission_fen += e.estimatedCommission;
      agentSlot.real_commission_fen += e.realCommission ?? 0;

      const u = e.updatedAt.getTime();
      if (u > latestUpdate) latestUpdate = u;
    }

    if (latestUpdate > 0) {
      stats.last_updated_at = new Date(latestUpdate).toISOString();
    }
    return stats;
  }

  /** 清空 (仅测试用) */
  clear(): void {
    this.entries.clear();
  }
}
