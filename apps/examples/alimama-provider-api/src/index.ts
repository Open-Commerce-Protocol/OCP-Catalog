/**
 * alimama-provider-api 服务入口。
 *
 * 角色:OCP Catalog × 阿里妈妈淘宝联盟 的翻译适配层。
 *   - 向上对 OCP catalog(/admin/sync 推商品,/provider/resolve_hook 接回调)
 *   - 向下对阿里妈妈 (taobao.tbk.* APIs,mock 模式从 fixture)
 */
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import { AlimamaClient } from './alimama/client';
import { loadAlimamaConfig } from './config';
import { createAdminRoutes } from './http/admin';
import { createResolveHookRoutes } from './http/resolve-hook';
import { OcpCatalogClient } from './services/catalog-client';
import { CommissionLedger } from './services/commission-ledger';
import { startMaterialPoller } from './workers/material-poller';
import { startOrderPoller } from './workers/order-poller';

const cfg = loadAlimamaConfig();
const alimama = new AlimamaClient(cfg);
const catalog = new OcpCatalogClient(cfg);
const ledger = new CommissionLedger();

const app = new Elysia()
  .use(cors({
    origin: false,
  }))
  .onError(({ error, set }) => {
    if (error instanceof ZodError) {
      set.status = 400;
      return {
        error: {
          code: 'validation_error',
          message: 'Invalid request body',
          details: error.issues,
        },
      };
    }
    set.status = 500;
    return {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
      },
    };
  })
  .get('/health', () => ({
    ok: true,
    service: 'alimama-provider-api',
    provider_id: cfg.OCP_PROVIDER_ID,
    mock_mode: cfg.ALIMAMA_MOCK,
    catalog_base_url: cfg.OCP_CATALOG_BASE_URL,
  }))
  .use(createAdminRoutes({ alimama, catalog, ledger, cfg }))
  .use(createResolveHookRoutes({ alimama, cfg }))
  .listen(cfg.PROVIDER_PORT);

console.log(
  `[alimama-provider-api] listening on http://localhost:${app.server?.port ?? cfg.PROVIDER_PORT}, mock=${cfg.ALIMAMA_MOCK}`,
);

// 启动 cron workers（env-gated:interval=0 时不启动)
startMaterialPoller({ alimama, catalog, cfg });
startOrderPoller({ alimama, ledger, cfg });
