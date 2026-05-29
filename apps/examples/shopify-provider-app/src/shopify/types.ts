/**
 * TypeScript types for the subset of Shopify Admin GraphQL fields we read.
 * Documented at https://shopify.dev/docs/api/admin-graphql.
 */

export interface ShopifyMoney {
  /** Decimal price as a string, e.g. "49.00". */
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText?: string | null;
}

export interface ShopifyProductOption {
  name: string;
  values: string[];
}

export interface ShopifyVariant {
  id: string;
  sku?: string | null;
  title?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  barcode?: string | null;
  availableForSale?: boolean | null;
  inventoryQuantity?: number | null;
  selectedOptions?: Array<{ name: string; value: string }>;
  image?: ShopifyImage | null;
}

export type ShopifyProductStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT';

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  status: ShopifyProductStatus;
  tags?: string[];
  totalInventory?: number | null;
  onlineStoreUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  options: ShopifyProductOption[];
  variants: { nodes: ShopifyVariant[] };
  /** Either media (preferred) or images. We coalesce in the mapper. */
  media?: { nodes: Array<{ preview?: { image?: ShopifyImage | null } | null }> };
  featuredImage?: ShopifyImage | null;
}

export interface ShopifyProductsPage {
  nodes: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/**
 * Strip the gid:// prefix to keep OCP object_ids opaque-but-short.
 * `gid://shopify/Product/1234567` → `1234567`
 */
export function stripShopifyGid(gid: string): string {
  const match = gid.match(/[^/]+$/);
  return match ? match[0] : gid;
}

/** Convert a Shopify decimal price string ("49.00") to a number (49). */
export function parseShopifyPrice(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
