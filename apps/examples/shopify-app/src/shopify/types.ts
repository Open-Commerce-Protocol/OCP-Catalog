/** Subset of Shopify Admin GraphQL types we read. See 2026-04 Admin API. */

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
  media?: { nodes: Array<{ preview?: { image?: ShopifyImage | null } | null }> };
  featuredImage?: ShopifyImage | null;
}

export interface ShopifyProductsPage {
  nodes: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

export interface ShopifyShopProfile {
  name: string;
  primaryDomain: string;
  email?: string;
  currencyCode: string;
}

export function stripShopifyGid(gid: string): string {
  const m = gid.match(/[^/]+$/);
  // Drop a trailing ?query (real variant gids look like .../42?shop=123)
  return (m ? m[0] : gid).replace(/\?.*$/, '');
}

export function parseShopifyPrice(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
