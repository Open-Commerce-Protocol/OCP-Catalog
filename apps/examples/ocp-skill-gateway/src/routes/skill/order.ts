/**
 * POST /skill/order  (P2,占位)
 *
 * M1 不接订单查询;先返回 not-implemented,后续接 catalog 节点的 order-poller 聚合。
 */
import { Elysia, t } from 'elysia';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createOrderRoute(deps: { telemetry: TelemetryRecorder }) {
  return new Elysia().post(
    '/skill/order',
    async ({ body, set }) => {
      set.status = 501;
      await deps.telemetry.record({
        ts: Date.now(),
        skill: 'order',
        dimensions: { sub_id: body.sub_id },
        outcome: 'error',
        elapsed_ms: 0,
        error_code: 'not_implemented',
      });
      return {
        error: 'not_implemented',
        message:
          'order skill 计划在 M2 通过聚合各 catalog 节点的 order-poller 数据实现。' +
          '当前可先查各联盟自家的订单后台。',
      };
    },
    {
      body: t.Object({
        sub_id: t.Optional(t.String({ description: '子渠道 / Agent 标识' })),
        days: t.Optional(t.Integer({ minimum: 1, maximum: 30, default: 7 })),
      }),
      detail: {
        summary: '查询订单与佣金 (M2)',
        description: '当前未实现,占位以便 OpenAPI 一次成型。',
      },
    },
  );
}
