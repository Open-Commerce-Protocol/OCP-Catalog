/**
 * OAuth install + callback routes (legacy authorization-code grant, which is
 * fully supported for server-side apps).
 *
 *   GET /auth?shop=foo.myshopify.com
 *     → validate shop, mint state nonce, 302 to Shopify authorize URL
 *   GET /auth/callback?code&hmac&shop&state&timestamp
 *     → verify query HMAC + state, exchange code→token, persist install,
 *       queue install sync, redirect to app UI
 */
import { Elysia } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import { isValidShopDomain, verifyQueryHmac } from '../oauth/hmac';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../oauth/token-exchange';
import type { ShopifyAdminClient } from '../shopify/admin-client';
import type { InstallationStore } from '../store/installation-store';
import type { ShopifyAppJobStore } from '../store/job-store';
import type { OAuthStateStore } from '../store/oauth-state-store';

export interface OAuthDeps {
  cfg: ShopifyAppConfig;
  admin: ShopifyAdminClient;
  store: InstallationStore;
  jobs: ShopifyAppJobStore;
  oauthStates: OAuthStateStore;
}

export function createOAuthRoutes(deps: OAuthDeps) {
  const { cfg } = deps;

  return new Elysia()
    .get('/auth', async ({ query, set }) => {
      const shop = query.shop;
      if (!isValidShopDomain(shop)) {
        set.status = 400;
        return { error: { code: 'invalid_shop', message: 'shop must be a *.myshopify.com domain' } };
      }
      const state = await deps.oauthStates.create(shop);
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
      if (!q.state || !await deps.oauthStates.consume({ state: q.state, shopDomain: q.shop })) {
        set.status = 401;
        return { error: { code: 'invalid_state', message: 'state nonce missing or unknown' } };
      }
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

      // 3. enqueue registration + first full sync outside the OAuth request path.
      let installJob: string | null = null;
      if (cfg.SHOPIFY_APP_SYNC_ON_INSTALL) {
        const job = await deps.jobs.enqueue({
          id: `install_${q.shop.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`,
          shopDomain: q.shop,
          type: 'install_sync',
          payload: { source: 'oauth_callback' },
        });
        installJob = job.id;
      }

      // 4. redirect into the embedded app UI
      set.status = 302;
      set.headers['location'] = `${cfg.SHOPIFY_APP_URL.replace(/\/$/, '')}/app?shop=${encodeURIComponent(q.shop)}&installed=1`;
      return {
        ok: true,
        shop: q.shop,
        scope: token.scope,
        install_job_id: installJob,
      };
    });
}
