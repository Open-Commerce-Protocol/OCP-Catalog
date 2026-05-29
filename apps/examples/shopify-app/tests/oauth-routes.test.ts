import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createOAuthRoutes } from '../src/http/oauth';
import { loadShopifyAppConfig } from '../src/config';

const secret = 'oauth_secret';

function hmac(params: Record<string, string>) {
  const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
  return createHmac('sha256', secret).update(message).digest('hex');
}

describe('createOAuthRoutes', () => {
  test('uses durable state store and rejects replayed callback state', async () => {
    const cfg = loadShopifyAppConfig({
      SHOPIFY_APP_API_KEY: 'client',
      SHOPIFY_APP_API_SECRET: secret,
      SHOPIFY_APP_ADMIN_KEY: 'admin_key_123',
      SHOPIFY_APP_CATALOG_API_KEY: 'catalog_key_123',
      SHOPIFY_APP_TOKEN_ENCRYPTION_KEY: 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      SHOPIFY_APP_URL: 'https://app.example.com',
      SHOPIFY_APP_WORKER_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    let storedState = '';
    let consumed = false;
    const oauthStates = {
      create: async () => {
        storedState = 'state_1';
        return storedState;
      },
      consume: async ({ state }: { state: string }) => {
        if (state !== storedState || consumed) return false;
        consumed = true;
        return true;
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: 'tok', scope: 'read_products' }), { status: 200 })) as typeof fetch;
    try {
      const app = createOAuthRoutes({
        cfg,
        oauthStates: oauthStates as any,
        jobs: { enqueue: async () => ({ id: 'job_1' }) } as any,
        admin: { shopProfile: async () => ({ name: 'Coffee', primaryDomain: 'coffee.myshopify.com', currencyCode: 'USD' }) } as any,
        store: { upsertInstall: async () => ({}) } as any,
      });

      const start = await app.handle(new Request('http://localhost/auth?shop=coffee.myshopify.com'));
      expect(start.status).toBe(302);
      expect(start.headers.get('location')).toContain('state=state_1');

      const base = { code: 'abc', shop: 'coffee.myshopify.com', state: 'state_1', timestamp: '1' };
      const callbackUrl = `http://localhost/auth/callback?${new URLSearchParams({ ...base, hmac: hmac(base) })}`;
      const first = await app.handle(new Request(callbackUrl));
      const replay = await app.handle(new Request(callbackUrl));

      expect(first.status).toBe(302);
      expect(replay.status).toBe(401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
