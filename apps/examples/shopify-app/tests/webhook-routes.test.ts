import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWebhookRoutes } from '../src/http/webhooks';

const secret = 'route_secret';

function signedRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/webhooks/products', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-topic': 'products/update',
      'x-shopify-shop-domain': 'coffee.myshopify.com',
      'x-shopify-webhook-id': 'wh_1',
      'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64'),
      ...headers,
    },
    body,
  });
}

describe('createWebhookRoutes', () => {
  test('rejects invalid HMAC without enqueueing work', async () => {
    const jobs = { enqueue: async () => { throw new Error('should not enqueue'); } };
    const webhookEvents = { recordAndEnqueue: async () => { throw new Error('should not persist'); } };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });

    const res = await app.handle(signedRequest(JSON.stringify({ id: 9001 }), { 'x-shopify-hmac-sha256': 'bad==' }));
    expect(res.status).toBe(401);
  });

  test('valid product webhook is persisted and queued once by webhook id', async () => {
    let seen = false;
    const jobs = {};
    const webhookEvents = {
      recordAndEnqueue: async (input: Record<string, any>) => {
        expect(input.job.type).toBe('product_sync_one');
        expect(input.job.payload.product_id).toBe('gid://shopify/Product/9001');
        expect(input.job.payload.webhook_event_id).toBeUndefined();
        if (seen) return { event: { id: 'event_1' }, duplicate: true, queued: false };
        seen = true;
        return { event: { id: 'event_1' }, duplicate: false, queued: true };
      },
    };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });
    const body = JSON.stringify({ id: 9001 });

    const first = await app.handle(signedRequest(body));
    const second = await app.handle(signedRequest(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ duplicate: false, queued: true });
    expect(await second.json()).toMatchObject({ duplicate: true, queued: false });
  });

  test('duplicate webhook can repair a missing job instead of swallowing retry', async () => {
    const jobs = {};
    const webhookEvents = {
      recordAndEnqueue: async () => ({ event: { id: 'event_1' }, duplicate: true, queued: true }),
    };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });

    const res = await app.handle(signedRequest(JSON.stringify({ id: 9001 })));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, queued: true });
  });

  test('event/job persistence failures return retryable 503', async () => {
    const jobs = {};
    const webhookEvents = {
      recordAndEnqueue: async () => { throw new Error('transaction failed'); },
    };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });

    const res = await app.handle(signedRequest(JSON.stringify({ id: 9001 })));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: true, error: 'transaction failed' });
  });

  test('lifecycle persistence failures return retryable 503', async () => {
    const jobs = {};
    const webhookEvents = {
      recordAndEnqueue: async () => { throw new Error('transaction failed'); },
    };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });
    const body = JSON.stringify({ shop_domain: 'coffee.myshopify.com' });
    const hmac = createHmac('sha256', secret).update(body).digest('base64');

    const res = await app.handle(new Request('http://localhost/webhooks/compliance/shop-redact', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-topic': 'shop/redact',
        'x-shopify-shop-domain': 'coffee.myshopify.com',
        'x-shopify-webhook-id': 'wh_redact_1',
        'x-shopify-hmac-sha256': hmac,
      },
      body,
    }));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: true, error: 'transaction failed' });
  });

  test('lifecycle webhooks require Shopify webhook id for idempotency', async () => {
    const jobs = { enqueue: async () => ({ id: 'job' }) };
    const webhookEvents = { recordAndEnqueue: async () => ({ event: { id: 'event' }, duplicate: false, queued: true }) };
    const app = createWebhookRoutes({ cfg: { SHOPIFY_APP_API_SECRET: secret, SHOPIFY_APP_MOCK: false } as any, jobs: jobs as any, webhookEvents: webhookEvents as any });
    const body = JSON.stringify({ shop_domain: 'coffee.myshopify.com' });
    const hmac = createHmac('sha256', secret).update(body).digest('base64');

    const res = await app.handle(new Request('http://localhost/webhooks/app/uninstalled', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-topic': 'app/uninstalled',
        'x-shopify-shop-domain': 'coffee.myshopify.com',
        'x-shopify-hmac-sha256': hmac,
      },
      body,
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'missing_webhook_id' } });
  });
});
