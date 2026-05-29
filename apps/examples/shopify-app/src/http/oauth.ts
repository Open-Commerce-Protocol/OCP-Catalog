/**
 * OAuth install + callback routes (legacy authorization-code grant, which is
 * fully supported for server-side apps).
 *
 *   GET /auth?shop=foo.myshopify.com
 *     → validate shop, mint state nonce, 302 to Shopify authorize URL
 *   GET /auth/callback?code&hmac&shop&state&timestamp
 *     → verify query HMAC + state, exchange code→token, persist install,
 *       subscribe webhooks, optionally kick a full sync, redirect to app UI
 */
import { Elysia } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import { isValidShopDomain, verifyQueryHmac } from '../oauth/hmac';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../oauth/token-exchange';
import type { ShopifyAdminClient } from '../shopify/admin-client';
import { subscribeWebhooks } from '../shopify/webhook-subscribe';
import type { InstallationStore } from '../store/installation-store';
import type { SyncService } from '../services/sync-service';

export interface OAuthDeps {
  cfg: ShopifyAppConfig;
  admin: ShopifyAdminClient;
  store: InstallationStore;
  sync: SyncService;
  nonces: Set<string>;
}

export function createOAuthRoutes(deps: OAuthDeps) {
  const { cfg } = deps;

  return new Elysia()
    .get('/auth', ({ query, set }) => {
      const shop = query.shop;
      if (!isValidShopDomain(shop)) {
        set.status = 400;
        return { error: { code: 'invalid_shop', message: 'shop must be a *.myshopify.com domain' } };
      }
      const state = crypto.randomUUID();
      deps.nonces.add(state);
      set.status = 302;
      set.headers['location'] = buildAuthorizeUrl(cfg, shop, state);
      return '';
    })
    .get('/auth/callback', async ({ query, set }) => {
      const q = query as Record<string, string>;
      if (!isValidShopDomain(q.shop)) {
        set.status = 400;
        return { error: { code: 'invalid_shop', message: 'invalid shop param' } };
      }
      if (!verifyQueryHmac(q, cfg.SHOPIFY_APP_API_SECRET)) {
        set.status = 401;
        return { error: { code: 'invalid_hmac', message: 'OAuth callback HMAC verification failed' } };
      }
      if (!q.state || !deps.nonces.has(q.state)) {
        set.status = 401;
        return { error: { code: 'invalid_state', message: 'state nonce missing or unknown' } };
      }
      deps.nonces.delete(q.state);
      if (!q.code) {
        set.status = 400;
        return { error: { code: 'missing_code', message: 'authorization code missing' } };
      }

      // 1. code → offline access token
      const token = await exchangeCodeForToken(cfg, q.shop, q.code);

      // 2. persist installation
      const session = { shopDomain: q.shop, accessToken: token.access_token };
      const shopProfile = await deps.admin.shopProfile(session).catch(() => null);
      await deps.store.upsertInstall({
        shopDomain: q.shop,
        accessToken: token.access_token,
        scope: token.scope,
        apiVersion: cfg.SHOPIFY_APP_API_VERSION,
        shopProfile: shopProfile ? { ...shopProfile } : {},
      });

      // 3. subscribe product + lifecycle webhooks
      const webhooks = await subscribeWebhooks(cfg, deps.admin, session);

      // 4. register with the OCP catalog and (optionally) run a first full sync
      let registrationVersion: number | null = null;
      let firstSync: unknown = null;
      try {
        registrationVersion = await deps.sync.register(q.shop);
        if (cfg.SHOPIFY_APP_SYNC_ON_INSTALL) {
          firstSync = await deps.sync.syncFull(q.shop);
        }
      } catch (err) {
        await deps.store.recordRun(q.shop, {
          type: 'install',
          status: 'failed',
          at: new Date().toISOString(),
          objects_synced: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 5. redirect into the embedded app UI
      set.status = 302;
      set.headers['location'] = `${cfg.SHOPIFY_APP_URL.replace(/\/$/, '')}/app?shop=${encodeURIComponent(q.shop)}&installed=1`;
      return {
        ok: true,
        shop: q.shop,
        scope: token.scope,
        webhooks,
        registration_version: registrationVersion,
        first_sync: firstSync,
      };
    });
}
