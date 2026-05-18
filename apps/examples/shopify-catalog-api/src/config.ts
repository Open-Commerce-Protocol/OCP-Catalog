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

const optionalUrlFromEnv = emptyToUndefined.pipe(z.string().url().optional());
const optionalStringFromEnv = emptyToUndefined.pipe(z.string().optional());

const configSchema = z.object({
  SHOPIFY_CATALOG_ID: z.string().min(1).default('cat_shopify_global'),
  SHOPIFY_CATALOG_NAME: z.string().min(1).default('Shopify Catalog (OCP bridge)'),
  SHOPIFY_CATALOG_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4320'),
  SHOPIFY_CATALOG_ADMIN_KEY: z.string().min(8).default('dev-shopify-admin-key'),
  SHOPIFY_CATALOG_PORT: z.coerce.number().int().positive().default(4320),

  SHOPIFY_MOCK: booleanFromEnv.default(true),
  SHOPIFY_CATALOG_MODE: z.enum(['global', 'storefront']).default('global'),
  SHOPIFY_STORE_DOMAIN: optionalStringFromEnv,
  SHOPIFY_AGENT_PROFILE_URL: optionalUrlFromEnv,
  SHOPIFY_API_KEY: optionalStringFromEnv,

  SHOPIFY_GLOBAL_ENDPOINT: z
    .string()
    .url()
    .default('https://catalog.shopify.com/api/ucp/mcp'),

  SHOPIFY_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(8000),
  SHOPIFY_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  SHOPIFY_CACHE_TTL_MS: z.coerce.number().int().min(0).default(30_000),
});

export type ShopifyConfig = z.infer<typeof configSchema> & {
  /** Resolved Shopify MCP endpoint URL based on mode + store domain. */
  SHOPIFY_RESOLVED_ENDPOINT: string;
};

export function loadShopifyConfig(env: NodeJS.ProcessEnv = process.env): ShopifyConfig {
  const parsed = configSchema.parse(env);

  if (parsed.SHOPIFY_CATALOG_MODE === 'storefront' && !parsed.SHOPIFY_STORE_DOMAIN) {
    throw new Error(
      'SHOPIFY_CATALOG_MODE=storefront requires SHOPIFY_STORE_DOMAIN (e.g. mystore.myshopify.com)',
    );
  }

  const resolved =
    parsed.SHOPIFY_CATALOG_MODE === 'storefront'
      ? `https://${parsed.SHOPIFY_STORE_DOMAIN}/api/ucp/mcp`
      : parsed.SHOPIFY_GLOBAL_ENDPOINT;

  return { ...parsed, SHOPIFY_RESOLVED_ENDPOINT: resolved };
}
