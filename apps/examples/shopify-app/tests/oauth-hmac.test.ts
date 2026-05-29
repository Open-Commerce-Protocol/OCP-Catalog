import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { isValidShopDomain, verifyQueryHmac } from '../src/oauth/hmac';
import { buildAuthorizeUrl } from '../src/oauth/token-exchange';
import { loadShopifyAppConfig } from '../src/config';

const secret = 'test_client_secret';

function signQuery(params: Record<string, string>): string {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHmac('sha256', secret).update(message).digest('hex');
}

describe('verifyQueryHmac (OAuth callback — hex)', () => {
  test('valid hmac passes', () => {
    const base = { code: 'abc', shop: 'foo.myshopify.com', state: 's1', timestamp: '123' };
    const hmac = signQuery(base);
    expect(verifyQueryHmac({ ...base, hmac }, secret)).toBe(true);
  });
  test('tampered param fails', () => {
    const base = { code: 'abc', shop: 'foo.myshopify.com', state: 's1', timestamp: '123' };
    const hmac = signQuery(base);
    expect(verifyQueryHmac({ ...base, shop: 'evil.myshopify.com', hmac }, secret)).toBe(false);
  });
  test('missing hmac fails', () => {
    expect(verifyQueryHmac({ shop: 'foo.myshopify.com' }, secret)).toBe(false);
  });
  test('signature param is excluded from the signed message', () => {
    const base = { code: 'abc', shop: 'foo.myshopify.com', state: 's1' };
    const hmac = signQuery(base);
    expect(verifyQueryHmac({ ...base, signature: 'xyz', hmac }, secret)).toBe(true);
  });
});

describe('isValidShopDomain', () => {
  test('accepts real myshopify domains', () => {
    expect(isValidShopDomain('coffee.myshopify.com')).toBe(true);
    expect(isValidShopDomain('mds0my-wh.myshopify.com')).toBe(true);
  });
  test('rejects junk / injection', () => {
    expect(isValidShopDomain('evil.com')).toBe(false);
    expect(isValidShopDomain('foo.myshopify.com.evil.com')).toBe(false);
    expect(isValidShopDomain('')).toBe(false);
    expect(isValidShopDomain(undefined)).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  test('builds the authorize redirect with client_id, scope, redirect_uri, state', () => {
    const cfg = loadShopifyAppConfig({
      SHOPIFY_APP_API_KEY: 'ck_123',
      SHOPIFY_APP_SCOPES: 'read_products,read_inventory',
      SHOPIFY_APP_URL: 'https://app.example.com',
    } as NodeJS.ProcessEnv);
    const url = buildAuthorizeUrl(cfg, 'foo.myshopify.com', 'nonce1');
    expect(url.startsWith('https://foo.myshopify.com/admin/oauth/authorize?')).toBe(true);
    expect(url).toContain('client_id=ck_123');
    expect(url).toContain('scope=read_products%2Cread_inventory');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback');
    expect(url).toContain('state=nonce1');
  });
});
