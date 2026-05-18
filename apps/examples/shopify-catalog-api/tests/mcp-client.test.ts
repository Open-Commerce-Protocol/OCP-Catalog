import { afterEach, describe, expect, test } from 'bun:test';
import { loadShopifyConfig } from '../src/config';
import { ShopifyApiError, ShopifyCatalogClient } from '../src/shopify/mcp-client';

const originalFetch = globalThis.fetch;

function makeClient() {
  const cfg = loadShopifyConfig({
    SHOPIFY_MOCK: 'false',
    SHOPIFY_CATALOG_MODE: 'global',
    SHOPIFY_GLOBAL_ENDPOINT: 'https://example.test/mcp',
    SHOPIFY_QUERY_TIMEOUT_MS: '1000',
  } as NodeJS.ProcessEnv);

  return new ShopifyCatalogClient(cfg);
}

function jsonRpcBody(structuredContent: unknown) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { structuredContent },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ShopifyCatalogClient MCP response parsing', () => {
  test('keeps JSON response path and returns structuredContent', async () => {
    const structuredContent = { products: [], next_cursor: null };
    let acceptHeader: string | undefined;

    globalThis.fetch = async (_url, init) => {
      acceptHeader = (init?.headers as Record<string, string>).accept;
      return new Response(jsonRpcBody(structuredContent), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await makeClient().search({ query: 'sweater' });

    expect(acceptHeader).toBe('application/json, text/event-stream');
    expect(result).toEqual(structuredContent);
  });

  test('parses JSON-RPC payload from text/event-stream data frame', async () => {
    const structuredContent = { products: [{ id: 'gid://shopify/Product/1' }] };

    globalThis.fetch = async () =>
      new Response(`event: message\ndata: ${jsonRpcBody(structuredContent)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });

    const result = await makeClient().search({ query: 'sweater' });

    expect(result).toEqual(structuredContent);
  });

  test('wraps invalid SSE JSON as ShopifyApiError', async () => {
    globalThis.fetch = async () =>
      new Response('event: message\ndata: {not-json}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });

    await expect(makeClient().search({ query: 'sweater' })).rejects.toMatchObject({
      name: 'ShopifyApiError',
      code: 'invalid_sse_json',
    });
  });

  test('still throws ShopifyApiError for JSON-RPC error and missing structuredContent', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad request' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );

    await expect(makeClient().search({ query: 'sweater' })).rejects.toBeInstanceOf(ShopifyApiError);

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    await expect(makeClient().search({ query: 'sweater' })).rejects.toMatchObject({
      name: 'ShopifyApiError',
      code: 'empty_result',
    });
  });
});
