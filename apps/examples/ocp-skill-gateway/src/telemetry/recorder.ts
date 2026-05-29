/**
 * 调用埋点(MVP)。
 *
 * M1:进程内 Ring buffer + 可选 JSONL append。零依赖,可直接跑。
 * M2:切到 SQLite/PostgreSQL,加聚合 query。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SkillGatewayConfig } from '../config';

export interface TelemetryEvent {
  ts: number;
  api_key_id?: string;
  skill: 'search' | 'deeplink' | 'compare' | 'recommend' | 'order';
  /** 用于 dashboard 聚合,例如 search 时记 query;deeplink 时记 catalog_id */
  dimensions: Record<string, string | number | undefined>;
  outcome: 'ok' | 'error';
  elapsed_ms: number;
  error_code?: string;
}

const MAX_RING = 5000;

export class TelemetryRecorder {
  private ring: TelemetryEvent[] = [];

  constructor(private readonly cfg: SkillGatewayConfig) {}

  async record(ev: TelemetryEvent): Promise<void> {
    if (this.ring.length >= MAX_RING) this.ring.shift();
    this.ring.push(ev);
    if (this.cfg.SKILL_GATEWAY_TELEMETRY_SINK === 'jsonl') {
      await this.appendJsonl(ev);
    }
  }

  /** dashboard 用:返回最近 N 条 */
  recent(limit = 200): TelemetryEvent[] {
    return this.ring.slice(-limit);
  }

  /** dashboard 用:按 skill 名分组 count */
  countBySkill(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.ring) out[e.skill] = (out[e.skill] ?? 0) + 1;
    return out;
  }

  private async appendJsonl(ev: TelemetryEvent): Promise<void> {
    const path = this.cfg.SKILL_GATEWAY_TELEMETRY_JSONL_PATH;
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(ev) + '\n', 'utf-8');
    } catch {
      // 埋点失败不能影响主链路;吞掉
    }
  }
}
