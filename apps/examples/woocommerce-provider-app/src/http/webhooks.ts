import { Elysia } from 'elysia';
import type { WcProviderConfig } from '../config';
import type { SyncService } from '../services/sync-service';
import { classifyWcTopic, pickWcWebhookHeaders, verifyWcSignature } from '../woocommerce/webhook';

export interface WebhookDeps {
  cfg: WcProviderConfig;
  sync: SyncService;
}

export function createWcWebhookRoute(deps: WebhookDeps) {
  return new Elysia().post('/webhooks/woocommerce', async ({ request, set }) => {
    const raw = await request.text();
    const headersRecord: Record<string, string | undefined> = {};
    for (const [k, v] of request.headers.entries()) headersRecord[k.toLowerCase()] = v;
    const meta = pickWcWebhookHeaders(headersRecord);

    if (deps.cfg.WC_PROVIDER_WEBHOOK_SECRET) {
      if (!meta.signature || !verifyWcSignature(raw, deps.cfg.WC_PROVIDER_WEBHOOK_SECRET, meta.signature)) {
        set.status = 401;
        return { error: { code: 'invalid_signature', message: 'WooCommerce HMAC verification failed' } };
      }
    } else if (!deps.cfg.WC_PROVIDER_MOCK) {
      set.status = 401;
      return { error: { code: 'webhook_secret_missing', message: 'WC_PROVIDER_WEBHOOK_SECRET not configured' } };
    }

    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch {
      set.status = 400;
      return { error: { code: 'invalid_json', message: 'Webhook body is not valid JSON' } };
    }

    const topic = classifyWcTopic(meta.topic);
    const productId = typeof payload.id === 'number' ? payload.id : Number.parseInt(String(payload.id ?? ''), 10);
    if (topic === 'unknown') {
      return { ok: true, ignored: true, reason: `Unsupported topic '${meta.topic ?? ''}'` };
    }
    if (!Number.isFinite(productId) || productId <= 0) {
      set.status = 400;
      return { error: { code: 'missing_product_id', message: 'Webhook payload has no product id' } };
    }

    try {
      const result = topic === 'product.deleted'
        ? await deps.sync.syncTombstone(productId)
        : await deps.sync.syncOne(productId, 'webhook');
      return { ok: true, topic, productId, result };
    } catch (err) {
      set.status = 502;
      return { ok: false, topic, productId, retryable: true, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
