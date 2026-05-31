import { catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import type { JdUnionClient } from '../jd/client';
import type { JdGoodsItem } from '../jd/types';
import type { JdUnionConfig } from '../config';
import {
  mapGoodsToCommercialObject,
  type CommercialObject,
} from '../mapper/goods-to-object';
import { sourceId } from './manifest';

export class JdUnionCatalogQueryService {
  constructor(
    private readonly jd: JdUnionClient,
    private readonly cfg: JdUnionConfig,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    const pageSize = Math.min(request.limit, this.cfg.JDUNION_DEFAULT_PAGE_SIZE);
    const pageIndex = Math.floor(request.offset / pageSize) + 1;

    const upstream = await this.jd.listGoods({
      keyword: request.query || undefined,
      pageIndex,
      pageSize,
    });
    const goods = upstream.data ?? [];
    const total = upstream.totalCount ?? goods.length;
    const objects = goods.map((item) =>
      mapGoodsToCommercialObject(item, {
        sourceId: sourceId(),
        catalogBaseUrl: this.cfg.JDUNION_CATALOG_PUBLIC_BASE_URL,
      }),
    );

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: this.cfg.JDUNION_CATALOG_ID,
      query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
      query_mode: request.query ? 'keyword' : 'filter',
      query: request.query,
      result_count: objects.length,
      page: {
        limit: pageSize,
        offset: request.offset,
        has_more: request.offset + objects.length < total,
        ...(request.offset + objects.length < total
          ? { next_offset: request.offset + objects.length }
          : {}),
      },
      items: objects.map((object, index) =>
        queryItemFromObject(object, goods[index]!, request.query),
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
        'JD Union affiliate catalog queried upstream goods API in real time.',
        'Products are not persisted by this Catalog Node before query.',
      ],
    };
  }
}

function queryItemFromObject(
  object: CommercialObject,
  goods: JdGoodsItem,
  query: string,
) {
  const product = descriptor(object, 'ocp.commerce.product.core.v1');
  const price = descriptor(object, 'ocp.commerce.price.v1');
  const productAttrs = (product.attributes as Record<string, unknown>) ?? {};
  const bestCoupon =
    goods.couponInfo?.couponList?.find((c) => c.isBest === 1) ??
    goods.couponInfo?.couponList?.[0];
  const couponSummary =
    bestCoupon?.discount !== undefined && bestCoupon?.quota !== undefined
      ? `JD Union offer with coupon: 满 ${bestCoupon.quota} 元减 ${bestCoupon.discount} 元`
      : null;

  const attributes = {
    ...product,
    price,
    source_id: sourceId(),
    source_object_id: object.object_id,
    platform: 'jd',
    has_coupon: Boolean(bestCoupon),
    coupon_info: couponSummary,
    commission_rate_bp: productAttrs.commission_rate_bp ?? null,
    jd_owner: productAttrs.jd_owner ?? null,
    shop_name: productAttrs.shop_name ?? null,
  };

  return {
    entry_id: `entry_${sourceId()}_${object.object_id}`,
    provider_id: sourceId(),
    object_id: object.object_id,
    title: object.title,
    summary: couponSummary ?? 'Affiliate offer from JD Union.',
    score: query ? 1 : 0.8,
    attributes,
    explain: [
      'Mapped from JD jd.union.open.goods.query response.',
      'Resolve this entry to mint PID-attributed purchase URLs (u.jd.com).',
    ],
  };
}

function descriptor(object: CommercialObject, packId: string) {
  return object.descriptors.find((item) => item.pack_id === packId)?.data ?? {};
}
