/**
 * Mapper: Shopify Admin Product → OCP CommercialObject.
 *
 * Each Shopify Product becomes one OCP object (not per-variant). Variant
 * detail is preserved inside product.core.v1#/attributes.variants so a
 * downstream catalog can rebuild option-aware purchase flows if needed.
 *
 * Invariants (pinned by unit tests):
 *   1. image_urls are all absolute https://
 *   2. price.amount is a number (decimal-major units), price.currency is the shop's default
 *   3. inventory.availability_status is one of in_stock / out_of_stock / unknown
 *   4. Optional fields are omitted, not set to null
 */
import { parseShopifyPrice, stripShopifyGid, type ShopifyProduct } from '../shopify/types';

export interface MapperContext {
  providerId: string;
  defaultCurrency: string;
  storeDomain?: string;
}

export interface Descriptor {
  pack_id: string;
  data: Record<string, unknown>;
}

export interface CommercialObject {
  ocp_version: '1.0';
  kind: 'CommercialObject';
  id: string;
  object_id: string;
  object_type: 'product';
  provider_id: string;
  title: string;
  summary?: string;
  status: 'active' | 'inactive' | 'draft';
  source_url?: string;
  descriptors: Descriptor[];
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

function imageUrlsFromProduct(p: ShopifyProduct): string[] {
  const urls: Array<string | undefined> = [];
  if (p.featuredImage?.url) urls.push(absolutize(p.featuredImage.url));
  for (const m of p.media?.nodes ?? []) {
    urls.push(absolutize(m.preview?.image?.url));
  }
  for (const v of p.variants.nodes) {
    urls.push(absolutize(v.image?.url));
  }
  const unique: string[] = [];
  for (const u of urls) {
    if (u && !unique.includes(u)) unique.push(u);
  }
  return unique;
}

function availabilityFrom(p: ShopifyProduct): 'in_stock' | 'out_of_stock' | 'unknown' {
  const variants = p.variants.nodes;
  if (variants.length === 0) return 'unknown';
  let anyKnown = false;
  let anyAvailable = false;
  for (const v of variants) {
    if (v.availableForSale !== undefined && v.availableForSale !== null) {
      anyKnown = true;
      if (v.availableForSale) anyAvailable = true;
    }
  }
  if (!anyKnown) return 'unknown';
  return anyAvailable ? 'in_stock' : 'out_of_stock';
}

function productUrl(p: ShopifyProduct, ctx: MapperContext): string | undefined {
  if (p.onlineStoreUrl) return absolutize(p.onlineStoreUrl);
  if (ctx.storeDomain && p.handle) {
    return `https://${ctx.storeDomain}/products/${p.handle}`;
  }
  return undefined;
}

function lowestVariantPrice(p: ShopifyProduct): { amount: number; list?: number } {
  const variants = p.variants.nodes;
  if (variants.length === 0) return { amount: 0 };
  const prices = variants
    .map((v) => parseShopifyPrice(v.price))
    .filter((n) => n > 0);
  const lists = variants
    .map((v) => parseShopifyPrice(v.compareAtPrice))
    .filter((n) => n > 0);
  return {
    amount: prices.length ? Math.min(...prices) : 0,
    list: lists.length ? Math.max(...lists) : undefined,
  };
}

function statusFromShopify(s: ShopifyProduct['status']): 'active' | 'inactive' | 'draft' {
  if (s === 'ACTIVE') return 'active';
  if (s === 'DRAFT') return 'draft';
  return 'inactive';
}

export function mapShopifyProductToCommercialObject(p: ShopifyProduct, ctx: MapperContext): CommercialObject {
  const objectId = stripShopifyGid(p.id);
  const summary = htmlToPlainText(p.descriptionHtml ?? undefined);
  const images = imageUrlsFromProduct(p);
  const url = productUrl(p, ctx);
  const price = lowestVariantPrice(p);
  const availability = availabilityFrom(p);
  const sku = p.variants.nodes[0]?.sku ?? undefined;

  const attributes: Record<string, unknown> = {
    handle: p.handle,
    tags: p.tags ?? [],
    options: (p.options ?? []).map((o) => ({ name: o.name, value_count: o.values?.length ?? 0 })),
    variant_count: p.variants.nodes.length,
    variants: p.variants.nodes.map((v) => ({
      id: stripShopifyGid(v.id),
      sku: v.sku ?? null,
      title: v.title ?? null,
      price: parseShopifyPrice(v.price),
      compare_at: parseShopifyPrice(v.compareAtPrice),
      available: v.availableForSale ?? null,
      inventory: v.inventoryQuantity ?? null,
      options: v.selectedOptions ?? [],
    })),
    source: 'shopify',
    shopify_updated_at: p.updatedAt,
  };

  return {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.providerId}_${objectId}`,
    object_id: objectId,
    object_type: 'product',
    provider_id: ctx.providerId,
    title: p.title,
    ...(summary ? { summary } : {}),
    status: statusFromShopify(p.status),
    ...(url ? { source_url: url } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: p.title,
          ...(summary ? { summary } : {}),
          ...(p.vendor ? { brand: p.vendor } : {}),
          ...(p.productType ? { category: p.productType } : {}),
          ...(sku ? { sku } : {}),
          ...(url ? { product_url: url } : {}),
          image_urls: images,
          attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: ctx.defaultCurrency,
          amount: price.amount,
          ...(price.list !== undefined && price.list > price.amount
            ? { list_amount: price.list, price_type: 'range' as const }
            : { price_type: 'fixed' as const }),
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: availability,
          ...(typeof p.totalInventory === 'number' && p.totalInventory >= 0
            ? { quantity: p.totalInventory }
            : {}),
        },
      },
    ],
  };
}

/** Build a soft-delete CommercialObject for tombstone (delete) webhook events. */
export function buildTombstoneCommercialObject(productId: string, ctx: MapperContext): CommercialObject {
  const objectId = stripShopifyGid(productId);
  return {
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
        data: { title: `(removed) ${objectId}`, attributes: { tombstone: true, source: 'shopify' } },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: { currency: ctx.defaultCurrency, amount: 0, price_type: 'fixed' as const },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: { availability_status: 'out_of_stock' },
      },
    ],
  };
}
