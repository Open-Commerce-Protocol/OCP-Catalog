/**
 * POST /skill/deeplink
 *
 * 用 search 返回的 catalog_id + entry_ref 生成带返佣的购买链接。
 * sub_id 可选,用于把这次点击归因到具体 Agent / 学生(后续做分润用)。
 */
import { Elysia, t } from 'elysia';
import type { BrokerClient } from '../../broker/client';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createDeeplinkRoute(deps: {
  broker: BrokerClient;
  telemetry: TelemetryRecorder;
}) {
  return new Elysia().post(
    '/skill/deeplink',
    async ({ body, headers }) => {
      const t0 = Date.now();
      const apiKeyId = headers['x-skill-key'] ?? headers['X-Skill-Key'];
      // sub_id 若调用方没传,默认用 api_key_id;这样学生的 Agent 默认按 key 归因
      const subId = body.sub_id ?? apiKeyId;
      const result = await deps.broker.resolve({
        catalog_id: body.catalog_id,
        entry_ref: body.entry_ref,
        sub_id: subId,
      });
      await deps.telemetry.record({
        ts: Date.now(),
        api_key_id: apiKeyId,
        skill: 'deeplink',
        dimensions: {
          catalog_id: body.catalog_id,
          sub_id: subId,
        },
        outcome: result.error ? 'error' : 'ok',
        elapsed_ms: Date.now() - t0,
        error_code: result.error,
      });
      return {
        catalog_id: result.catalog_id,
        deeplink_url: result.deeplink_url,
        short_url: result.short_url,
        error: result.error,
      };
    },
    {
      body: t.Object({
        catalog_id: t.String({ description: '来自 /skill/search 返回项的 catalog_id' }),
        entry_ref: t.String({ description: '来自 /skill/search 返回项的 entry_ref' }),
        sub_id: t.Optional(
          t.String({ description: '可选,子渠道归因标识,通常是 Agent ID 或学生 ID' }),
        ),
      }),
      detail: {
        summary: '生成带返佣的购买链接',
        description:
          '把 search 结果中的某一项转成可点击的带返佣 deeplink。' +
          '前端/Agent 拿到 deeplink_url 后即可让用户下单,佣金回流到对应账号。',
      },
    },
  );
}
