/**
 * Verify Shopify webhook HMAC signatures.
 *
 * Shopify computes base64( HMAC-SHA256(rawBody, webhookSecret) ) and sends
 * it as the `X-Shopify-Hmac-Sha256` header. We must validate against the
 * raw body bytes (not the parsed JSON) for byte-exact equality.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ShopifyWebhookHeaders {
  hmac?: string;
  topic?: string;
  shopDomain?: string;
  webhookId?: string;
}

export function pickShopifyWebhookHeaders(raw: Record<string, string | undefined>): ShopifyWebhookHeaders {
  return {
    hmac: raw['x-shopify-hmac-sha256'] ?? raw['X-Shopify-Hmac-Sha256'.toLowerCase()],
    topic: raw['x-shopify-topic'],
    shopDomain: raw['x-shopify-shop-domain'],
    webhookId: raw['x-shopify-webhook-id'],
  };
}

export function verifyShopifyHmac(rawBody: string | Uint8Array, secret: string, headerHmac: string): boolean {
  if (!headerHmac) return false;
  const computed = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody))
    .digest('base64');
  return constantTimeEquals(computed, headerHmac);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Topics we know how to handle. */
export type SupportedShopifyTopic =
  | 'products/create'
  | 'products/update'
  | 'products/delete';

export function classifyTopic(topic: string | undefined): SupportedShopifyTopic | 'unknown' {
  switch (topic) {
    case 'products/create':
    case 'products/update':
    case 'products/delete':
      return topic;
    default:
      return 'unknown';
  }
}
