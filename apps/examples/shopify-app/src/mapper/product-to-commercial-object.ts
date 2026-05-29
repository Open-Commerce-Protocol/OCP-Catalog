/**
 * Mapper: Shopify Admin Product → OCP CommercialObject.
 * One OCP object per Shopify product; variant detail kept under attributes.
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
  const t = url.trim();
  if (!t) return undefined;
  if (t.startsWith('//')) return 'https:' + t;
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return 'https://' + t;
}

function imageUrls(p: ShopifyProduct): string[] {
  const urls: Array<string | undefined> = [];
  if (p.featuredImage?.url) urls.push(absolutize(p.featuredImage.url));
  for (const m of p.media?.nodes ?? []) urls.push(absolutize(m.preview?.image?.url));
  for (const v of p.variants.nodes) urls.push(absolutize(v.image?.url));
  const out: string[] = [];
  for (const u of urls) if (u && !out.includes(u)) out.push(u);
  return out;
}

function availability(p: ShopifyProduct): 'in_stock' | 'out_of_stock' | 'unknown' {
  const variants = p.variants.nodes;
  if (variants.length === 0) return 'unknown';
  let known = false;
  let avail = false;
  for (const v of variants) {
    if (v.availableForSale !== undefined && v.availableForSale !== null) {
      known = true;
      if (v.availableForSale) avail = true;
    }
  }
  if (!known) return 'unknown';
  return avail ? 'in_stock' : 'out_of_stock';
}

function productUrl(p: ShopifyProduct, ctx: MapperContext): string | undefined {
  if (p.onlineStoreUrl) return absolutize(p.onlineStoreUrl);
  if (ctx.storeDomain && p.handle) return `https://${ctx.storeDomain}/products/${p.handle}`;
  return undefined;
}

function lowestPrice(p: ShopifyProduct): { amount: number; list?: number } {
  const prices = p.variants.nodes.map((v) => parseShopifyPrice(v.price)).filter((n) => n > 0);
  const lists = p.variants.nodes.map((v) => parseShopifyPrice(v.compareAtPrice)).filter((n) => n > 0);
  return { amount: prices.length ? Math.min(...prices) : 0, list: lists.length ? Math.max(...lists) : undefined };
}

function statusOf(s: ShopifyProduct['status']): 'active' | 'inactive' | 'draft' {
  if (s === 'ACTIVE') return 'active';
  if (s === 'DRAFT') return 'draft';
  return 'inactive';
}

export function mapShopifyProductToCommercialObject(p: ShopifyProduct, ctx: MapperContext): CommercialObject {
  const objectId = stripShopifyGid(p.id);
  const summary = htmlToPlainText(p.descriptionHtml ?? undefined);
  const images = imageUrls(p);
  const url = productUrl(p, ctx);
  const price = lowestPrice(p);
  const avail = availability(p);
  const sku = p.variants.nodes[0]?.sku ?? undefined;

  const attributes: Record<string, unknown> = {
    handle: p.handle,
    tags: p.tags ?? [],
    variant_count: p.variants.nodes.length,
    variants: p.variants.nodes.map((v) => ({
      id: stripShopifyGid(v.id),
      sku: v.sku ?? null,
      title: v.title ?? null,
      price: parseShopifyPrice(v.price),
      available: v.availableForSale ?? null,
      options: v.selectedOptions ?? [],
    })),
    source: 'shopify_app',
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
    status: statusOf(p.status),
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
          availability_status: avail,
          ...(typeof p.totalInventory === 'number' && p.totalInventory >= 0 ? { quantity: p.totalInventory } : {}),
        },
      },
    ],
  };
}

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
      { pack_id: 'ocp.commerce.product.core.v1', data: { title: `(removed) ${objectId}`, attributes: { tombstone: true, source: 'shopify_app' } } },
      { pack_id: 'ocp.commerce.price.v1', data: { currency: ctx.defaultCurrency, amount: 0, price_type: 'fixed' as const } },
      { pack_id: 'ocp.commerce.inventory.v1', data: { availability_status: 'out_of_stock' } },
    ],
  };
}

/** Stable OCP provider_id derived from the shop domain. */
export function providerIdForShop(shopDomain: string): string {
  return `shopify_app_${shopDomain.replace(/\.myshopify\.com$/, '').replace(/[^a-z0-9_]/gi, '_')}`;
}
