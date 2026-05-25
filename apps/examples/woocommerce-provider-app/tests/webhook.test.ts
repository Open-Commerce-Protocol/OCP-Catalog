import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWcWebhookRoute } from '../src/http/webhooks';
import { classifyWcTopic, verifyWcSignature } from '../src/woocommerce/webhook';

describe('verifyWcSignature', () => {
  const secret = 'wc_test_secret';
  const body = JSON.stringify({ id: 901, name: 'Cotton Apron — Olive' });
  const valid = createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature → true', () => {
    expect(verifyWcSignature(body, secret, valid)).toBe(true);
  });
  test('wrong signature → false', () => {
    expect(verifyWcSignature(body, secret, 'nope==')).toBe(false);
  });
  test('byte-different body → false', () => {
    expect(verifyWcSignature(body + ' ', secret, valid)).toBe(false);
  });
});

describe('classifyWcTopic', () => {
  test('known topics', () => {
    expect(classifyWcTopic('product.created')).toBe('product.created');
    expect(classifyWcTopic('product.updated')).toBe('product.updated');
    expect(classifyWcTopic('product.deleted')).toBe('product.deleted');
  });
  test('unknown', () => {
    expect(classifyWcTopic('order.created')).toBe('unknown');
    expect(classifyWcTopic(undefined)).toBe('unknown');
  });
});

describe('createWcWebhookRoute', () => {
  test('returns retryable non-2xx when webhook sync fails', async () => {
    const secret = 'wc_test_secret';
    const body = JSON.stringify({ id: 901 });
    const signature = createHmac('sha256', secret).update(body).digest('base64');
    const app = createWcWebhookRoute({
      cfg: {
        WC_PROVIDER_WEBHOOK_SECRET: secret,
        WC_PROVIDER_MOCK: false,
      } as any,
      sync: {
        syncOne: async () => {
          throw new Error('catalog unavailable');
        },
      } as any,
    });

    const res = await app.handle(new Request('http://localhost/webhooks/woocommerce', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wc-webhook-topic': 'product.updated',
        'x-wc-webhook-signature': signature,
      },
      body,
    }));
    const payload = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(payload.ok).toBe(false);
    expect(payload.retryable).toBe(true);
  });
});
