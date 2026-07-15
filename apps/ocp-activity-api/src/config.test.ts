import { describe, expect, test } from 'bun:test';
import { loadActivityApiConfig } from './config';

describe('loadActivityApiConfig', () => {
  test('requires explicit ingest auth config', () => {
    expect(() => loadActivityApiConfig({
      DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
    }, { includeDotEnv: false })).toThrow();
  });

  test('parses explicit activity config', () => {
    const config = loadActivityApiConfig({
      DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
      API_KEY_DEV: 'dev-api-key',
      OCP_ACTIVITY_API_PORT: '4401',
    }, { includeDotEnv: false });

    expect(config.OCP_ACTIVITY_API_PORT).toBe(4401);
  });
});
