/**
 * Admin routes for ops/UI. Protected by x-admin-key. Drives all sync ops:
 *   register, sync/full, sync/delta, sync/one/:id, status.
 */
import { Elysia, t } from 'elysia';
import type { ShopifyProviderConfig } from '../config';
import type { RegistrationService } from '../services/registration-service';
import type { SyncService } from '../services/sync-service';
import type { StateStore } from '../services/state-store';

export interface AdminDeps {
  cfg: ShopifyProviderConfig;
  registration: RegistrationService;
  sync: SyncService;
  state: StateStore;
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
    .get('/status', async ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      const snapshot = await deps.state.snapshot();
      return {
        provider_id: deps.cfg.SHOPIFY_PROVIDER_ID,
        catalog_id: deps.cfg.SHOPIFY_PROVIDER_CATALOG_ID,
        mock: deps.cfg.SHOPIFY_PROVIDER_MOCK,
        store_domain: deps.cfg.SHOPIFY_PROVIDER_STORE_DOMAIN ?? null,
        api_version: deps.cfg.SHOPIFY_PROVIDER_API_VERSION,
        state: snapshot,
      };
    })
    .post('/register', async ({ headers, body, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      return deps.registration.register({ registrationVersion: body?.registration_version });
    }, {
      body: t.Optional(t.Object({ registration_version: t.Optional(t.Number()) })),
    })
    .post('/sync/full', async ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      return deps.sync.syncFull();
    })
    .post('/sync/delta', async ({ headers, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      return deps.sync.syncDelta();
    })
    .post('/sync/one/:productId', async ({ headers, params, set }) => {
      if (!isAuthorized(headers, deps.cfg.SHOPIFY_PROVIDER_ADMIN_KEY)) return unauthorized(set);
      return deps.sync.syncOne(params.productId);
    });
}
