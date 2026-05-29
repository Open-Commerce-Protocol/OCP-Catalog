/**
 * Shopify Admin GraphQL client.
 *
 * Two modes (controlled by cfg.SHOPIFY_PROVIDER_MOCK):
 *   - mock: returns products from tests/fixtures/products.json, no network.
 *   - real: POSTs GraphQL queries with X-Shopify-Access-Token.
 *
 * Exposes only the queries we need for product sync:
 *   - listProducts(cursor?, updatedAfter?)  → paginated Product nodes
 *   - getProduct(id)                        → single Product
 *   - shopProfile()                         → { name, primaryDomain, currencyCode }
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ShopifyProviderConfig } from '../config';
import type { ShopifyProduct, ShopifyProductsPage } from './types';

const FIXTURE_BASE = new URL('../../tests/fixtures/', import.meta.url);

let _productsFixtureCache: ShopifyProduct[] | null = null;
let _shopFixtureCache: ShopifyShopProfile | null = null;

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(name, FIXTURE_BASE);
  const text = await readFile(fileURLToPath(url), 'utf-8');
  return JSON.parse(text) as T;
}

async function loadProductsFixture(): Promise<ShopifyProduct[]> {
  if (!_productsFixtureCache) {
    _productsFixtureCache = await readFixture<ShopifyProduct[]>('shopify-products.json');
  }
  return _productsFixtureCache;
}

async function loadShopFixture(): Promise<ShopifyShopProfile> {
  if (!_shopFixtureCache) {
    _shopFixtureCache = await readFixture<ShopifyShopProfile>('shopify-shop.json');
  }
  return _shopFixtureCache;
}

export interface ShopifyShopProfile {
  name: string;
  primaryDomain: string;
  email?: string;
  currencyCode: string;
}

export class ShopifyApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ShopifyApiError';
  }
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
// Note: ProductVariant.weight / weightUnit were removed in the 2026-04 Admin
// GraphQL API. Weight is now exposed via inventoryItem.measurement.weight.
// We don't currently map weight into OCP packs, so we just drop them here.

const LIST_PRODUCTS_QUERY = `
  query ListProducts($cursor: String, $first: Int!, $query: String) {
    products(first: $first, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      nodes { ${PRODUCT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GET_PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) { ${PRODUCT_FIELDS} }
  }
`;

const SHOP_QUERY = `
  query Shop {
    shop {
      name
      email
      primaryDomain { host }
      currencyCode
    }
  }
`;

export class ShopifyAdminClient {
  constructor(private readonly cfg: ShopifyProviderConfig) {}

  async shopProfile(): Promise<ShopifyShopProfile> {
    if (this.cfg.SHOPIFY_PROVIDER_MOCK) return loadShopFixture();
    const data = await this.gql<{ shop: { name: string; email?: string; primaryDomain: { host: string }; currencyCode: string } }>(SHOP_QUERY);
    return {
      name: data.shop.name,
      primaryDomain: data.shop.primaryDomain.host,
      email: data.shop.email,
      currencyCode: data.shop.currencyCode,
    };
  }

  async listProducts(opts: { cursor?: string | null; updatedAfter?: string | null } = {}): Promise<ShopifyProductsPage> {
    if (this.cfg.SHOPIFY_PROVIDER_MOCK) {
      const all = await loadProductsFixture();
      const filtered = opts.updatedAfter
        ? all.filter((p) => p.updatedAt > opts.updatedAfter!)
        : all;
      return { nodes: filtered, pageInfo: { hasNextPage: false, endCursor: null } };
    }

    const query = opts.updatedAfter ? `updated_at:>'${opts.updatedAfter}'` : undefined;
    const data = await this.gql<{ products: ShopifyProductsPage }>(
      LIST_PRODUCTS_QUERY,
      { cursor: opts.cursor ?? null, first: this.cfg.SHOPIFY_PROVIDER_PAGE_SIZE, query },
    );
    return data.products;
  }

  async getProduct(idOrGid: string): Promise<ShopifyProduct | null> {
    const gid = idOrGid.startsWith('gid://') ? idOrGid : `gid://shopify/Product/${idOrGid}`;
    if (this.cfg.SHOPIFY_PROVIDER_MOCK) {
      const all = await loadProductsFixture();
      return all.find((p) => p.id === gid || p.id.endsWith(`/${idOrGid}`)) ?? null;
    }
    const data = await this.gql<{ product: ShopifyProduct | null }>(GET_PRODUCT_QUERY, { id: gid });
    return data.product;
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (this.cfg.SHOPIFY_PROVIDER_MOCK) {
      throw new ShopifyApiError('mock_disabled', 'gql() should not be called in mock mode');
    }
    if (!this.cfg.SHOPIFY_PROVIDER_ACCESS_TOKEN) {
      throw new ShopifyApiError('missing_token', 'SHOPIFY_PROVIDER_ACCESS_TOKEN is not set');
    }

    let res: Response;
    try {
      res = await fetch(this.cfg.SHOPIFY_PROVIDER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-shopify-access-token': this.cfg.SHOPIFY_PROVIDER_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.cfg.SHOPIFY_PROVIDER_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShopifyApiError(
        'transport_error',
        `Shopify Admin transport error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const bodySnippet = (await res.text()).slice(0, 500);
      throw new ShopifyApiError(`http_${res.status}`, `Shopify Admin HTTP ${res.status}: ${bodySnippet}`);
    }

    const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (payload.errors && payload.errors.length > 0) {
      throw new ShopifyApiError('graphql_error', payload.errors.map((e) => e.message).join('; '), payload.errors);
    }
    if (!payload.data) {
      throw new ShopifyApiError('empty_data', 'Shopify Admin returned no data');
    }
    return payload.data;
  }
}
