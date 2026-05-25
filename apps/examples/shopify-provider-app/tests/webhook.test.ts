import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createShopifyWebhookRoute } from '../src/http/webhooks';
import { classifyTopic, verifyShopifyHmac } from '../src/shopify/webhook';

describe('verifyShopifyHmac', () => {
  const secret = 'test_webhook_secret';
  const body = JSON.stringify({ id: 8001001, title: 'Heritage Wool Crewneck Sweater' });
  const validHmac = createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature → true', () => {
    expect(verifyShopifyHmac(body, secret, validHmac)).toBe(true);
  });
  test('wrong signature → false', () => {
    expect(verifyShopifyHmac(body, secret, 'nope==')).toBe(false);
  });
  test('empty signature → false', () => {
    expect(verifyShopifyHmac(body, secret, '')).toBe(false);
  });
  test('byte-different body → false', () => {
    const tampered = body + ' ';
    expect(verifyShopifyHmac(tampered, secret, validHmac)).toBe(false);
  });
});

describe('classifyTopic', () => {
  test('known topics', () => {
    expect(classifyTopic('products/create')).toBe('products/create');
    expect(classifyTopic('products/update')).toBe('products/update');
    expect(classifyTopic('products/delete')).toBe('products/delete');
  });
  test('unknown topic', () => {
    expect(classifyTopic('orders/create')).toBe('unknown');
    expect(classifyTopic(undefined)).toBe('unknown');
  });
});

describe('createShopifyWebhookRoute', () => {
  test('returns retryable non-2xx when webhook sync fails', async () => {
    const secret = 'test_webhook_secret';
    const body = JSON.stringify({ id: 8001001 });
    const hmac = createHmac('sha256', secret).update(body).digest('base64');
    const app = createShopifyWebhookRoute({
      cfg: {
        SHOPIFY_PROVIDER_WEBHOOK_SECRET: secret,
        SHOPIFY_PROVIDER_MOCK: false,
      } as any,
      sync: {
        syncOne: async () => {
          throw new Error('catalog unavailable');
        },
      } as any,
    });

    const res = await app.handle(new Request('http://localhost/webhooks/shopify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-topic': 'products/update',
        'x-shopify-hmac-sha256': hmac,
      },
      body,
    }));
    const payload = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(payload.ok).toBe(false);
    expect(payload.retryable).toBe(true);
  });
});
