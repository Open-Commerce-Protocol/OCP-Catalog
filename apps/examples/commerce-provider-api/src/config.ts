import { loadEnv, type LoadEnvOptions } from '@ocp-catalog/config';
import { z } from 'zod';

export const commerceProviderConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PROVIDER_API_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  PROVIDER_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4200'),
  CATALOG_PUBLIC_BASE_URL: z.string().url(),
  CATALOG_ID: z.string().min(1),
  COMMERCE_PROVIDER_ID: z.string().default('commerce_provider_local_dev'),
  COMMERCE_PROVIDER_NAME: z.string().default('Local Commerce Provider'),
  COMMERCE_PROVIDER_CONTACT_EMAIL: z.string().email().default('ops@example.test'),
  COMMERCE_PROVIDER_DOMAIN: z.string().default('localhost'),
  API_KEY_DEV: z.string().default('dev-api-key'),
  API_KEYS: z.string().default(''),
});

export type CommerceProviderConfig = z.infer<typeof commerceProviderConfigSchema>;

export function loadCommerceProviderConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): CommerceProviderConfig {
  return commerceProviderConfigSchema.parse(loadEnv(env, options));
}
