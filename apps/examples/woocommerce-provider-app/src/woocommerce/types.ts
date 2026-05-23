/**
 * WooCommerce REST API product/variation/site shapes (subset we map).
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
 */

export interface WcImage {
  id?: number;
  src: string;
  alt?: string;
}

export interface WcCategory {
  id: number;
  name: string;
  slug?: string;
}

export interface WcAttribute {
  id?: number;
  name: string;
  options?: string[];
  variation?: boolean;
  visible?: boolean;
}

export interface WcVariation {
  id: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_status?: 'instock' | 'outofstock' | 'onbackorder';
  stock_quantity?: number | null;
  attributes?: Array<{ name: string; option: string }>;
  image?: WcImage;
}

export type WcProductStatus = 'publish' | 'draft' | 'pending' | 'private' | 'trash';

export interface WcProduct {
  id: number;
  name: string;
  slug?: string;
  permalink: string;
  type: 'simple' | 'variable' | 'grouped' | 'external';
  status: WcProductStatus;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  on_sale?: boolean;
  total_sales?: number;
  stock_status?: 'instock' | 'outofstock' | 'onbackorder';
  stock_quantity?: number | null;
  manage_stock?: boolean;
  weight?: string;
  categories?: WcCategory[];
  tags?: Array<{ id: number; name: string; slug?: string }>;
  images?: WcImage[];
  attributes?: WcAttribute[];
  variations?: number[];
  variation_details?: WcVariation[];
  date_modified_gmt?: string;
  date_created_gmt?: string;
}

export interface WcSite {
  name: string;
  url: string;
  default_currency: string;
}
