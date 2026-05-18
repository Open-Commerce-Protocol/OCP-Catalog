import { z } from 'zod';

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === undefined ? undefined : value === 'true')
  .pipe(z.boolean().optional());

const configSchema = z.object({
  ALIMAMA_CATALOG_ID: z.string().min(1).default('cat_alimama_affiliate'),
  ALIMAMA_CATALOG_NAME: z.string().min(1).default('Alimama Affiliate Catalog'),
  ALIMAMA_CATALOG_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4310'),
  ALIMAMA_CATALOG_ADMIN_KEY: z.string().min(8).default('dev-alimama-admin-key'),
  ALIMAMA_CATALOG_PORT: z.coerce.number().int().positive().default(4310),

  ALIMAMA_MOCK: booleanFromEnv.default(true),
  ALIMAMA_APP_KEY: z.string().optional(),
  ALIMAMA_APP_SECRET: z.string().optional(),
  ALIMAMA_ADZONE_ID: z.string().default('mock_adzone_001'),
  ALIMAMA_BASE_URL: z.string().url().default('https://gw.api.taobao.com/router/rest'),

  ALIMAMA_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  ALIMAMA_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  ALIMAMA_ORDER_POLL_INTERVAL_SEC: z.coerce.number().int().min(0).default(0),
});

export type AlimamaConfig = z.infer<typeof configSchema>;

export function loadAlimamaConfig(env: NodeJS.ProcessEnv = process.env): AlimamaConfig {
  const parsed = configSchema.parse(env);
  if (!parsed.ALIMAMA_MOCK && (!parsed.ALIMAMA_APP_KEY || !parsed.ALIMAMA_APP_SECRET)) {
    throw new Error('ALIMAMA_MOCK=false requires ALIMAMA_APP_KEY and ALIMAMA_APP_SECRET');
  }
  return parsed;
}
