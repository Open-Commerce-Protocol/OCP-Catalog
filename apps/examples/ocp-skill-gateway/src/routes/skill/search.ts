/**
 * POST /skill/search
 *
 * LLM Friendly:入参就一个自然语言 query + 可选分页,出参扁平。
 * 内部调 BrokerClient.fanoutSearch,跨所有已配置 catalog 并行搜。
 */
import { Elysia, t } from 'elysia';
import type { BrokerClient } from '../../broker/client';
import type { TelemetryRecorder } from '../../telemetry/recorder';

export function createSearchRoute(deps: {
  broker: BrokerClient;
  telemetry: TelemetryRecorder;
}) {
  return new Elysia().post(
    '/skill/search',
    async ({ body, headers }) => {
      const t0 = Date.now();
      const apiKeyId = headers['x-skill-key'] ?? headers['X-Skill-Key'];
      try {
        const result = await deps.broker.fanoutSearch({
          query: body.query,
          page: body.page,
          page_size: body.page_size,
        });
        // 扁平化给 LLM:只返必要字段
        const items = result.hits.map((h) => ({
          title: h.title,
          price: h.price,
          currency: h.currency,
          image_url: h.image_url,
          detail_url: h.detail_url,
          source: h.catalog_name,
          // entry_ref + catalog_id 一起回给 LLM,后续 /skill/deeplink 要传回来
          entry_ref: h.entry_ref,
          catalog_id: h.catalog_id,
        }));
        await deps.telemetry.record({
          ts: Date.now(),
          api_key_id: apiKeyId,
          skill: 'search',
          dimensions: { query: body.query, hits: items.length },
          outcome: 'ok',
          elapsed_ms: Date.now() - t0,
        });
        return {
          query: body.query,
          total: items.length,
          items,
          per_catalog: result.per_catalog,
        };
      } catch (e) {
        await deps.telemetry.record({
          ts: Date.now(),
          api_key_id: apiKeyId,
          skill: 'search',
          dimensions: { query: body.query },
          outcome: 'error',
          elapsed_ms: Date.now() - t0,
          error_code: e instanceof Error ? e.message : 'unknown',
        });
        throw e;
      }
    },
    {
      body: t.Object({
        query: t.String({ description: '用户搜索关键词,如 "200 元以内的蓝牙耳机"' }),
        page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
        page_size: t.Optional(t.Integer({ minimum: 1, maximum: 30, default: 10 })),
      }),
      detail: {
        summary: '跨电商联盟搜索商品',
        description:
          '在所有已接入的电商联盟(淘宝/京东/拼多多等)中并行搜索商品,返回扁平化结果。' +
          '后续如需生成购买链接,把返回项中的 catalog_id + entry_ref 透传给 /skill/deeplink。',
      },
    },
  );
}
