/**
 * Mapper: Shopify Product → OCP-style CommercialObject.
 *
 * Translation rules:
 *   - title / description / url / categories / media → ocp.commerce.product.core.v1
 *   - price_range (min/max minor units → major units)  → ocp.commerce.price.v1
 *   - aggregated variants[].availability               → ocp.commerce.inventory.v1
 *   - rating / seller / has_native_checkout / variants → product.core.v1.attributes
 *
 * Invariants pinned by unit tests:
 *   1. All image URLs are absolute https://
 *   2. price.amount is a number in major units (e.g. 19.99), not the integer Shopify returns
 *   3. inventory.availability_status is one of 'in_stock' | 'out_of_stock' | 'unknown'
 *   4. Optional fields are omitted, not set to undefined
 */
import { commercialObjectSchema, type CommercialObject } from '@ocp-catalog/ocp-schema';
import {
  moneyToMajorUnits,
  stripShopifyGid,
  type ShopifyImage,
  type ShopifyProduct,
} from '../shopify/types';

export type { CommercialObject };

export interface MapperContext {
  sourceId: string;
  catalogBaseUrl: string;
}

export function absolutize(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

export function htmlToPlainText(html: string | undefined): string | undefined {
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

export function summarizeAvailability(
  variants: ShopifyProduct['variants'],
): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (!variants || variants.length === 0) return 'unknown';
  let anyKnown = false;
  let anyAvailable = false;
  for (const v of variants) {
    if (v.availability?.available !== undefined) {
      anyKnown = true;
      if (v.availability.available) anyAvailable = true;
    }
  }
  if (!anyKnown) return 'unknown';
  return anyAvailable ? 'in_stock' : 'out_of_stock';
}

function imageList(media: ShopifyImage[] | undefined): string[] {
  if (!media) return [];
  return media
    .filter((m) => !m.type || m.type === 'image')
    .map((m) => absolutize(m.url))
    .filter((u): u is string => Boolean(u));
}

function primaryCategory(product: ShopifyProduct): string | undefined {
  const first = product.categories?.[0];
  if (!first) return undefined;
  return first.value;
}

function brandFromSeller(product: ShopifyProduct): string | undefined {
  const seller = product.variants?.[0]?.seller;
  return seller?.name ?? undefined;
}

export function mapProductToCommercialObject(
  p: ShopifyProduct,
  ctx: MapperContext,
): CommercialObject {
  const objectId = stripShopifyGid(p.id);
  // Real Shopify products often omit `url` and put the PDP URL on the first
  // variant instead. Fall back to that so OCP `source_url` is populated.
  const productUrl =
    absolutize(p.url ?? undefined) ??
    absolutize(p.variants?.find((v) => v.url)?.url);
  const images = imageList(p.media);
  const category = primaryCategory(p);
  const brand = brandFromSeller(p);
  const summary = htmlToPlainText(p.description?.plain ?? p.description?.html ?? undefined);
  const availability = summarizeAvailability(p.variants);
  const hasNativeCheckout = (p.variants ?? []).some((v) => v.eligible?.native_checkout);

  const minPrice = moneyToMajorUnits(p.price_range?.min);
  const maxPrice = moneyToMajorUnits(p.price_range?.max);
  const currency = p.price_range?.min?.currency ?? p.price_range?.max?.currency ?? 'USD';
  const priceType = maxPrice > minPrice ? 'range' : 'fixed';

  const attributes: Record<string, unknown> = {
    rating: p.rating ?? null,
    has_native_checkout: hasNativeCheckout,
    variant_count: p.variants?.length ?? 0,
    price_max: priceType === 'range' ? maxPrice : null,
    options_summary: (p.options ?? []).map((o) => ({
      name: o.name,
      value_count: o.values?.length ?? 0,
    })),
    affiliate_source: 'shopify_catalog',
  };

  const object: CommercialObject = {
    ocp_version: '1.0',
    kind: 'CommercialObject',
    id: `obj_${ctx.sourceId}_${objectId}`,
    object_id: objectId,
    object_type: 'product',
    provider_id: ctx.sourceId,
    title: p.title,
    status: 'active',
    ...(productUrl ? { source_url: productUrl } : {}),
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: p.title,
          ...(summary ? { summary } : {}),
          ...(brand ? { brand } : {}),
          ...(category ? { category } : {}),
          sku: objectId,
          ...(productUrl ? { product_url: productUrl } : {}),
          image_urls: images,
          attributes,
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency,
          amount: minPrice,
          price_type: priceType,
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: availability,
        },
      },
    ],
  };
  return commercialObjectSchema.parse(object);
}
