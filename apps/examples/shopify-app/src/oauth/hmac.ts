/**
 * Shopify OAuth + request HMAC helpers.
 *
 * Two *different* HMAC schemes exist in Shopify and they are easy to confuse:
 *
 *  - OAuth callback / App Bridge query params: HMAC-SHA256 over the sorted
 *    query string, hex-encoded, key = app client secret. (verifyQueryHmac)
 *  - Webhook delivery: HMAC-SHA256 over the raw request body, base64-encoded,
 *    sent in the X-Shopify-Hmac-Sha256 header. (see ../shopify/webhook-verify.ts)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify the `hmac` query param Shopify appends to OAuth/redirect requests. */
export function verifyQueryHmac(query: Record<string, string>, secret: string): boolean {
  const provided = query.hmac;
  if (!provided) return false;
  // Build the message: every param except `hmac` (and `signature`), sorted,
  // joined as key=value with `&`.
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  const computed = createHmac('sha256', secret).update(message).digest('hex');
  return constantTimeEquals(computed, provided);
}

/** Shopify shop-domain validation — must be a real *.myshopify.com host. */
export function isValidShopDomain(shop: string | undefined): shop is string {
  if (!shop) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
