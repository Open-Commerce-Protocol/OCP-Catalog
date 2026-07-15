import { loadEnv, type LoadEnvOptions } from '@ocp-catalog/config';
import { z } from 'zod';

export const siteWebConfigSchema = z.object({
  OCP_SITE_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
});

export type SiteWebConfig = z.infer<typeof siteWebConfigSchema>;

export function loadSiteWebConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): SiteWebConfig {
  return siteWebConfigSchema.parse(loadEnv(env, options));
}
