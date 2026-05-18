import { catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaMaterialItem } from '../alimama/types';
import type { AlimamaConfig } from '../config';
import { mapMaterialToCommercialObject, type CommercialObject } from '../mapper/material-to-object';
import type { MaterialResolveCache } from './material-cache';
import { sourceId } from './manifest';

export class AffiliateCatalogQueryService {
  constructor(
    private readonly alimama: AlimamaClient,
    private readonly cfg: AlimamaConfig,
    private readonly resolveCache?: MaterialResolveCache,
  ) {}

  async query(input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    const category = typeof request.filters.category === 'string' ? request.filters.category : undefined;
    const pageSize = Math.min(request.limit, this.cfg.ALIMAMA_DEFAULT_PAGE_SIZE);
    const upstream = await this.alimama.listMaterial({
      q: request.query || undefined,
      cat: category,
      pageNo: Math.floor(request.offset / pageSize) + 1,
      pageSize,
    });
    const materials = upstream.tbk_dg_material_optional_response?.result_list?.map_data ?? [];
    const total = upstream.tbk_dg_material_optional_response?.total_results ?? materials.length;
    const objects = materials.map((item) => mapMaterialToCommercialObject(item, {
      sourceId: sourceId(),
      catalogBaseUrl: this.cfg.ALIMAMA_CATALOG_PUBLIC_BASE_URL,
    }));

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: this.cfg.ALIMAMA_CATALOG_ID,
      query_pack: request.query_pack ?? 'ocp.query.keyword.v1',
      query_mode: request.query ? 'keyword' : 'filter',
      query: request.query,
      result_count: objects.length,
      page: {
        limit: pageSize,
        offset: request.offset,
        has_more: request.offset + objects.length < total,
        ...(request.offset + objects.length < total ? { next_offset: request.offset + objects.length } : {}),
      },
      items: objects.map((object, index) => {
        const item = queryItemFromObject(object, materials[index], request.query);
        this.resolveCache?.set(item.entry_id, materials[index]);
        return item;
      }),
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
        'Alimama affiliate catalog queried upstream material API in real time.',
        'Products are not persisted by this Catalog Node before query.',
      ],
    };
  }
}

function queryItemFromObject(object: CommercialObject, material: AlimamaMaterialItem, query: string) {
  const product = descriptor(object, 'ocp.commerce.product.core.v1');
  const price = descriptor(object, 'ocp.commerce.price.v1');
  const attributes = {
    ...product,
    price,
    source_id: sourceId(),
    source_object_id: object.object_id,
    platform: product.platform ?? (material.user_type === 1 ? 'tmall' : 'taobao'),
    has_coupon: Boolean(material.coupon_info),
    coupon_info: material.coupon_info ?? null,
    commission_rate_bp: material.commission_rate ?? null,
  };
  return {
    entry_id: `entry_${sourceId()}_${object.object_id}`,
    provider_id: sourceId(),
    object_id: object.object_id,
    title: object.title,
    summary: material.coupon_info ? `Affiliate offer with coupon: ${material.coupon_info}` : 'Affiliate offer from Alimama.',
    score: query ? 1 : 0.8,
    attributes,
    explain: [
      'Mapped from Alimama material.optional response.',
      'Resolve this entry to mint PID-attributed purchase URLs.',
    ],
  };
}

function descriptor(object: CommercialObject, packId: string) {
  return object.descriptors.find((item) => item.pack_id === packId)?.data ?? {};
}
