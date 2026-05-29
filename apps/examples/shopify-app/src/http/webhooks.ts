/**
 * Webhook routes:
 *   POST /webhooks/products                  products/{create,update,delete}
 *   POST /webhooks/app/uninstalled           purge token + tombstone objects
 *   POST /webhooks/compliance/customers-data-request   GDPR
 *   POST /webhooks/compliance/customers-redact         GDPR
 *   POST /webhooks/compliance/shop-redact              GDPR (hard delete)
 *
 * Every route verifies X-Shopify-Hmac-Sha256 over the raw body before acting.
 * Product webhook failures return a retryable 5xx so Shopify re-delivers.
 */
import { Elysia } from 'elysia';
import type { ShopifyAppConfig } from '../config';
import { classifyProductTopic, pickWebhookHeaders, verifyWebhookHmac } from '../shopify/webhook-verify';
import type { SyncService } from '../services/sync-service';
import type { InstallationStore } from '../store/installation-store';

export interface WebhookDeps {
  cfg: ShopifyAppConfig;
  sync: SyncService;
  store: InstallationStore;
}

async function readRawAndVerify(request: Request, secret: string, mock: boolean) {
  const raw = await request.text();
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of request.headers.entries()) headers[k.toLowerCase()] = v;
  const meta = pickWebhookHeaders(headers);
  // In mock mode we skip HMAC (no secret); in real mode we require it.
  const verified = mock ? true : verifyWebhookHmac(raw, secret, meta.hmac);
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  return { raw, meta, verified, payload };
}

export function createWebhookRoutes(deps: WebhookDeps) {
  const secret = deps.cfg.SHOPIFY_APP_API_SECRET;
  const mock = deps.cfg.SHOPIFY_APP_MOCK;

  return new Elysia()
    // ── Product change feed ──────────────────────────────────────────────
    .post('/webhooks/products', async ({ request, set }) => {
      const { meta, verified, payload } = await readRawAndVerify(request, secret, mock);
      if (!verified) { set.status = 401; return { error: { code: 'invalid_hmac' } }; }
      const shop = meta.shopDomain;
      if (!shop) { set.status = 400; return { error: { code: 'missing_shop' } }; }

      const topic = classifyProductTopic(meta.topic);
      const productId = typeof payload.id === 'number'
        ? `gid://shopify/Product/${payload.id}`
        : typeof payload.id === 'string' ? payload.id : undefined;
      if (topic === 'unknown') return { ok: true, ignored: true, reason: meta.topic };
      if (!productId) { set.status = 400; return { error: { code: 'missing_product_id' } }; }

      try {
        const result = topic === 'products/delete'
          ? await deps.sync.syncTombstone(shop, productId)
          : await deps.sync.syncOne(shop, productId, 'webhook');
        return { ok: true, topic, shop, productId, result };
      } catch (err) {
        // Retryable: return 5xx so Shopify re-delivers (up to 48h).
        set.status = 503;
        return { ok: false, topic, shop, productId, retryable: true, error: err instanceof Error ? err.message : String(err) };
      }
    })

    // ── App uninstalled: token is already dead, just purge + tombstone ───
    .post('/webhooks/app/uninstalled', async ({ request, set }) => {
      const { meta, verified } = await readRawAndVerify(request, secret, mock);
      if (!verified) { set.status = 401; return { error: { code: 'invalid_hmac' } }; }
      const shop = meta.shopDomain;
      if (!shop) { set.status = 400; return { error: { code: 'missing_shop' } }; }
      await deps.store.markUninstalled(shop);
      await deps.store.recordRun(shop, { type: 'uninstall', status: 'succeeded', at: new Date().toISOString(), objects_synced: 0 });
      return { ok: true, shop, action: 'installation_token_purged' };
    })

    // ── Mandatory GDPR compliance webhooks ───────────────────────────────
    .post('/webhooks/compliance/customers-data-request', async ({ request, set }) => {
      const { verified, meta } = await readRawAndVerify(request, secret, mock);
      if (!verified) { set.status = 401; return { error: { code: 'invalid_hmac' } }; }
      // This app stores no customer PII (products only) — nothing to return.
      return { ok: true, shop: meta.shopDomain, note: 'no customer personal data stored by this app' };
    })
    .post('/webhooks/compliance/customers-redact', async ({ request, set }) => {
      const { verified, meta } = await readRawAndVerify(request, secret, mock);
      if (!verified) { set.status = 401; return { error: { code: 'invalid_hmac' } }; }
      return { ok: true, shop: meta.shopDomain, note: 'no customer personal data stored by this app' };
    })
    .post('/webhooks/compliance/shop-redact', async ({ request, set }) => {
      const { verified, meta } = await readRawAndVerify(request, secret, mock);
      if (!verified) { set.status = 401; return { error: { code: 'invalid_hmac' } }; }
      // Fires ~48h after uninstall: hard-delete everything we hold for the shop.
      if (meta.shopDomain) await deps.store.hardDelete(meta.shopDomain);
      return { ok: true, shop: meta.shopDomain, action: 'shop_data_erased' };
    });
}
