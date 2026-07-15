import { z } from 'zod';

const emptyToUndefined = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

const optionalStringFromEnv = emptyToUndefined.pipe(z.string().optional());

const configSchema = z.object({
  // ── App identity (from Shopify Partner Dashboard) ──────────────────────
  // The API key (Client ID) and API secret (Client Secret) of the public app.
  SHOPIFY_APP_API_KEY: z.string().min(1).default('dev-shopify-app-client-id'),
  SHOPIFY_APP_API_SECRET: z.string().min(1).default('dev-shopify-app-client-secret'),
  // The public HTTPS base URL where this app is reachable (tunnel/prod).
  // OAuth redirect + webhook callbacks are derived from it.
  SHOPIFY_APP_URL: z.string().url().default('http://localhost:4420'),
  SHOPIFY_APP_PORT: z.coerce.number().int().positive().default(4420),
  // Space/comma separated scopes requested at install.
  SHOPIFY_APP_SCOPES: z
    .string()
    .default('read_products,read_inventory,read_locations,read_product_listings'),
  SHOPIFY_APP_API_VERSION: z.string().min(1).default('2026-04'),
  SHOPIFY_APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SHOPIFY_APP_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SHOPIFY_APP_ALLOW_INSECURE_DEV_TOKEN_KEY: emptyToUndefined
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .pipe(z.boolean().optional())
    .transform((value) => value ?? false),

  // Admin key for the operator-facing /admin/* maintenance routes.
  SHOPIFY_APP_ADMIN_KEY: z.string().min(8).default('dev-shopify-app-admin-key'),

  // ── Behaviour flags ────────────────────────────────────────────────────
  // mock=true short-circuits all Shopify network calls with fixtures so the
  // app boots and unit-tests run without credentials.
  SHOPIFY_APP_MOCK: emptyToUndefined
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .pipe(z.boolean().optional())
    .transform((value) => value ?? false),
  SHOPIFY_APP_DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  SHOPIFY_APP_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(50),
  SHOPIFY_APP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),
  // Auto-run a full sync immediately after a successful install.
  SHOPIFY_APP_SYNC_ON_INSTALL: emptyToUndefined
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .pipe(z.boolean().optional())
    .transform((value) => value ?? true),
  SHOPIFY_APP_WORKER_ENABLED: emptyToUndefined
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .pipe(z.boolean().optional())
    .transform((value) => value ?? true),

  // ── OCP catalog (sync target) ──────────────────────────────────────────
  SHOPIFY_APP_CATALOG_BASE_URL: z.string().url().default('http://localhost:4000'),
  SHOPIFY_APP_CATALOG_ID: z.string().min(1).default('cat_local_dev'),
  SHOPIFY_APP_CATALOG_API_KEY: z.string().min(1).default('dev-api-key'),

  // ── OCP activity service (merchant dashboard metrics: views/resolves) ──
  // Optional. If unset, the dashboard still renders P1 cards (sync/quality)
  // and shows null for view/resolve counts.
  SHOPIFY_APP_ACTIVITY_BASE_URL: optionalStringFromEnv,

  DATABASE_URL: z.string().default('postgres://ocp:ocp@localhost:5432/ocp_catalog'),
});

export type ShopifyAppConfig = z.infer<typeof configSchema> & {
  scopeList: string[];
  redirectUri: string;
};

export function loadShopifyAppConfig(env: NodeJS.ProcessEnv = process.env): ShopifyAppConfig {
  const parsed = configSchema.parse(env);
  const realMode = !parsed.SHOPIFY_APP_MOCK;
  if (parsed.SHOPIFY_APP_ENV === 'production' || realMode) {
    const devDefaults = [
      ['SHOPIFY_APP_API_KEY', 'dev-shopify-app-client-id'],
      ['SHOPIFY_APP_API_SECRET', 'dev-shopify-app-client-secret'],
      ['SHOPIFY_APP_ADMIN_KEY', 'dev-shopify-app-admin-key'],
      ['SHOPIFY_APP_CATALOG_API_KEY', 'dev-api-key'],
    ] as const;
    for (const [key, value] of devDefaults) {
      if (parsed[key] === value) throw new Error(`${key} must be set in production`);
    }
    if (!parsed.SHOPIFY_APP_TOKEN_ENCRYPTION_KEY && !parsed.SHOPIFY_APP_ALLOW_INSECURE_DEV_TOKEN_KEY) {
      throw new Error('SHOPIFY_APP_TOKEN_ENCRYPTION_KEY must be set in production');
    }
  }
  const scopeList = parsed.SHOPIFY_APP_SCOPES.split(/[, ]+/).map((s) => s.trim()).filter(Boolean);
  const redirectUri = `${parsed.SHOPIFY_APP_URL.replace(/\/$/, '')}/auth/callback`;
  return { ...parsed, scopeList, redirectUri };
}

/** Per-shop GraphQL endpoint. */
export function shopGraphqlUrl(cfg: ShopifyAppConfig, shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${cfg.SHOPIFY_APP_API_VERSION}/graphql.json`;
}
