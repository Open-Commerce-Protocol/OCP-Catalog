import { z } from 'zod';

export type LoadEnvOptions = {
  ignoreProcessDotEnv?: boolean;
};

const runtimeBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return value;
}, z.boolean());

export const jobCatalogConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  JOB_CATALOG_API_PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  CATALOG_PUBLIC_BASE_URL: z.string().url(),
  API_KEY_DEV: z.string().min(1),
  API_KEYS: z.string().default(''),
  CATALOG_ID: z.string().min(1),
  CATALOG_NAME: z.string().min(1),
  REGISTRATION_PUBLIC_BASE_URL: z.string().url().default('https://ocp.deeplumen.io/registry'),
  CATALOG_PROVIDER_THROTTLE_ENABLED: runtimeBoolean.default(true),
  JOB_CATALOG_SEMANTIC_QUERY_ENABLED: runtimeBoolean.default(false),
});

export type JobCatalogConfig = z.infer<typeof jobCatalogConfigSchema>;

export function loadJobCatalogConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): JobCatalogConfig {
  void options;
  return jobCatalogConfigSchema.parse(env);
}

export function toCatalogCoreConfig(config: JobCatalogConfig) {
  return {
    catalogId: config.CATALOG_ID,
    catalogName: config.CATALOG_NAME,
    publicBaseUrl: config.CATALOG_PUBLIC_BASE_URL,
    providerThrottleEnabled: config.CATALOG_PROVIDER_THROTTLE_ENABLED,
    CATALOG_ID: config.CATALOG_ID,
    CATALOG_NAME: config.CATALOG_NAME,
    CATALOG_PUBLIC_BASE_URL: config.CATALOG_PUBLIC_BASE_URL,
    CATALOG_PROVIDER_THROTTLE_ENABLED: config.CATALOG_PROVIDER_THROTTLE_ENABLED,
  };
}
