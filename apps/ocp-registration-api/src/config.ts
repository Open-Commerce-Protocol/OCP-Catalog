import { loadEnv, runtimeBoolean, type LoadEnvOptions } from '@ocp-catalog/config';
import type {
  RegistrationIdentityConfig,
  RegistrationRefreshSchedulerConfig,
  RegistrationRegistryConfig,
} from '@ocp-catalog/registration-core';
import { z } from 'zod';

export const registrationApiConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REGISTRATION_API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  REGISTRATION_PUBLIC_BASE_URL: z.string().url().default('https://ocp.deeplumen.io/registry'),
  REGISTRATION_REFRESH_SCHEDULER_ENABLED: runtimeBoolean.default(true),
  REGISTRATION_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
  REGISTRATION_HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  REGISTRATION_HEALTH_FAILURE_STALE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  API_KEY_DEV: z.string().min(1),
  API_KEYS: z.string().default(''),
  REGISTRATION_ID: z.string().min(1),
  REGISTRATION_NAME: z.string().min(1),
});

export type RegistrationApiConfig = z.infer<typeof registrationApiConfigSchema>;

export function loadRegistrationApiConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadEnvOptions = {},
): RegistrationApiConfig {
  return registrationApiConfigSchema.parse(loadEnv(env, options));
}

export function toRegistrationIdentityConfig(config: RegistrationApiConfig): RegistrationIdentityConfig {
  return {
    registrationId: config.REGISTRATION_ID,
    registrationName: config.REGISTRATION_NAME,
    publicBaseUrl: config.REGISTRATION_PUBLIC_BASE_URL,
  };
}

export function toRegistrationRegistryConfig(config: RegistrationApiConfig): RegistrationRegistryConfig {
  return {
    ...toRegistrationIdentityConfig(config),
    healthCheckTimeoutMs: config.REGISTRATION_HEALTH_CHECK_TIMEOUT_MS,
    healthFailureStaleThreshold: config.REGISTRATION_HEALTH_FAILURE_STALE_THRESHOLD,
  };
}

export function toRegistrationRefreshSchedulerConfig(config: RegistrationApiConfig): RegistrationRefreshSchedulerConfig {
  return {
    registrationId: config.REGISTRATION_ID,
    refreshSchedulerEnabled: config.REGISTRATION_REFRESH_SCHEDULER_ENABLED,
    refreshIntervalSeconds: config.REGISTRATION_REFRESH_INTERVAL_SECONDS,
  };
}
