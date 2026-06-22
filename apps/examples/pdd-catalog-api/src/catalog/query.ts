import { catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import type { PddClient } from '../pdd/client';
import type { PddGoodsItem } from '../pdd/types';
import type { PddConfig } from '../config';
import {
  mapGoodsToCommercialObject,
  fenToYuan,
  type CommercialObject,
} from '../mapper/goods-to-object';
import { sourceId } from './manifest';

export class PddCatalogQueryService {
  constructor(
    private readonly pdd: PddClient,
    private readonly cfg: PddConfig,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    const pageSize = Math.min(request.limit, this.cfg.PDD_DEFAULT_PAGE_SIZE);
    const page = Math.floor(request.offset / pageSize) + 1;
    const category = typeof request.filters.category === 'string'
      ? request.filters.category
      : undefined;
    const catId = category && /^\d+$/.test(category) ? Number(category) : undefined;

    const upstream = await this.pdd.listGoods({
      keyword: request.query || undefined,
      page,
      pageSize,
      catId,
    });
    const goods = upstream.goods_list ?? [];
    const total = upstream.total_count ?? goods.length;
    const objects = goods.map((item) =>
      mapGoodsToCommercialObject(item, {
        sourceId: sourceId(),
        catalogBaseUrl: this.cfg.PDD_CATALOG_PUBLIC_BASE_URL,
      }),
    );

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: this.cfg.PDD_CATALOG_ID,
      query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
      query_mode: request.query ? 'keyword' : 'filter',
      query: request.query,
      result_count: objects.length,
      page: {
        limit: pageSize,
        offset: request.offset,
        has_more: request.offset + objects.length < total,
      },
      entries: objects.map((object, index) =>
        queryItemFromObject(object, goods[index]!, this.cfg.PDD_CATALOG_ID, request.query),
      ),
      policy_summary: {
        selected_capability_id: 'ocp.affiliate.product.search.v1',
        selected_query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
        query_mode: request.query ? 'keyword' : 'filter',
        supports_explain: true,
        accepted_filters: Object.keys(request.filters),
        rejected_filters: [],
        warnings: [],
      },
      explain: [
        'PDD Duoduojinbao affiliate catalog queried upstream goods API in real time.',
        'Products are not persisted by this Catalog Node before query.',
      ],
    };
  }
}

function queryItemFromObject(
  object: CommercialObject,
  goods: PddGoodsItem,
  catalogId: string,
  query: string,
) {
  const product = descriptor(object, 'ocp.commerce.product.core.v1');
  const price = descriptor(object, 'ocp.commerce.price.v1');
  const productAttrs = (product.attributes as Record<string, unknown>) ?? {};
  const hasCoupon = Boolean(goods.has_coupon);
  const couponSummary =
    hasCoupon && goods.coupon_min_order_amount !== undefined && goods.coupon_discount !== undefined
      ? `PDD offer with coupon: 满 ${fenToYuan(goods.coupon_min_order_amount)} 元减 ${fenToYuan(goods.coupon_discount)} 元`
      : null;

  const attributes = {
    ...product,
    price,
    source_id: sourceId(),
    source_object_id: object.object_id,
    platform: 'pdd',
    has_coupon: hasCoupon,
    coupon_info: couponSummary,
    commission_rate_bp: productAttrs.commission_rate_bp ?? null,
    pdd_merchant_type: productAttrs.pdd_merchant_type ?? null,
    mall_name: productAttrs.mall_name ?? null,
    sales_tip: productAttrs.sales_tip ?? null,
  };

  return {
    score: query ? 1 : 0.8,
    entry: {
      kind: 'CatalogEntry',
      catalog_id: catalogId,
      entry_id: `entry_${sourceId()}_${object.object_id}`,
      provider_id: sourceId(),
      object_id: object.object_id,
      title: object.title,
      summary: couponSummary ?? 'Affiliate offer from PDD Duoduojinbao.',
      attributes,
    },
    explain: [
      'Mapped from PDD pdd.ddk.goods.search response.',
      'Resolve this entry to mint PID-attributed purchase URLs (p.pinduoduo.com).',
    ],
  };
}

function descriptor(object: CommercialObject, packId: string) {
  return object.descriptors.find((item) => item.pack_id === packId)?.data ?? {};
}
