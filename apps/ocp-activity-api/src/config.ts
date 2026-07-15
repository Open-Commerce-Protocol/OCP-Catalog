import { loadEnv, type LoadEnvOptions } from '@ocp-catalog/config';
import { z } from 'zod';

export const activityApiConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OCP_ACTIVITY_API_PORT: z.coerce.number().int().min(1).max(65535).default(4400),
  API_KEY_DEV: z.string().min(1),
  API_KEYS: z.string().default(''),
});

export type ActivityApiConfig = z.infer<typeof activityApiConfigSchema>;

export function loadActivityApiConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): ActivityApiConfig {
  return activityApiConfigSchema.parse(loadEnv(env, options));
}
