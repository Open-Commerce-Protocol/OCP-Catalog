/**
 * Verify WooCommerce webhook signatures.
 *
 * WC computes base64( HMAC-SHA256(rawBody, webhookSecret) ) and sends it as
 * the `X-WC-Webhook-Signature` header. Verification must use the raw body
 * bytes for byte-exact equality.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WcWebhookHeaders {
  signature?: string;
  topic?: string;
  source?: string;
  delivery?: string;
}

export function pickWcWebhookHeaders(raw: Record<string, string | undefined>): WcWebhookHeaders {
  return {
    signature: raw['x-wc-webhook-signature'],
    topic: raw['x-wc-webhook-topic'],
    source: raw['x-wc-webhook-source'],
    delivery: raw['x-wc-webhook-delivery-id'],
  };
}

export function verifyWcSignature(rawBody: string | Uint8Array, secret: string, headerSignature: string): boolean {
  if (!headerSignature) return false;
  const computed = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody))
    .digest('base64');
  return constantTimeEquals(computed, headerSignature);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export type SupportedWcTopic = 'product.created' | 'product.updated' | 'product.deleted';

export function classifyWcTopic(topic: string | undefined): SupportedWcTopic | 'unknown' {
  switch (topic) {
    case 'product.created':
    case 'product.updated':
    case 'product.deleted':
      return topic;
    default:
      return 'unknown';
  }
}
