import { z } from 'zod';

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'))
  .pipe(z.boolean().optional());

const emptyToUndefined = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

const optionalStringFromEnv = emptyToUndefined.pipe(z.string().optional());

const configSchema = z.object({
  // Provider identity (used in ProviderRegistration sent to the catalog).
  SHOPIFY_PROVIDER_ID: z.string().min(1).default('shopify_provider_local_dev'),
  SHOPIFY_PROVIDER_DISPLAY_NAME: z.string().min(1).default('Shopify Merchant (local dev)'),
  SHOPIFY_PROVIDER_CONTACT_EMAIL: optionalStringFromEnv.default('ops@example.test'),
  SHOPIFY_PROVIDER_PORT: z.coerce.number().int().positive().default(4400),
  SHOPIFY_PROVIDER_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4400'),
  SHOPIFY_PROVIDER_ADMIN_KEY: z.string().min(8).default('dev-shopify-provider-admin-key'),

  // Shopify Admin API configuration.
  SHOPIFY_PROVIDER_MOCK: booleanFromEnv.default(true),
  SHOPIFY_PROVIDER_STORE_DOMAIN: optionalStringFromEnv,
  SHOPIFY_PROVIDER_ACCESS_TOKEN: optionalStringFromEnv,
  SHOPIFY_PROVIDER_API_VERSION: z.string().min(1).default('2025-10'),
  SHOPIFY_PROVIDER_DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  SHOPIFY_PROVIDER_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(50),
  SHOPIFY_PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),

  // Webhook HMAC secret. Required when handling real Shopify webhook traffic.
  SHOPIFY_PROVIDER_WEBHOOK_SECRET: optionalStringFromEnv,

  // OCP catalog (target) configuration.
  SHOPIFY_PROVIDER_CATALOG_BASE_URL: z.string().url().default('http://localhost:4000'),
  SHOPIFY_PROVIDER_CATALOG_ID: z.string().min(1).default('cat_local_dev'),
  SHOPIFY_PROVIDER_CATALOG_API_KEY: z.string().min(1).default('dev-api-key'),

  // Persistence (registration version + last_synced_at cursor).
  SHOPIFY_PROVIDER_STATE_FILE: optionalStringFromEnv,
});

export type ShopifyProviderConfig = z.infer<typeof configSchema> & {
  SHOPIFY_PROVIDER_GRAPHQL_URL: string;
};

export function loadShopifyProviderConfig(env: NodeJS.ProcessEnv = process.env): ShopifyProviderConfig {
  const parsed = configSchema.parse(env);

  if (!parsed.SHOPIFY_PROVIDER_MOCK) {
    if (!parsed.SHOPIFY_PROVIDER_STORE_DOMAIN) {
      throw new Error('SHOPIFY_PROVIDER_MOCK=false requires SHOPIFY_PROVIDER_STORE_DOMAIN');
    }
    if (!parsed.SHOPIFY_PROVIDER_ACCESS_TOKEN) {
      throw new Error('SHOPIFY_PROVIDER_MOCK=false requires SHOPIFY_PROVIDER_ACCESS_TOKEN');
    }
  }

  const graphqlUrl = parsed.SHOPIFY_PROVIDER_STORE_DOMAIN
    ? `https://${parsed.SHOPIFY_PROVIDER_STORE_DOMAIN}/admin/api/${parsed.SHOPIFY_PROVIDER_API_VERSION}/graphql.json`
    : 'mock://shopify-admin-graphql';

  return { ...parsed, SHOPIFY_PROVIDER_GRAPHQL_URL: graphqlUrl };
}
