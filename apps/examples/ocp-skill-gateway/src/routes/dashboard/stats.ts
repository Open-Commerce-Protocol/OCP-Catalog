/**
 * Dashboard API。给学生/运营浏览器调,**不在 OpenAPI 里暴露**。
 *
 * M1 只支撑 4 个最基本的展示:
 *   - GET /dashboard/catalogs            已上架的 catalog 列表 + ping 状态
 *   - GET /dashboard/skill-stats         skill 调用计数
 *   - GET /dashboard/recent              最近 N 条调用流水
 *   - GET /dashboard/summary             首页汇总卡片
 */
import { Elysia } from 'elysia';
import type { BrokerClient } from '../../broker/client';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createDashboardRoutes(deps: {
  broker: BrokerClient;
  telemetry: TelemetryRecorder;
}) {
  return new Elysia({ prefix: '/dashboard' })
    .get('/catalogs', async () => {
      // 不同 broker 实现自己处理「怎么列 / 怎么探活」
      return { catalogs: await deps.broker.pingCatalogs() };
    })
    .get('/skill-stats', () => ({
      by_skill: deps.telemetry.countBySkill(),
    }))
    .get('/recent', ({ query }) => ({
      events: deps.telemetry.recent(Number(query.limit ?? 100)),
    }))
    .get('/summary', () => {
      const recent = deps.telemetry.recent(1000);
      const ok = recent.filter((e) => e.outcome === 'ok').length;
      const err = recent.filter((e) => e.outcome === 'error').length;
      const avgMs =
        recent.length > 0
          ? Math.round(recent.reduce((s, e) => s + e.elapsed_ms, 0) / recent.length)
          : 0;
      return {
        total_calls: recent.length,
        ok_calls: ok,
        error_calls: err,
        avg_latency_ms: avgMs,
        by_skill: deps.telemetry.countBySkill(),
        catalogs_configured: deps.broker.catalogs.length,
      };
    });
}
