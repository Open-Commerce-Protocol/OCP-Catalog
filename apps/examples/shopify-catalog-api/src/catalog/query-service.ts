import { planCatalogQuery } from '@ocp-catalog/catalog-core';
import { catalogQueryRequestSchema, type CatalogEntry } from '@ocp-catalog/ocp-schema';
import type { ShopifyConfig } from '../config';
import { bridgeFilters } from '../mapper/filter-bridge';
import {
  htmlToPlainText,
  mapProductToCommercialObject,
  type CommercialObject,
} from '../mapper/product-to-object';
import type { ShopifyCatalogClient } from '../shopify/mcp-client';
import { moneyToMajorUnits, stripShopifyGid, type ShopifyProduct } from '../shopify/types';
import { buildCatalogManifest, sourceId } from './manifest';

const SHIPS_TO_COUNTRY_FROM_ENV = process.env.SHOPIFY_SHIPS_TO_COUNTRY;

export class ShopifyCatalogQueryService {
  constructor(
    private readonly shopify: ShopifyCatalogClient,
    private readonly cfg: ShopifyConfig,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    const sid = sourceId(this.cfg);
    const queryPlan = planCatalogQuery(buildCatalogManifest(this.cfg).query_capabilities, request, {
      retrievalAvailable: false,
    });

    const filterResult = bridgeFilters(request, {
      mode: this.cfg.SHOPIFY_CATALOG_MODE,
      shipsToCountry: SHIPS_TO_COUNTRY_FROM_ENV,
    });

    const cursorPaginationWarning =
      'Shopify Catalog pagination is cursor-based and is not yet exposed through OCP cursor pagination.';

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

    const hasUnbridgedCursorPage = Boolean(
      upstream.pagination?.has_next_page || upstream.pagination?.cursor,
    );

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: this.cfg.SHOPIFY_CATALOG_ID,
      query_pack: queryPlan.selectedQueryPack,
      query_mode: queryPlan.queryMode,
      query: request.query,
      result_count: objects.length,
      page: {
        limit: request.limit,
        offset: request.offset,
        has_more: false,
      },
      entries: products.map((product, idx) =>
        queryItemFromProduct(product, objects[idx], this.cfg.SHOPIFY_CATALOG_ID, sid, request.query),
      ),
      policy_summary: {
        selected_capability_id: 'ocp.shopify.product.search.v1',
        selected_query_pack: queryPlan.selectedQueryPack,
        query_mode: queryPlan.queryMode,
        supports_explain: true,
        accepted_filters: filterResult.acceptedFilters,
        rejected_filters: filterResult.rejectedFilters,
        warnings: hasUnbridgedCursorPage
          ? [...filterResult.warnings, cursorPaginationWarning]
          : filterResult.warnings,
      },
      explain: [
        `Forwarded keyword to Shopify search_catalog (mode=${this.cfg.SHOPIFY_CATALOG_MODE}).`,
        'Products are not persisted by this Catalog Node before query.',
        ...(hasUnbridgedCursorPage
          ? [cursorPaginationWarning]
          : []),
      ],
    };
  }
}

function queryItemFromProduct(
  product: ShopifyProduct,
  object: CommercialObject,
  catalogId: string,
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

  const entry: CatalogEntry = {
    kind: 'CatalogEntry',
    catalog_id: catalogId,
    entry_id: `entry_${sid}_${stripShopifyGid(product.id)}`,
    provider_id: sid,
    object_id: object.object_id,
    object_type: object.object_type,
    commercial_object_id: object.id,
    title: product.title,
    ...(summary ? { summary } : {}),
    attributes,
  };

  return {
    entry,
    score: query ? 1 : 0.8,
    explain: [
      'Mapped from Shopify search_catalog response.',
      'Resolve this entry to fetch variant checkout URLs.',
    ],
  };
}

function descriptor(object: CommercialObject, packId: string): Record<string, unknown> {
  return object.descriptors.find((d) => d.pack_id === packId)?.data ?? {};
}
