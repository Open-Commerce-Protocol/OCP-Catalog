/**
 * /admin/* 管理端点。
 *
 * - POST /admin/register   把本 alimama-provider 注册到 catalog (Provider 接入)
 * - POST /admin/sync       拉一波物料 → 映射 → 推到 catalog (核心动作)
 *
 * 这些端点会触发注册、同步和订单读取，必须用 x-admin-key 保护。
 */
import { Elysia, t } from 'elysia';
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { mapMaterialToCommercialObject } from '../mapper/material-to-object';
import type { OcpCatalogClient } from '../services/catalog-client';
import type { CommissionLedger } from '../services/commission-ledger';
import { buildProviderRegistration } from '../services/registration';
import { syncOrdersOnce } from '../workers/order-poller';

interface AdminDeps {
  alimama: AlimamaClient;
  catalog: OcpCatalogClient;
  ledger: CommissionLedger;
  cfg: AlimamaConfig;
}

// 单批 sync 上限（OCP catalog 校验:objects[] 最多 100）
const BATCH_SIZE = 100;

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
      '/register',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_ADMIN_KEY)) return unauthorized(set);
        const version = body?.version ?? 1;
        const reg = buildProviderRegistration(deps.cfg, version);
        return deps.catalog.registerProvider(reg as unknown as Record<string, unknown>);
      },
      {
        body: t.Optional(
          t.Object({
            version: t.Optional(t.Number()),
          }),
        ),
      },
    )
    .post(
      '/sync',
      async ({ body, headers, set }) => {
        if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_ADMIN_KEY)) return unauthorized(set);
        const q = body?.q;
        const cat = body?.cat;
        const pageSize = body?.pageSize ?? 20;
        const registrationVersion = body?.registrationVersion ?? 1;

        // 1. 从 alimama 拉物料
        const mat = await deps.alimama.listMaterial({ q, cat, pageNo: 1, pageSize });
        const items = mat.tbk_dg_material_optional_response?.result_list?.map_data ?? [];

        if (items.length === 0) {
          return { total: 0, batches: 0, results: [], message: 'No items from upstream' };
        }

        // 2. 映射到 OCP CommercialObject
        const mapperCtx = {
          providerId: deps.cfg.OCP_PROVIDER_ID,
          providerBaseUrl: deps.cfg.OCP_PROVIDER_BASE_URL,
        };
        const objects = items.map((item) => mapMaterialToCommercialObject(item, mapperCtx));

        // 3. 按 100 拆批 + 推到 catalog
        const results: unknown[] = [];
        for (let i = 0; i < objects.length; i += BATCH_SIZE) {
          const batch = objects.slice(i, i + BATCH_SIZE);
          const res = await deps.catalog.syncObjects({
            ocp_version: '1.0',
            kind: 'ObjectSyncRequest',
            catalog_id: deps.cfg.OCP_CATALOG_ID,
            provider_id: deps.cfg.OCP_PROVIDER_ID,
            registration_version: registrationVersion,
            batch_id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            objects: batch,
          });
          results.push(res);
        }

        return {
          total: objects.length,
          batches: results.length,
          results,
        };
      },
      {
        body: t.Optional(
          t.Object({
            q: t.Optional(t.String()),
            cat: t.Optional(t.String()),
            pageSize: t.Optional(t.Number()),
            registrationVersion: t.Optional(t.Number()),
          }),
        ),
      },
    )
    .post('/sync-orders', async ({ body, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      const lookbackHours = body?.lookbackHours ?? 24;
      const result = await syncOrdersOnce(
        { alimama: deps.alimama, ledger: deps.ledger, cfg: deps.cfg },
        { lookbackHours },
      );
      return result;
    }, {
      body: t.Optional(t.Object({ lookbackHours: t.Optional(t.Number()) })),
    })
    .get('/stats', ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      return deps.ledger.stats();
    })
    .get('/ledger', ({ query, headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.OCP_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      const limit = query?.limit ? Number(query.limit) : 50;
      // 把 Date 序列化成 ISO 字符串
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
