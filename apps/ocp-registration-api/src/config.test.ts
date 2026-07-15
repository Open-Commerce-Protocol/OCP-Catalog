import { describe, expect, test } from 'bun:test';
import { loadRegistrationApiConfig } from './config';

const requiredEnv = {
  DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
  REGISTRATION_ID: 'reg_test',
  REGISTRATION_NAME: 'Test Registration',
  API_KEY_DEV: 'dev-api-key',
};

describe('loadRegistrationApiConfig', () => {
  test('requires registration identity', () => {
    const { REGISTRATION_ID: _registrationId, ...env } = requiredEnv;

    expect(() => loadRegistrationApiConfig(env, { includeDotEnv: false })).toThrow();
  });

  test('requires explicit admin auth config', () => {
    const { API_KEY_DEV: _apiKeyDev, ...env } = requiredEnv;

    expect(() => loadRegistrationApiConfig(env, { includeDotEnv: false })).toThrow();
  });

  test('rejects invalid scheduler boolean strings', () => {
    expect(() => loadRegistrationApiConfig({
      ...requiredEnv,
      REGISTRATION_REFRESH_SCHEDULER_ENABLED: 'disabled',
    }, { includeDotEnv: false })).toThrow();
  });
});
