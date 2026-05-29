/**
 * Exchange an OAuth authorization `code` for an offline access token.
 * POST https://{shop}/admin/oauth/access_token
 *   { client_id, client_secret, code } → { access_token, scope }
 */
import type { ShopifyAppConfig } from '../config';

export interface AccessTokenResult {
  access_token: string;
  scope: string;
}

export async function exchangeCodeForToken(
  cfg: ShopifyAppConfig,
  shopDomain: string,
  code: string,
): Promise<AccessTokenResult> {
  const url = `https://${shopDomain}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.SHOPIFY_APP_API_KEY,
      client_secret: cfg.SHOPIFY_APP_API_SECRET,
      code,
    }),
    signal: AbortSignal.timeout(cfg.SHOPIFY_APP_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 300);
    throw new Error(`Token exchange failed: HTTP ${res.status} ${snippet}`);
  }
  const data = (await res.json()) as Partial<AccessTokenResult>;
  if (!data.access_token) throw new Error('Token exchange response missing access_token');
  return { access_token: data.access_token, scope: data.scope ?? '' };
}

/** Build the install/authorize redirect URL. */
export function buildAuthorizeUrl(
  cfg: ShopifyAppConfig,
  shopDomain: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: cfg.SHOPIFY_APP_API_KEY,
    scope: cfg.scopeList.join(','),
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}
