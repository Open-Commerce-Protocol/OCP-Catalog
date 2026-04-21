import { readDotEnv } from './dotenv';
import { envSchema, type AppConfig } from './env-schema';

export type { AppConfig } from './env-schema';

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return envSchema.parse({
    ...readDotEnv(),
    ...env,
  });
}
