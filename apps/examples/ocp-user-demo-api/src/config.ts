import { loadEnv, type LoadEnvOptions } from '@ocp-catalog/config';
import { z } from 'zod';

export const userDemoApiConfigSchema = z.object({
  USER_DEMO_API_PORT: z.coerce.number().int().min(1).max(65535).default(4230),
  USER_DEMO_AGENT_MODEL: z.string().default('qwen-plus'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  REGISTRATION_DISCOVERY_URL: z.string().url().default('https://ocp.deeplumen.io/.well-known/ocp-registration'),
  REGISTRATION_PUBLIC_BASE_URL: z.string().url().default('https://ocp.deeplumen.io/registry'),
});

export type UserDemoApiConfig = z.infer<typeof userDemoApiConfigSchema>;

export function loadUserDemoApiConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): UserDemoApiConfig {
  return userDemoApiConfigSchema.parse(loadEnv(env, options));
}
