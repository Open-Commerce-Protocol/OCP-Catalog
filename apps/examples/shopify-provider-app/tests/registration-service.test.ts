import { describe, expect, test } from 'bun:test';
import type { ShopifyProviderConfig } from '../src/config';
import { RegistrationService } from '../src/services/registration-service';
import { StateStore } from '../src/services/state-store';

const cfg: ShopifyProviderConfig = {
  SHOPIFY_PROVIDER_ID: 'shopify_provider_test',
  SHOPIFY_PROVIDER_DISPLAY_NAME: 'Shopify Test',
  SHOPIFY_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
  SHOPIFY_PROVIDER_PORT: 4400,
  SHOPIFY_PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4400',
  SHOPIFY_PROVIDER_ADMIN_KEY: 'dev-shopify-provider-admin-key',
  SHOPIFY_PROVIDER_MOCK: true,
  SHOPIFY_PROVIDER_STORE_DOMAIN: 'test-shop.myshopify.com',
  SHOPIFY_PROVIDER_ACCESS_TOKEN: undefined,
  SHOPIFY_PROVIDER_API_VERSION: '2025-10',
  SHOPIFY_PROVIDER_DEFAULT_CURRENCY: 'USD',
  SHOPIFY_PROVIDER_PAGE_SIZE: 50,
  SHOPIFY_PROVIDER_REQUEST_TIMEOUT_MS: 15000,
  SHOPIFY_PROVIDER_WEBHOOK_SECRET: 'secret',
  SHOPIFY_PROVIDER_CATALOG_BASE_URL: 'http://localhost:4000',
  SHOPIFY_PROVIDER_CATALOG_ID: 'cat_test',
  SHOPIFY_PROVIDER_CATALOG_API_KEY: 'dev-api-key',
  SHOPIFY_PROVIDER_STATE_FILE: undefined,
  SHOPIFY_PROVIDER_GRAPHQL_URL: 'mock://shopify-admin-graphql',
};

describe('RegistrationService', () => {
  test('does not persist active version when catalog rejects registration', async () => {
    const state = new StateStore(undefined);
    const service = new RegistrationService(
      cfg,
      {
        shopProfile: async () => ({
          name: 'Test Shop',
          primaryDomain: 'test-shop.myshopify.com',
          currencyCode: 'USD',
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
