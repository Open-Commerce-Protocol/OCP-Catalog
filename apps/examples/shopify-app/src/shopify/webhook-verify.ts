/**
 * Webhook delivery HMAC: base64( HMAC-SHA256(rawBody, appSecret) ) in the
 * X-Shopify-Hmac-Sha256 header. Must be computed over the exact raw bytes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookHeaders {
  hmac?: string;
  topic?: string;
  shopDomain?: string;
  webhookId?: string;
}

export function pickWebhookHeaders(raw: Record<string, string | undefined>): WebhookHeaders {
  return {
    hmac: raw['x-shopify-hmac-sha256'],
    topic: raw['x-shopify-topic'],
    shopDomain: raw['x-shopify-shop-domain'],
    webhookId: raw['x-shopify-webhook-id'],
  };
}

export function verifyWebhookHmac(rawBody: string | Uint8Array, secret: string, headerHmac: string | undefined): boolean {
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

export type ProductTopic = 'products/create' | 'products/update' | 'products/delete';

export function classifyProductTopic(topic: string | undefined): ProductTopic | 'unknown' {
  switch (topic) {
    case 'products/create':
    case 'products/update':
    case 'products/delete':
      return topic;
    default:
      return 'unknown';
  }
}
