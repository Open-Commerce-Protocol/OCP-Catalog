import { describe, expect, test } from 'bun:test';
import { loadWcProviderConfig } from '../src/config';
import { WcApiError, WcRestClient } from '../src/woocommerce/rest-client';

const realModeEnv = {
  WC_PROVIDER_MOCK: 'false',
  WC_PROVIDER_CONSUMER_KEY: 'ck_test',
  WC_PROVIDER_CONSUMER_SECRET: 'cs_test',
};

describe('loadWcProviderConfig', () => {
  test('rejects real mode credentials over http', () => {
    expect(() => loadWcProviderConfig({
      ...realModeEnv,
      WC_PROVIDER_SITE_URL: 'http://wc.example.test',
    })).toThrow(/https:\/\//);
  });

  test('accepts real mode credentials over https', () => {
    const cfg = loadWcProviderConfig({
      ...realModeEnv,
      WC_PROVIDER_SITE_URL: 'https://wc.example.test',
    });

    expect(cfg.WC_PROVIDER_SITE_URL).toBe('https://wc.example.test');
    expect(cfg.WC_PROVIDER_MOCK).toBe(false);
  });
});

describe('WcRestClient', () => {
  test('paginates product variations until the final partial page', async () => {
    const originalFetch = globalThis.fetch;
    const seenPages: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      seenPages.push(url.searchParams.get('page') ?? '');
      const page = Number(url.searchParams.get('page'));
      const count = page === 1 ? 100 : 2;
      return Response.json(Array.from({ length: count }, (_, i) => ({ id: page * 1000 + i })));
    }) as typeof fetch;

    try {
      const cfg = loadWcProviderConfig({
        ...realModeEnv,
        WC_PROVIDER_SITE_URL: 'https://wc.example.test',
      });
      const variations = await new WcRestClient(cfg).listVariations(123);

      expect(variations).toHaveLength(102);
      expect(seenPages).toEqual(['1', '2']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails closed when variation pagination exceeds the safety limit', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json(Array.from({ length: 100 }, (_, i) => ({ id: i })))) as typeof fetch;

    try {
      const cfg = loadWcProviderConfig({
        ...realModeEnv,
        WC_PROVIDER_SITE_URL: 'https://wc.example.test',
      });

      await expect(new WcRestClient(cfg).listVariations(123)).rejects.toBeInstanceOf(WcApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
