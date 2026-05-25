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
  WC_PROVIDER_ID: z.string().min(1).default('wc_provider_local_dev'),
  WC_PROVIDER_DISPLAY_NAME: z.string().min(1).default('WooCommerce Merchant (local dev)'),
  WC_PROVIDER_CONTACT_EMAIL: optionalStringFromEnv.default('ops@example.test'),
  WC_PROVIDER_PORT: z.coerce.number().int().positive().default(4410),
  WC_PROVIDER_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4410'),
  WC_PROVIDER_ADMIN_KEY: z.string().min(8).default('dev-wc-provider-admin-key'),

  WC_PROVIDER_MOCK: booleanFromEnv.default(true),
  WC_PROVIDER_SITE_URL: optionalStringFromEnv,
  WC_PROVIDER_CONSUMER_KEY: optionalStringFromEnv,
  WC_PROVIDER_CONSUMER_SECRET: optionalStringFromEnv,
  WC_PROVIDER_AUTH_MODE: z.enum(['basic', 'query_string']).default('basic'),
  WC_PROVIDER_API_VERSION: z.string().min(1).default('wc/v3'),
  WC_PROVIDER_DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  WC_PROVIDER_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  WC_PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),

  WC_PROVIDER_WEBHOOK_SECRET: optionalStringFromEnv,

  WC_PROVIDER_CATALOG_BASE_URL: z.string().url().default('http://localhost:4000'),
  WC_PROVIDER_CATALOG_ID: z.string().min(1).default('cat_local_dev'),
  WC_PROVIDER_CATALOG_API_KEY: z.string().min(1).default('dev-api-key'),

  WC_PROVIDER_STATE_FILE: optionalStringFromEnv,
});

export type WcProviderConfig = z.infer<typeof configSchema>;

export function loadWcProviderConfig(env: NodeJS.ProcessEnv = process.env): WcProviderConfig {
  const parsed = configSchema.parse(env);
  if (!parsed.WC_PROVIDER_MOCK) {
    if (!parsed.WC_PROVIDER_SITE_URL) {
      throw new Error('WC_PROVIDER_MOCK=false requires WC_PROVIDER_SITE_URL');
    }
    if (!parsed.WC_PROVIDER_CONSUMER_KEY || !parsed.WC_PROVIDER_CONSUMER_SECRET) {
      throw new Error('WC_PROVIDER_MOCK=false requires WC_PROVIDER_CONSUMER_KEY and WC_PROVIDER_CONSUMER_SECRET');
    }
    const siteUrl = new URL(parsed.WC_PROVIDER_SITE_URL);
    if (siteUrl.protocol !== 'https:') {
      throw new Error('WC_PROVIDER_MOCK=false requires WC_PROVIDER_SITE_URL to use https:// for WooCommerce credentials');
    }
  }
  return parsed;
}
