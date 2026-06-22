import { cors } from '@elysiajs/cors';
import { createShopifyAppDb } from '@ocp-catalog/shopify-app-db';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { ShopifyAppConfig } from './config';
import { createAdminRoutes } from './http/admin';
import { createEmbeddedRoutes } from './http/embedded';
import { createOAuthRoutes } from './http/oauth';
import { createWebhookRoutes } from './http/webhooks';
import { CatalogClient, CatalogClientError } from './services/catalog-client';
import { SyncService } from './services/sync-service';
import { ShopifyAdminClient, ShopifyApiError } from './shopify/admin-client';
import { InstallationStore } from './store/installation-store';
import { ShopifyAppJobStore, ShopifyAppWebhookEventStore } from './store/job-store';
import { OAuthStateStore } from './store/oauth-state-store';
import { TokenVault } from './store/token-vault';
import { ShopifyAppJobWorker } from './workers/shopify-app-job-worker';

export async function createShopifyApp(deps: { cfg: ShopifyAppConfig }) {
  const { cfg } = deps;
  const db = createShopifyAppDb(cfg.DATABASE_URL);
  const tokenVault = new TokenVault(db, cfg);
  const store = new InstallationStore(db, cfg.SHOPIFY_APP_CATALOG_ID, cfg.SHOPIFY_APP_API_VERSION, tokenVault);
  const oauthStates = new OAuthStateStore(db);
  const jobs = new ShopifyAppJobStore(db);
  const webhookEvents = new ShopifyAppWebhookEventStore(db);
  const admin = new ShopifyAdminClient(cfg);
  const catalog = new CatalogClient(cfg);
  const sync = new SyncService(cfg, admin, catalog, store);
  const worker = new ShopifyAppJobWorker(jobs, webhookEvents, sync, store);
  if (cfg.SHOPIFY_APP_WORKER_ENABLED) worker.start();

  return new Elysia()
    .use(cors({ origin: false }))
    .onError(({ error, set }) => {
      if (error instanceof ZodError) {
        set.status = 400;
        return { error: { code: 'validation_error', message: 'Invalid request', details: error.issues } };
      }
      if (error instanceof ShopifyApiError) {
        set.status = 502;
        return { error: { code: error.code, message: error.message } };
      }
      if (error instanceof CatalogClientError) {
        set.status = error.status >= 400 && error.status < 600 ? error.status : 502;
        return { error: { code: 'catalog_error', message: error.message, details: error.details } };
      }
      set.status = 500;
      return { error: { code: 'internal_error', message: error instanceof Error ? error.message : String(error) } };
    })
    .get('/health', () => ({
      ok: true,
      service: 'shopify-app',
      catalog_id: cfg.SHOPIFY_APP_CATALOG_ID,
      mock: cfg.SHOPIFY_APP_MOCK,
      app_url: cfg.SHOPIFY_APP_URL,
    }))
    .use(createOAuthRoutes({ cfg, admin, store, jobs, oauthStates }))
    .use(createWebhookRoutes({ cfg, jobs, webhookEvents }))
    .use(createEmbeddedRoutes({ cfg, store }))
    .use(createAdminRoutes({ cfg, sync, store }));
}
