import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { ZodError } from 'zod';
import type { WcProviderConfig } from './config';
import { createAdminRoutes } from './http/admin';
import { createWcWebhookRoute } from './http/webhooks';
import { CatalogClient, CatalogClientError } from './services/catalog-client';
import { RegistrationService } from './services/registration-service';
import { StateStore } from './services/state-store';
import { SyncService } from './services/sync-service';
import { WcApiError, WcRestClient } from './woocommerce/rest-client';

export async function createWcProviderApp(deps: { cfg: WcProviderConfig }) {
  const wc = new WcRestClient(deps.cfg);
  const catalog = new CatalogClient(deps.cfg);
  const state = new StateStore(deps.cfg.WC_PROVIDER_STATE_FILE);
  await state.load();

  const registration = new RegistrationService(deps.cfg, wc, catalog, state);
  const sync = new SyncService(deps.cfg, wc, catalog, state);

  return new Elysia()
    .use(cors())
    .onError(({ error, set }) => {
      if (error instanceof ZodError) {
        set.status = 400;
        return { error: { code: 'validation_error', message: 'Invalid request', details: error.issues } };
      }
      if (error instanceof WcApiError) {
        set.status = error.status >= 400 && error.status < 600 ? error.status : 502;
        return { error: { code: 'wc_error', message: error.message } };
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
      service: 'woocommerce-provider-app',
      provider_id: deps.cfg.WC_PROVIDER_ID,
      catalog_id: deps.cfg.WC_PROVIDER_CATALOG_ID,
      mock: deps.cfg.WC_PROVIDER_MOCK,
    }))
    .use(createAdminRoutes({ cfg: deps.cfg, registration, sync, state }))
    .use(createWcWebhookRoute({ cfg: deps.cfg, sync }));
}
