import { catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import type { ShopifyConfig } from '../config';
import { bridgeFilters } from '../mapper/filter-bridge';
import {
  htmlToPlainText,
  mapProductToCommercialObject,
  type CommercialObject,
} from '../mapper/product-to-object';
import type { ShopifyCatalogClient } from '../shopify/mcp-client';
import { moneyToMajorUnits, stripShopifyGid, type ShopifyProduct } from '../shopify/types';
import { sourceId } from './manifest';

const SHIPS_TO_COUNTRY_FROM_ENV = process.env.SHOPIFY_SHIPS_TO_COUNTRY;

export class ShopifyCatalogQueryService {
  constructor(
    private readonly shopify: ShopifyCatalogClient,
    private readonly cfg: ShopifyConfig,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    const sid = sourceId(this.cfg);

    const filterResult = bridgeFilters(request, {
      mode: this.cfg.SHOPIFY_CATALOG_MODE,
      shipsToCountry: SHIPS_TO_COUNTRY_FROM_ENV,
    });

    const upstream = await this.shopify.search({
      query: request.query,
      filters: Object.keys(filterResult.shopifyFilters).length > 0
        ? filterResult.shopifyFilters
        : undefined,
    });

    const products = (upstream.products ?? []).slice(0, request.limit);
    const objects = products.map((p) =>
      mapProductToCommercialObject(p, {
        sourceId: sid,
        catalogBaseUrl: this.cfg.SHOPIFY_CATALOG_PUBLIC_BASE_URL,
      }),
    );

    const hasMore = Boolean(upstream.pagination?.has_next_page);
    const nextOffset = request.offset + products.length;

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: this.cfg.SHOPIFY_CATALOG_ID,
      query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
      query_mode: request.query ? 'keyword' : 'filter',
      query: request.query,
      result_count: objects.length,
      page: {
        limit: request.limit,
        offset: request.offset,
        has_more: hasMore,
        ...(hasMore ? { next_offset: nextOffset } : {}),
      },
      items: products.map((product, idx) =>
        queryItemFromProduct(product, objects[idx], sid, request.query),
      ),
      policy_summary: {
        selected_capability_id: 'ocp.shopify.product.search.v1',
        selected_query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
        query_mode: request.query ? 'keyword' : 'filter',
        supports_explain: true,
        accepted_filters: filterResult.acceptedFilters,
        rejected_filters: filterResult.rejectedFilters,
        warnings: filterResult.warnings,
      },
      explain: [
        `Forwarded keyword to Shopify search_catalog (mode=${this.cfg.SHOPIFY_CATALOG_MODE}).`,
        'Products are not persisted by this Catalog Node before query.',
        ...(upstream.pagination?.cursor
          ? [`Upstream returned cursor (not yet bridged to OCP offset).`]
          : []),
      ],
    };
  }
}

function queryItemFromProduct(
  product: ShopifyProduct,
  object: CommercialObject,
  sid: string,
  query: string,
) {
  const productCore = descriptor(object, 'ocp.commerce.product.core.v1');
  const price = descriptor(object, 'ocp.commerce.price.v1');
  const inventory = descriptor(object, 'ocp.commerce.inventory.v1');

  const summary =
    htmlToPlainText(product.description?.plain ?? product.description?.html ?? undefined)?.slice(0, 200) ??
    undefined;

  const attributes = {
    ...productCore,
    price,
    inventory,
    rating: product.rating ?? null,
    source_id: sid,
    source_object_id: product.id,
    handle: product.handle ?? null,
    seller: product.variants?.[0]?.seller ?? null,
    media: product.media ?? [],
    has_native_checkout: product.variants?.some((v) => v.eligible?.native_checkout) ?? false,
    price_range_minor: product.price_range ?? null,
    price_range_major:
      product.price_range
        ? {
            min: moneyToMajorUnits(product.price_range.min),
            max: moneyToMajorUnits(product.price_range.max),
            currency:
              product.price_range.min?.currency ?? product.price_range.max?.currency ?? null,
          }
        : null,
  };

  return {
    entry_id: `entry_${sid}_${stripShopifyGid(product.id)}`,
    provider_id: sid,
    object_id: object.object_id,
    title: product.title,
    ...(summary ? { summary } : {}),
    score: query ? 1 : 0.8,
    attributes,
    explain: [
      'Mapped from Shopify search_catalog response.',
      'Resolve this entry to fetch variant checkout URLs.',
    ],
  };
}

function descriptor(object: CommercialObject, packId: string): Record<string, unknown> {
  return object.descriptors.find((d) => d.pack_id === packId)?.data ?? {};
}
