/**
 * Mapper: WooCommerce Product → OCP CommercialObject.
 *
 * Variable products: variations are embedded under attributes.variations.
 * Price uses Woo's resolved `price` (which already accounts for sale).
 */
import { commercialObjectSchema, type CommercialObject } from '@ocp-catalog/ocp-schema';
import type { WcProduct, WcVariation } from '../woocommerce/types';

export type { CommercialObject };

export interface MapperContext {
  providerId: string;
  defaultCurrency: string;
  /** Optional, used to fall back to construct product URL if permalink missing. */
  siteUrl?: string;
}

export function htmlToPlainText(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

export function safePrice(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function statusFromWc(s: WcProduct['status']): 'active' | 'inactive' | 'draft' {
  if (s === 'publish') return 'active';
  if (s === 'draft' || s === 'pending') return 'draft';
  return 'inactive';
}

function availabilityFromWc(stockStatus?: WcProduct['stock_status']): 'in_stock' | 'out_of_stock' | 'low_stock' | 'preorder' | 'unknown' {
  if (stockStatus === 'instock') return 'in_stock';
  if (stockStatus === 'outofstock') return 'out_of_stock';
  if (stockStatus === 'onbackorder') return 'preorder';
  return 'unknown';
}

function brandFromAttributes(p: WcProduct): string | undefined {
  const brand = p.attributes?.find((a) => /brand/i.test(a.name));
  return brand?.options?.[0];
}

function summarize(p: WcProduct): string | undefined {
  return htmlToPlainText(p.description ?? p.short_description ?? undefined);
}

export function mapWcProductToCommercialObject(p: WcProduct, ctx: MapperContext): CommercialObject {
  const objectId = String(p.id);
  const url = absolutize(p.permalink);
  const summary = summarize(p);
  const images = (p.images ?? [])
    .map((i) => absolutize(i.src))
    .filter((u): u is string => Boolean(u));

  const priceAmount = safePrice(p.price ?? p.regular_price ?? p.sale_price ?? undefined);
  const regular = safePrice(p.regular_price ?? undefined);
  const priceList = regular > priceAmount ? regular : undefined;
  const availability = availabilityFromWc(p.stock_status);
  const brand = brandFromAttributes(p);
  const category = p.categories?.[0]?.name;
  const variantInfo = (p.variation_details ?? []).map((v: WcVariation) => ({
    id: v.id,
    sku: v.sku ?? null,
    price: safePrice(v.price),
    regular_price: safePrice(v.regular_price),
    stock_status: v.stock_status ?? null,
    stock_quantity: v.stock_quantity ?? null,
    options: v.attributes ?? [],
  }));

  const attributes: Record<string, unknown> = {
    slug: p.slug ?? null,
    type: p.type,
    tags: (p.tags ?? []).map((t) => t.name),
    categories: (p.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
    options: (p.attributes ?? []).filter((a) => a.variation).map((a) => ({ name: a.name, value_count: a.options?.length ?? 0 })),
    variant_count: variantInfo.length,
    variations: variantInfo,
    source: 'woocommerce',
    wc_modified_at: p.date_modified_gmt ?? null,
    on_sale: Boolean(p.on_sale),
    total_sales: p.total_sales ?? null,
  };

  const object: CommercialObject = {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.providerId}_${objectId}`,
    object_id: objectId,
    object_type: 'product',
    provider_id: ctx.providerId,
    title: p.name,
    ...(summary ? { summary } : {}),
    status: statusFromWc(p.status),
    ...(url ? { source_url: url } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: p.name,
          ...(summary ? { summary } : {}),
          ...(brand ? { brand } : {}),
          ...(category ? { category } : {}),
          ...(p.sku ? { sku: p.sku } : {}),
          ...(url ? { product_url: url } : {}),
          image_urls: images,
          attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: ctx.defaultCurrency,
          amount: priceAmount,
          ...(priceList !== undefined ? { list_amount: priceList, price_type: 'range' as const } : { price_type: 'fixed' as const }),
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: availability,
          ...(typeof p.stock_quantity === 'number' && p.stock_quantity >= 0 ? { quantity: p.stock_quantity } : {}),
        },
      },
    ],
  };
  return commercialObjectSchema.parse(object);
}

export function buildWcTombstoneCommercialObject(productId: string | number, ctx: MapperContext): CommercialObject {
  const objectId = String(productId);
  const object: CommercialObject = {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.providerId}_${objectId}`,
    object_id: objectId,
    object_type: 'product',
    provider_id: ctx.providerId,
    title: `(removed) ${objectId}`,
    status: 'inactive',
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: { title: `(removed) ${objectId}`, attributes: { tombstone: true, source: 'woocommerce' } },
      },
      { pack_id: 'ocp.commerce.price.v1', data: { currency: ctx.defaultCurrency, amount: 0, price_type: 'fixed' as const } },
      { pack_id: 'ocp.commerce.inventory.v1', data: { availability_status: 'out_of_stock' } },
    ],
  };
  return commercialObjectSchema.parse(object);
}
