/**
 * Operator-facing maintenance routes (x-admin-key). These are NOT part of the
 * merchant-facing flow; they let ops trigger sync, inspect installs, or seed a
 * shop record manually (used in tests / local real-token runs without OAuth).
 */
import { Elysia, t } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import type { SyncService } from '../services/sync-service';
import type { InstallationStore } from '../store/installation-store';

export interface AdminDeps {
  cfg: ShopifyAppConfig;
  sync: SyncService;
  store: InstallationStore;
}

function authed(headers: Record<string, string | undefined>, expected: string): boolean {
  return headers['x-admin-key'] === expected;
}
function unauthorized(set: { status?: number | string }) {
  set.status = 401;
  return { error: { code: 'unauthorized', message: 'Invalid or missing x-admin-key' } };
}

export function createAdminRoutes(deps: AdminDeps) {
  const key = deps.cfg.SHOPIFY_APP_ADMIN_KEY;
  return new Elysia({ prefix: '/admin' })
    .get('/installations', async ({ headers, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      const rows = await deps.store.listActive();
      return {
        count: rows.length,
        installations: rows.map((r) => ({
          shop_domain: r.shopDomain,
          provider_id: r.providerId,
          status: r.status,
          active_registration_version: r.activeRegistrationVersion,
          last_synced_at: r.lastSyncedAt,
          last_run: r.lastRun,
          scope: r.scope,
          installed_at: r.installedAt,
        })),
      };
    })
    .get('/status/:shop', async ({ headers, params, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      const row = await deps.store.get(params.shop);
      if (!row) { set.status = 404; return { error: { code: 'not_found', message: `no installation for ${params.shop}` } }; }
      return {
        shop_domain: row.shopDomain,
        provider_id: row.providerId,
        status: row.status,
        active_registration_version: row.activeRegistrationVersion,
        last_synced_at: row.lastSyncedAt,
        last_run: row.lastRun,
        mock: deps.cfg.SHOPIFY_APP_MOCK,
      };
    })
    // Seed an installation without going through OAuth — for local runs with a
    // pre-obtained custom-app token (e.g. the COFFEECONCEPT dev token), and for
    // tests. Body: { shop_domain, access_token, scope?, api_version? }.
    .post('/installations/seed', async ({ headers, body, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      const row = await deps.store.upsertInstall({
        shopDomain: body.shop_domain,
        accessToken: body.access_token,
        scope: body.scope ?? deps.cfg.SHOPIFY_APP_SCOPES,
        apiVersion: body.api_version ?? deps.cfg.SHOPIFY_APP_API_VERSION,
      });
      return { ok: true, shop_domain: row.shopDomain, provider_id: row.providerId, status: row.status };
    }, {
      body: t.Object({
        shop_domain: t.String(),
        access_token: t.String(),
        scope: t.Optional(t.String()),
        api_version: t.Optional(t.String()),
      }),
    })
    .post('/register/:shop', async ({ headers, params, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      const version = await deps.sync.register(params.shop);
      return { ok: true, shop: params.shop, registration_version: version };
    })
    .post('/sync/full/:shop', async ({ headers, params, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      return deps.sync.syncFull(params.shop);
    })
    .post('/sync/delta/:shop', async ({ headers, params, set }) => {
      if (!authed(headers, key)) return unauthorized(set);
      return deps.sync.syncDelta(params.shop);
    });
}
