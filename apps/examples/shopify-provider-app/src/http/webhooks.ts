/**
 * Webhook endpoint for Shopify products/* events.
 *
 * Flow:
 *   1. Read raw body (HMAC needs byte-exact input).
 *   2. Verify X-Shopify-Hmac-Sha256 against SHOPIFY_PROVIDER_WEBHOOK_SECRET.
 *      Skipped if no secret is configured (dev convenience), but logged.
 *   3. Dispatch by X-Shopify-Topic:
 *        products/create | products/update → syncOne()
 *        products/delete                    → syncTombstone()
 *   4. Return 200 promptly so Shopify doesn't retry storm us.
 */
import { Elysia } from 'elysia';
import type { ShopifyProviderConfig } from '../config';
import { classifyTopic, pickShopifyWebhookHeaders, verifyShopifyHmac } from '../shopify/webhook';
import type { SyncService } from '../services/sync-service';

export interface WebhookDeps {
  cfg: ShopifyProviderConfig;
  sync: SyncService;
}

export function createShopifyWebhookRoute(deps: WebhookDeps) {
  return new Elysia().post('/webhooks/shopify', async ({ request, set }) => {
    const raw = await request.text();
    const headersRecord: Record<string, string | undefined> = {};
    for (const [k, v] of request.headers.entries()) headersRecord[k.toLowerCase()] = v;
    const meta = pickShopifyWebhookHeaders(headersRecord);

    if (deps.cfg.SHOPIFY_PROVIDER_WEBHOOK_SECRET) {
      if (!meta.hmac || !verifyShopifyHmac(raw, deps.cfg.SHOPIFY_PROVIDER_WEBHOOK_SECRET, meta.hmac)) {
        set.status = 401;
        return { error: { code: 'invalid_hmac', message: 'Shopify HMAC verification failed' } };
      }
    } else if (!deps.cfg.SHOPIFY_PROVIDER_MOCK) {
      // In real mode, refuse to silently accept unsigned webhooks.
      set.status = 401;
      return { error: { code: 'webhook_secret_missing', message: 'SHOPIFY_PROVIDER_WEBHOOK_SECRET not configured' } };
    }

    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch {
      set.status = 400;
      return { error: { code: 'invalid_json', message: 'Webhook body is not valid JSON' } };
    }

    const topic = classifyTopic(meta.topic);
    const productId: string | undefined = typeof payload.id === 'number'
      ? `gid://shopify/Product/${payload.id}`
      : typeof payload.id === 'string' ? payload.id : undefined;

    if (topic === 'unknown') {
      return { ok: true, ignored: true, reason: `Unsupported topic '${meta.topic ?? ''}'` };
    }
    if (!productId) {
      set.status = 400;
      return { error: { code: 'missing_product_id', message: 'Webhook payload has no product id' } };
    }

    try {
      const result = topic === 'products/delete'
        ? await deps.sync.syncTombstone(productId)
        : await deps.sync.syncOne(productId, 'webhook');
      return { ok: true, topic, productId, result };
    } catch (err) {
      // Still return 200 so Shopify doesn't retry on permanent errors; the
      // last_run on /admin/status will surface the failure to operators.
      return {
        ok: false,
        topic,
        productId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
