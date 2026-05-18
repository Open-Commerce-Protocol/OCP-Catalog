/**
 * Minimal JSON-RPC 2.0 client for the Shopify Catalog MCP endpoints.
 *
 * Two modes (controlled by cfg.SHOPIFY_MOCK):
 *   - mock: returns fixtures from tests/fixtures/, no network.
 *   - real: POSTs `tools/call` JSON-RPC frames to SHOPIFY_RESOLVED_ENDPOINT.
 *
 * We intentionally avoid the full @modelcontextprotocol/sdk client to keep
 * transport surface area small and easy to unit-test with fixtures. If
 * Shopify later requires a full MCP initialize handshake, swap in the SDK's
 * StreamableHttpClientTransport here.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ShopifyConfig } from '../config';
import type {
  ShopifyCatalogListPayload,
  ShopifyCatalogProductPayload,
} from './types';

const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

/**
 * Shopify hosts a public "valid-with-capabilities" agent profile for testing.
 * We use it as the default so that real-mode requests succeed without any
 * operator setup. Production deployments should host their own profile.
 */
export const DEFAULT_SHOPIFY_AGENT_PROFILE_URL =
  'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json';

let _searchFixtureCache: ShopifyCatalogListPayload | null = null;
let _lookupFixtureCache: ShopifyCatalogListPayload | null = null;
let _productFixtureCache: ShopifyCatalogProductPayload | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadSearchFixture(): Promise<ShopifyCatalogListPayload> {
  if (!_searchFixtureCache) {
    _searchFixtureCache = await readFixture<ShopifyCatalogListPayload>('search-catalog-sample.json');
  }
  return _searchFixtureCache;
}

async function loadLookupFixture(): Promise<ShopifyCatalogListPayload> {
  if (!_lookupFixtureCache) {
    _lookupFixtureCache = await readFixture<ShopifyCatalogListPayload>('lookup-catalog-sample.json');
  }
  return _lookupFixtureCache;
}

async function loadProductFixture(): Promise<ShopifyCatalogProductPayload> {
  if (!_productFixtureCache) {
    _productFixtureCache = await readFixture<ShopifyCatalogProductPayload>('get-product-sample.json');
  }
  return _productFixtureCache;
}

export class ShopifyApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: { structuredContent: T; content?: unknown[]; isError?: boolean };
  error?: { code: number; message: string; data?: unknown };
}

type SearchInput = {
  query: string;
  filters?: Record<string, unknown>;
};

type LookupInput = {
  ids: string[];
  context?: Record<string, unknown>;
};

type GetProductInput = {
  id: string;
  selected?: Array<{ name: string; label: string }>;
  preferences?: string[];
};

export class ShopifyCatalogClient {
  private idCounter = 0;

  constructor(private readonly cfg: ShopifyConfig) {}

  async search(input: SearchInput): Promise<ShopifyCatalogListPayload> {
    if (this.cfg.SHOPIFY_MOCK) return loadSearchFixture();
    return this.callTool<ShopifyCatalogListPayload>('search_catalog', { catalog: input });
  }

  async lookup(input: LookupInput): Promise<ShopifyCatalogListPayload> {
    if (this.cfg.SHOPIFY_MOCK) return loadLookupFixture();
    return this.callTool<ShopifyCatalogListPayload>('lookup_catalog', { catalog: input });
  }

  async getProduct(input: GetProductInput): Promise<ShopifyCatalogProductPayload> {
    if (this.cfg.SHOPIFY_MOCK) return loadProductFixture();
    return this.callTool<ShopifyCatalogProductPayload>('get_product', { catalog: input });
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const id = ++this.idCounter;

    // Shopify's UCP MCP requires every tools/call to carry
    // arguments.meta["ucp-agent"].profile (in the request body, not headers).
    // Falls back to Shopify's published sample profile so the bridge works
    // out-of-the-box without operators hosting their own profile first.
    const profile =
      this.cfg.SHOPIFY_AGENT_PROFILE_URL ?? DEFAULT_SHOPIFY_AGENT_PROFILE_URL;
    const argsWithMeta = {
      ...args,
      meta: {
        ...((args as { meta?: Record<string, unknown> }).meta ?? {}),
        'ucp-agent': { profile },
      },
    };

    const body = {
      jsonrpc: '2.0' as const,
      id,
      method: 'tools/call',
      params: { name, arguments: argsWithMeta },
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Shopify returns either JSON or SSE depending on transport upgrade;
      // declare both so we don't accidentally negotiate a stream.
      accept: 'application/json, text/event-stream',
    };
    if (this.cfg.SHOPIFY_API_KEY) {
      headers.authorization = `Bearer ${this.cfg.SHOPIFY_API_KEY}`;
    }

    let res: Response;
    try {
      res = await fetch(this.cfg.SHOPIFY_RESOLVED_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.SHOPIFY_QUERY_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShopifyApiError(
        'transport_error',
        `Shopify MCP transport error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      throw new ShopifyApiError(
        `http_${res.status}`,
        `Shopify MCP HTTP ${res.status} ${res.statusText}`,
      );
    }

    const payload = (await res.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new ShopifyApiError(
        `rpc_${payload.error.code}`,
        payload.error.message,
        payload.error.data,
      );
    }
    if (!payload.result || !payload.result.structuredContent) {
      throw new ShopifyApiError('empty_result', 'Shopify MCP response missing structuredContent');
    }
    if (payload.result.isError) {
      throw new ShopifyApiError('tool_error', 'Shopify MCP tool reported isError=true', payload.result);
    }
    return payload.result.structuredContent;
  }
}
