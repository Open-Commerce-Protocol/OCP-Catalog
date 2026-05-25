import { describe, expect, test } from 'bun:test';
import type { WcProviderConfig } from '../src/config';
import { RegistrationService } from '../src/services/registration-service';
import { StateStore } from '../src/services/state-store';

const cfg: WcProviderConfig = {
  WC_PROVIDER_ID: 'wc_provider_test',
  WC_PROVIDER_DISPLAY_NAME: 'WC Test',
  WC_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
  WC_PROVIDER_PORT: 4410,
  WC_PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4410',
  WC_PROVIDER_ADMIN_KEY: 'dev-wc-provider-admin-key',
  WC_PROVIDER_MOCK: true,
  WC_PROVIDER_SITE_URL: 'https://wc.example.test',
  WC_PROVIDER_CONSUMER_KEY: 'ck_test',
  WC_PROVIDER_CONSUMER_SECRET: 'cs_test',
  WC_PROVIDER_AUTH_MODE: 'basic',
  WC_PROVIDER_API_VERSION: 'wc/v3',
  WC_PROVIDER_DEFAULT_CURRENCY: 'USD',
  WC_PROVIDER_PAGE_SIZE: 50,
  WC_PROVIDER_REQUEST_TIMEOUT_MS: 15000,
  WC_PROVIDER_WEBHOOK_SECRET: 'secret',
  WC_PROVIDER_CATALOG_BASE_URL: 'http://localhost:4000',
  WC_PROVIDER_CATALOG_ID: 'cat_test',
  WC_PROVIDER_CATALOG_API_KEY: 'dev-api-key',
  WC_PROVIDER_STATE_FILE: undefined,
};

describe('RegistrationService', () => {
  test('does not persist active version when catalog rejects registration', async () => {
    const state = new StateStore(undefined);
    const service = new RegistrationService(
      cfg,
      {
        siteProfile: async () => ({
          name: 'WC Test',
          url: 'https://wc.example.test',
          default_currency: 'USD',
        }),
      } as any,
      {
        registerProvider: async () => ({ status: 'rejected', message: 'bad contract' }),
        getProvider: async () => null,
      } as any,
      state,
    );

    await expect(service.register()).rejects.toThrow(/rejected/);
    const snapshot = await state.snapshot();
    expect(snapshot.active_registration_version).toBeNull();
    expect(snapshot.last_run.status).toBe('failed');
  });
});
