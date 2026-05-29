/**
 * Subscribe a freshly-installed shop to the product + lifecycle webhooks via
 * the GraphQL `webhookSubscriptionCreate` mutation.
 *
 * (Compliance webhooks — customers/data_request, customers/redact, shop/redact
 * — are declared in shopify.app.toml and registered by Shopify at app config
 * level, not per-shop, so they are not created here.)
 */
import type { ShopifyAppConfig } from '../config';
import type { ShopifyAdminClient, ShopSession } from './admin-client';

const MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

/** Map of GraphQL topic enum → callback path on this app. */
const TOPICS: Array<{ topic: string; path: string }> = [
  { topic: 'PRODUCTS_CREATE', path: '/webhooks/products' },
  { topic: 'PRODUCTS_UPDATE', path: '/webhooks/products' },
  { topic: 'PRODUCTS_DELETE', path: '/webhooks/products' },
  { topic: 'APP_UNINSTALLED', path: '/webhooks/app/uninstalled' },
];

export interface WebhookSubscribeResult {
  topic: string;
  ok: boolean;
  id?: string;
  errors?: string[];
}

export async function subscribeWebhooks(
  cfg: ShopifyAppConfig,
  admin: ShopifyAdminClient,
  session: ShopSession,
): Promise<WebhookSubscribeResult[]> {
  if (cfg.SHOPIFY_APP_MOCK) {
    return TOPICS.map((t) => ({ topic: t.topic, ok: true, id: `mock_${t.topic}` }));
  }
  const base = cfg.SHOPIFY_APP_URL.replace(/\/$/, '');
  const out: WebhookSubscribeResult[] = [];
  for (const t of TOPICS) {
    try {
      const data = await admin.gql<{ webhookSubscriptionCreate: { webhookSubscription?: { id: string }; userErrors: Array<{ message: string }> } }>(
        session,
        MUTATION,
        { topic: t.topic, sub: { callbackUrl: `${base}${t.path}`, format: 'JSON' } },
      );
      const errs = data.webhookSubscriptionCreate.userErrors ?? [];
      // A duplicate subscription is a benign userError; treat as ok.
      const benign = errs.length > 0 && errs.every((e) => /already.*(subscribed|exists)/i.test(e.message));
      out.push({
        topic: t.topic,
        ok: errs.length === 0 || benign,
        id: data.webhookSubscriptionCreate.webhookSubscription?.id,
        errors: errs.length ? errs.map((e) => e.message) : undefined,
      });
    } catch (err) {
      out.push({ topic: t.topic, ok: false, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }
  return out;
}
