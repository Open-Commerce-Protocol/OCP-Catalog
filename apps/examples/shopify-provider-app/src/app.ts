import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { ShopifyProviderConfig } from './config';
import { createAdminRoutes } from './http/admin';
import { createShopifyWebhookRoute } from './http/webhooks';
import { CatalogClient, CatalogClientError } from './services/catalog-client';
import { RegistrationService } from './services/registration-service';
import { StateStore } from './services/state-store';
import { SyncService } from './services/sync-service';
import { ShopifyAdminClient, ShopifyApiError } from './shopify/admin-client';

export interface AppDeps {
  cfg: ShopifyProviderConfig;
}

export async function createShopifyProviderApp(deps: AppDeps) {
  const admin = new ShopifyAdminClient(deps.cfg);
  const catalog = new CatalogClient(deps.cfg);
  const state = new StateStore(deps.cfg.SHOPIFY_PROVIDER_STATE_FILE);
  await state.load();

  const registration = new RegistrationService(deps.cfg, admin, catalog, state);
  const sync = new SyncService(deps.cfg, admin, catalog, state);

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
      return {
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    })
    .get('/health', () => ({
      ok: true,
      service: 'shopify-provider-app',
      provider_id: deps.cfg.SHOPIFY_PROVIDER_ID,
      catalog_id: deps.cfg.SHOPIFY_PROVIDER_CATALOG_ID,
      mock: deps.cfg.SHOPIFY_PROVIDER_MOCK,
    }))
    .use(createAdminRoutes({ cfg: deps.cfg, registration, sync, state }))
    .use(createShopifyWebhookRoute({ cfg: deps.cfg, sync }));
}
