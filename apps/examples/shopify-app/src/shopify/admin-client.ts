/**
 * Multi-tenant Shopify Admin GraphQL client.
 *
 * Unlike the single-tenant shopify-provider-app, this client takes the shop
 * domain + access token *per call* (from the installation store), so one app
 * process serves every installed merchant.
 *
 * mock mode (cfg.SHOPIFY_APP_MOCK) returns fixtures and never hits the network.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { shopGraphqlUrl, type ShopifyAppConfig } from '../config';
import type { ShopifyProduct, ShopifyProductsPage, ShopifyShopProfile } from './types';

const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);
let _productsFixture: ShopifyProduct[] | null = null;
let _shopFixture: ShopifyShopProfile | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const text = await readFile(fileURLToPath(new URL(name, FIXTURE_BASE)), 'utf-8');
  return JSON.parse(text) as T;
}
async function loadProductsFixture(): Promise<ShopifyProduct[]> {
  if (!_productsFixture) _productsFixture = await readFixture<ShopifyProduct[]>('shopify-products.json');
  return _productsFixture;
}
async function loadShopFixture(): Promise<ShopifyShopProfile> {
  if (!_shopFixture) _shopFixture = await readFixture<ShopifyShopProfile>('shopify-shop.json');
  return _shopFixture;
}

export class ShopifyApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

export interface ShopSession {
  shopDomain: string;
  accessToken: string;
}

export const PRODUCT_FIELDS = `
  id
  title
  handle
  descriptionHtml
  vendor
  productType
  status
  tags
  totalInventory
  onlineStoreUrl
  createdAt
  updatedAt
  options { name values }
  featuredImage { url altText }
  media(first: 6) { nodes { preview { image { url altText } } } }
  variants(first: 50) {
    nodes {
      id
      sku
      title
      price
      compareAtPrice
      barcode
      availableForSale
      inventoryQuantity
      selectedOptions { name value }
      image { url altText }
    }
  }
`;
// ProductVariant.weight/weightUnit were removed in the 2026-04 Admin API.

const LIST_PRODUCTS_QUERY = `
  query ListProducts($cursor: String, $first: Int!, $query: String) {
    products(first: $first, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      nodes { ${PRODUCT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const GET_PRODUCT_QUERY = `query GetProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;
const SHOP_QUERY = `query Shop { shop { name email primaryDomain { host } currencyCode } }`;

export class ShopifyAdminClient {
  constructor(private readonly cfg: ShopifyAppConfig) {}

  async shopProfile(session: ShopSession): Promise<ShopifyShopProfile> {
    if (this.cfg.SHOPIFY_APP_MOCK) return loadShopFixture();
    const data = await this.gql<{ shop: { name: string; email?: string; primaryDomain: { host: string }; currencyCode: string } }>(
      session,
      SHOP_QUERY,
    );
    return {
      name: data.shop.name,
      primaryDomain: data.shop.primaryDomain.host,
      email: data.shop.email,
      currencyCode: data.shop.currencyCode,
    };
  }

  async listProducts(
    session: ShopSession,
    opts: { cursor?: string | null; updatedAfter?: string | null } = {},
  ): Promise<ShopifyProductsPage> {
    if (this.cfg.SHOPIFY_APP_MOCK) {
      const all = await loadProductsFixture();
      // Compare by parsed time, not string — the stored cursor round-trips
      // through Postgres with millisecond precision (…00.000Z) which would
      // break a naive lexical compare against fixture timestamps (…00Z).
      const cutoff = opts.updatedAfter ? Date.parse(opts.updatedAfter) : null;
      const filtered = cutoff !== null
        ? all.filter((p) => Date.parse(p.updatedAt) > cutoff)
        : all;
      return { nodes: filtered, pageInfo: { hasNextPage: false, endCursor: null } };
    }
    const query = opts.updatedAfter ? `updated_at:>'${opts.updatedAfter}'` : undefined;
    const data = await this.gql<{ products: ShopifyProductsPage }>(session, LIST_PRODUCTS_QUERY, {
      cursor: opts.cursor ?? null,
      first: this.cfg.SHOPIFY_APP_PAGE_SIZE,
      query,
    });
    return data.products;
  }

  async getProduct(session: ShopSession, idOrGid: string): Promise<ShopifyProduct | null> {
    const gid = idOrGid.startsWith('gid://') ? idOrGid : `gid://shopify/Product/${idOrGid}`;
    if (this.cfg.SHOPIFY_APP_MOCK) {
      const all = await loadProductsFixture();
      return all.find((p) => p.id === gid || p.id.endsWith(`/${idOrGid}`)) ?? null;
    }
    const data = await this.gql<{ product: ShopifyProduct | null }>(session, GET_PRODUCT_QUERY, { id: gid });
    return data.product;
  }

  async gql<T>(session: ShopSession, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (this.cfg.SHOPIFY_APP_MOCK) {
      throw new ShopifyApiError('mock_disabled', 'gql() should not be called in mock mode');
    }
    const url = shopGraphqlUrl(this.cfg, session.shopDomain);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-shopify-access-token': session.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.cfg.SHOPIFY_APP_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShopifyApiError('transport_error', `Shopify Admin transport error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 500);
      throw new ShopifyApiError(`http_${res.status}`, `Shopify Admin HTTP ${res.status}: ${snippet}`);
    }
    const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (payload.errors && payload.errors.length > 0) {
      throw new ShopifyApiError('graphql_error', payload.errors.map((e) => e.message).join('; '), payload.errors);
    }
    if (!payload.data) throw new ShopifyApiError('empty_data', 'Shopify Admin returned no data');
    return payload.data;
  }
}
