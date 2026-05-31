/**
 * POST /skill/compare  (P1,占位实现)
 *
 * 同关键词跨 catalog 搜 → 按归一化标题/SKU 聚合 → 按价格升序返回。
 * M1 简化为:就跑一遍 fanoutSearch,前端按 price 排序。
 */
import { Elysia, t } from 'elysia';
import type { BrokerClient } from '../../broker/client';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createCompareRoute(deps: {
  broker: BrokerClient;
  telemetry: TelemetryRecorder;
}) {
  return new Elysia().post(
    '/skill/compare',
    async ({ body, headers }) => {
      const t0 = Date.now();
      const apiKeyId = headers['x-skill-key'] ?? headers['X-Skill-Key'];
      const result = await deps.broker.fanoutSearch({
        query: body.query,
        page_size: body.per_source ?? 5,
      });
      const ranked = result.hits
        .filter((h) => typeof h.price === 'number')
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
        .map((h) => ({
          source: h.catalog_name,
          title: h.title,
          price: h.price,
          currency: h.currency,
          detail_url: h.detail_url,
          catalog_id: h.catalog_id,
          entry_ref: h.entry_ref,
        }));
      await deps.telemetry.record({
        ts: Date.now(),
        api_key_id: apiKeyId,
        skill: 'compare',
        dimensions: { query: body.query, hits: ranked.length },
        outcome: 'ok',
        elapsed_ms: Date.now() - t0,
      });
      return { query: body.query, items: ranked };
    },
    {
      body: t.Object({
        query: t.String({ description: '要比价的商品关键词,例如 "iPhone 15 Pro 256GB"' }),
        per_source: t.Optional(t.Integer({ minimum: 1, maximum: 10, default: 5 })),
      }),
      detail: {
        summary: '跨电商联盟比价',
        description: '在多家联盟搜同一商品并按价格升序返回,帮用户选最低价。',
      },
    },
  );
}
