/**
 * TypeScript types for Shopify Catalog MCP responses (subset of fields we map).
 *
 * Reference: https://shopify.dev/docs/agents/catalog
 *
 * The actual transport is JSON-RPC 2.0; the structured payload always lives at
 * `result.structuredContent`. We model that inner payload here; the JSON-RPC
 * envelope is handled by the MCP client.
 */

// ---------- common ----------

export interface ShopifyMoney {
  /** Integer; Shopify documents it as `<integer>` — treat as minor units (cents). */
  amount: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
}

export interface ShopifyImage {
  type: 'image' | string;
  url: string;
  alt_text?: string;
}

export interface ShopifyCategory {
  value: string;
  taxonomy?: string;
}

export interface ShopifyOption {
  name: string;
  values?: Array<{ label: string; available?: boolean; exists?: boolean }>;
}

export interface ShopifySellerLink {
  type: string;
  url: string;
}

export interface ShopifySeller {
  name?: string;
  id?: string;
  domain?: string;
  url?: string;
  links?: ShopifySellerLink[];
}

export interface ShopifyVariant {
  id: string;
  sku?: string;
  title?: string;
  description?: { plain?: string; html?: string };
  price?: ShopifyMoney;
  /** URL the agent can redirect a buyer to in order to start checkout. */
  checkout_url?: string;
  condition?: Array<'new' | 'secondhand'>;
  eligible?: { native_checkout?: boolean };
  availability?: {
    available?: boolean;
    status?: string;
    running_low?: boolean;
  };
  requires?: {
    shipping?: boolean;
    selling_plan?: boolean;
    components?: boolean;
  };
  options?: Array<{ name: string; label: string }>;
  tags?: string[];
  seller?: ShopifySeller;
  /** lookup_catalog correlation field. */
  inputs?: Array<{ id: string; match: string }>;
}

export interface ShopifyProduct {
  id: string;
  handle?: string;
  title: string;
  description?: { html?: string; plain?: string };
  url?: string;
  categories?: ShopifyCategory[];
  price_range?: { min?: ShopifyMoney; max?: ShopifyMoney };
  media?: ShopifyImage[];
  options?: ShopifyOption[];
  /** `get_product` filtered by user selection. */
  selected?: Array<{ name: string; label: string }>;
  variants?: ShopifyVariant[];
  rating?: { value?: number; scale_max?: number; count?: number };
  metadata?: Record<string, unknown>;
}

export interface ShopifyUcpEnvelope {
  version?: string;
  capabilities?: Record<string, Array<{ version: string }>>;
}

export interface ShopifyPagination {
  cursor?: string;
  has_next_page?: boolean;
  total_count?: number;
}

export interface ShopifyMessage {
  type: 'info' | 'warning' | 'error' | string;
  code: string;
  content?: string;
}

/** Payload at `jsonrpc.result.structuredContent` for `search_catalog` / `lookup_catalog`. */
export interface ShopifyCatalogListPayload {
  ucp?: ShopifyUcpEnvelope;
  products: ShopifyProduct[];
  pagination?: ShopifyPagination;
  messages?: ShopifyMessage[];
}

/** Payload at `jsonrpc.result.structuredContent` for `get_product`. */
export interface ShopifyCatalogProductPayload {
  ucp?: ShopifyUcpEnvelope;
  product: ShopifyProduct;
  messages?: ShopifyMessage[];
}

// ---------- helpers ----------

/**
 * Strip the `gid://shopify/...` prefix to produce an opaque OCP object_id.
 * Falls back to the original string if the prefix isn't present.
 */
export function stripShopifyGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\//, '');
}

/** Money is `<integer>`; the doc strongly implies minor units. */
export function moneyToMajorUnits(m: ShopifyMoney | undefined): number {
  if (!m || typeof m.amount !== 'number') return 0;
  return m.amount / 100;
}
