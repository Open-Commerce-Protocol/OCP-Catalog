/**
 * Internal admin endpoints for the Alimama Catalog Node.
 *
 * These endpoints are operational tools for probing upstream Alimama and
 * maintaining an in-memory commission ledger. They are intentionally separate
 * from OCP Provider registration and object sync.
 */
import { Elysia, t } from 'elysia';
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { mapMaterialToCommercialObject } from '../mapper/material-to-object';
import type { CommissionLedger } from '../services/commission-ledger';
import { sourceId } from '../catalog/manifest';
import { syncOrdersOnce } from '../workers/order-poller';

interface AdminDeps {
  alimama: AlimamaClient;
  ledger: CommissionLedger;
  cfg: AlimamaConfig;
}

function isAuthorized(headers: Record<string, string | undefined>, expected: string): boolean {
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
        if (!isAuthorized(headers, deps.cfg.ALIMAMA_CATALOG_ADMIN_KEY)) return unauthorized(set);

        const pageSize = body?.pageSize ?? deps.cfg.ALIMAMA_DEFAULT_PAGE_SIZE;
        const upstream = await deps.alimama.listMaterial({
          q: body?.q,
          cat: body?.cat,
          pageNo: 1,
          pageSize,
        });
        const materials = upstream.tbk_dg_material_optional_response?.result_list?.map_data ?? [];
        const objects = materials.map((item) => mapMaterialToCommercialObject(item, {
          sourceId: sourceId(),
          catalogBaseUrl: deps.cfg.ALIMAMA_CATALOG_PUBLIC_BASE_URL,
        }));

        return {
          source_id: sourceId(),
          total: materials.length,
          objects,
        };
      },
      {
        body: t.Optional(
          t.Object({
            q: t.Optional(t.String()),
            cat: t.Optional(t.String()),
            pageSize: t.Optional(t.Number()),
          }),
        ),
      },
    )
    .post('/sync-orders', async ({ body, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.ALIMAMA_CATALOG_ADMIN_KEY)) return unauthorized(set);
      const lookbackHours = body?.lookbackHours ?? 24;
      return syncOrdersOnce(
        { alimama: deps.alimama, ledger: deps.ledger, cfg: deps.cfg },
        { lookbackHours },
      );
    }, {
      body: t.Optional(t.Object({ lookbackHours: t.Optional(t.Number()) })),
    })
    .get('/stats', ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.ALIMAMA_CATALOG_ADMIN_KEY)) return unauthorized(set);
      return deps.ledger.stats();
    })
    .get('/ledger', ({ query, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.ALIMAMA_CATALOG_ADMIN_KEY)) return unauthorized(set);
      const limit = query?.limit ? Number(query.limit) : 50;
      return {
        size: deps.ledger.size(),
        entries: deps.ledger.list({ limit }).map((e) => ({
          tradeId: e.tradeId,
          alimamaAdzoneId: e.alimamaAdzoneId,
          itemId: e.itemId,
          itemTitle: e.itemTitle,
          payAmount: e.payAmount,
          estimatedCommission: e.estimatedCommission,
          realCommission: e.realCommission,
          orderStatus: e.orderStatus,
          rawTkStatus: e.rawTkStatus,
          payTime: e.payTime?.toISOString() ?? null,
          earningTime: e.earningTime?.toISOString() ?? null,
        })),
      };
    });
}
