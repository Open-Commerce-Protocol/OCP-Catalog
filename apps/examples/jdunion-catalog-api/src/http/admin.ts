/**
 * 内部 admin 端点。
 *
 * 提供 4 个运维工具:
 *   - POST /admin/probe-query   手动跑一次 JD goods.query,落地 CommercialObject 形态(不写库)
 *   - POST /admin/sync-orders   手动触发订单同步到 ledger
 *   - GET  /admin/stats         看 ledger 聚合统计(by_status / by_position / by_agent)
 *   - GET  /admin/ledger        看 ledger 明细 (按 payTime 倒序)
 *
 * 全部要求 x-admin-key 头与 cfg.JDUNION_CATALOG_ADMIN_KEY 一致。
 * 这些端点与 OCP 协议分离,只是给运维 / 调试用,不出现在 manifest 里。
 */
import { Elysia, t } from 'elysia';
import type { JdUnionClient } from '../jd/client';
import type { JdUnionConfig } from '../config';
import { mapGoodsToCommercialObject } from '../mapper/goods-to-object';
import type { CommissionLedger } from '../services/commission-ledger';
import { sourceId } from '../catalog/manifest';
import { syncOrdersOnce } from '../workers/order-poller';

interface AdminDeps {
  jd: JdUnionClient;
  ledger: CommissionLedger;
  cfg: JdUnionConfig;
}

function isAuthorized(
  headers: Record<string, string | undefined>,
  expected: string,
): boolean {
  return headers['x-admin-key'] === expected;
}

function unauthorized(set: { status?: number | string }) {
  set.status = 401;
  return { error: { code: 'unauthorized', message: 'Invalid or missing x-admin-key' } };
}

export function createAdminRoutes(deps: AdminDeps) {
  return new Elysia({ prefix: '/admin' })
    .post(
      '/probe-query',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.JDUNION_CATALOG_ADMIN_KEY)) {
          return unauthorized(set);
        }
        const pageSize = body?.pageSize ?? deps.cfg.JDUNION_DEFAULT_PAGE_SIZE;
        const upstream = await deps.jd.listGoods({
          keyword: body?.keyword,
          pageIndex: 1,
          pageSize,
        });
        const goods = upstream.data ?? [];
        const objects = goods.map((item) =>
          mapGoodsToCommercialObject(item, {
            sourceId: sourceId(),
            catalogBaseUrl: deps.cfg.JDUNION_CATALOG_PUBLIC_BASE_URL,
          }),
        );
        return {
          source_id: sourceId(),
          total: goods.length,
          objects,
        };
      },
      {
        body: t.Optional(
          t.Object({
            keyword: t.Optional(t.String()),
            pageSize: t.Optional(t.Number()),
          }),
        ),
      },
    )
    .post(
      '/sync-orders',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.JDUNION_CATALOG_ADMIN_KEY)) {
          return unauthorized(set);
        }
        const lookbackHours = body?.lookbackHours ?? 24;
        return syncOrdersOnce(
          { jd: deps.jd, ledger: deps.ledger, cfg: deps.cfg },
          { lookbackHours },
        );
      },
      {
        body: t.Optional(t.Object({ lookbackHours: t.Optional(t.Number()) })),
      },
    )
    .get('/stats', ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.JDUNION_CATALOG_ADMIN_KEY)) {
        return unauthorized(set);
      }
      return deps.ledger.stats();
    })
    .get('/ledger', ({ query, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.JDUNION_CATALOG_ADMIN_KEY)) {
        return unauthorized(set);
      }
      const limit = query?.limit ? Number(query.limit) : 50;
      return {
        size: deps.ledger.size(),
        entries: deps.ledger.list({ limit }).map((e) => ({
          tradeId: e.tradeId,
          parentTradeId: e.parentTradeId,
          jdPositionId: e.jdPositionId,
          jdUnionId: e.jdUnionId,
          skuId: e.skuId,
          skuName: e.skuName,
          skuNum: e.skuNum,
          payAmount: e.payAmount,
          estimatedCommission: e.estimatedCommission,
          realCommission: e.realCommission,
          commissionRateBp: e.commissionRateBp,
          orderStatus: e.orderStatus,
          rawValidCode: e.rawValidCode,
          payTime: e.payTime?.toISOString() ?? null,
          earningTime: e.earningTime?.toISOString() ?? null,
          externalId: e.externalId,
          agentSubUnionId: e.agentSubUnionId,
        })),
      };
    });
}
