/**
 * POST /skill/recommend  (P1,占位实现)
 *
 * 按预算 / 类目推荐。M1 简化为:fanoutSearch + 按 price 区间过滤 + 截断。
 */
import { Elysia, t } from 'elysia';
import type { BrokerClient } from '../../broker/client';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createRecommendRoute(deps: {
  broker: BrokerClient;
  telemetry: TelemetryRecorder;
}) {
  return new Elysia().post(
    '/skill/recommend',
    async ({ body, headers }) => {
      const t0 = Date.now();
      const apiKeyId = headers['x-skill-key'] ?? headers['X-Skill-Key'];
      const query = body.category ?? body.query ?? '热销';
      const result = await deps.broker.fanoutSearch({ query, page_size: 20 });
      const items = result.hits
        .filter((h) => {
          if (typeof h.price !== 'number') return false;
          if (body.budget_max !== undefined && h.price > body.budget_max) return false;
          if (body.budget_min !== undefined && h.price < body.budget_min) return false;
          return true;
        })
        .slice(0, body.limit ?? 5)
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
        skill: 'recommend',
        dimensions: {
          query,
          budget_max: body.budget_max,
          budget_min: body.budget_min,
          hits: items.length,
        },
        outcome: 'ok',
        elapsed_ms: Date.now() - t0,
      });
      return { reason: `符合 ${query} 且价格区间内的 ${items.length} 件`, items };
    },
    {
      body: t.Object({
        query: t.Optional(t.String({ description: '关键词,如 "蓝牙耳机"' })),
        category: t.Optional(t.String({ description: '类目名,如 "美妆" "数码"' })),
        budget_min: t.Optional(t.Number({ description: '最低预算 (CNY)' })),
        budget_max: t.Optional(t.Number({ description: '最高预算 (CNY)' })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 20, default: 5 })),
      }),
      detail: {
        summary: '按预算 / 类目推荐商品',
        description:
          '根据用户给出的预算区间和类目,从已接入联盟中筛选并推荐若干商品。' +
          'query / category 至少给一个。',
      },
    },
  );
}
