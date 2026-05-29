import { resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import type { JdUnionClient } from '../jd/client';
import type { JdUnionConfig } from '../config';
import { goodsToAffiliateLinks, type AffiliateLink } from '../mapper/goods-to-link';
import { promotionToAffiliateLinks } from '../mapper/promotion-to-link';
import { sourceId } from './manifest';

/**
 * /ocp/resolve 服务。
 *
 * 关键设计:
 *   - 配置驱动的两条 resolve 路径,由 JDUNION_RESOLVE_STRATEGY 切换:
 *
 *     1) 'goods_promotion' (默认): 调 jd.union.open.goods.promotiongoodsinfo.query
 *        单 API 一次拿到单品 + affiliate URL (shortURL/clickURL)。
 *        与 alimama 用 material.optional.upgrade 替代 privilege.get 的策略同构。
 *
 *     2) 'promotion_common': 调 jd.union.open.promotion.common.get 显式转链。
 *        需要先把 skuId 拼成 item.jd.com 落地页 URL 作为 materialId。
 *        优点:字段最稳定;缺点:多一次 API 调用。
 *
 *   - 与 alimama resolve 一致:catalog 保持无状态,每次 resolve 实时打上游。
 *   - 失败时 live_checks.status='unknown' + action_bindings=[],而非抛 500。
 */
export class JdUnionCatalogResolveService {
  constructor(
    private readonly jd: JdUnionClient,
    private readonly cfg: JdUnionConfig,
  ) {}

  async resolve(input: unknown) {
    const request = resolveRequestSchema.parse(input);
    const objectId = objectIdFromEntry(request.entry_id);
    const checkedAt = new Date();

    let links: AffiliateLink[] = [];
    let title = `JD affiliate item ${objectId}`;
    let strategyCheckId = 'jdunion_goods_lookup';
    let strategySummary = 'JD Union returned affiliate links via goods.promotiongoodsinfo.query.';

    try {
      if (this.cfg.JDUNION_RESOLVE_STRATEGY === 'promotion_common') {
        strategyCheckId = 'jdunion_promotion_link_mint';
        strategySummary =
          'JD Union returned affiliate link via promotion.common.get.';
        const materialId = `https://item.jd.com/${objectId}.html`;
        const data = await this.jd.getPromotionCommonLink({
          materialId,
          ext1: request.entry_id,
        });
        links = promotionToAffiliateLinks(data);
      } else {
        const res = await this.jd.getPromotionGoodsInfo({
          skuIds: [objectId],
        });
        const item = res.result?.[0];
        if (item) {
          title = item.goodsName ?? title;
          links = goodsToAffiliateLinks(item);
        }
      }
    } catch (err) {
      // 上游失败不阻塞 resolve,降级到空 action_bindings + live_check unknown
      links = [];
      strategySummary =
        err instanceof Error
          ? `Upstream call failed: ${err.message}`
          : 'Upstream call failed.';
    }

    const positionId = this.cfg.JDUNION_POSITION_ID;

    return {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: `resolve_${crypto.randomUUID()}`,
      catalog_id: this.cfg.JDUNION_CATALOG_ID,
      entry_id: request.entry_id,
      commercial_object_id: `obj_${sourceId()}_${objectId}`,
      object_id: objectId,
      object_type: 'product',
      provider_id: sourceId(),
      title,
      visible_attributes: {
        source_id: sourceId(),
        source_type: 'affiliate_network',
        source_object_id: objectId,
        position_id: positionId,
        link_count: links.length,
        resolve_strategy: this.cfg.JDUNION_RESOLVE_STRATEGY,
      },
      access: {
        visibility: 'public',
        permission_state: 'granted',
        redacted_fields: [],
        policy_notes: [
          'Affiliate purchase links are minted at resolve time and may expire.',
        ],
      },
      live_checks: [
        {
          check_id: strategyCheckId,
          status: links.length > 0 ? 'passed' : 'unknown',
          checked_at: checkedAt.toISOString(),
          summary:
            links.length > 0
              ? strategySummary
              : 'No affiliate links returned for this sku id.',
        },
      ],
      action_bindings: links.map((link) => ({
        action_id: link.link_id,
        action_type: 'url',
        label: link.label,
        description: link.description,
        entrypoint: {
          url: link.url,
          method: 'GET',
        },
        auth_requirements: {},
        requires_user_confirmation: true,
      })),
      freshness: {
        object_updated_at: checkedAt.toISOString(),
        resolved_at: checkedAt.toISOString(),
      },
      expires_at: new Date(checkedAt.getTime() + 15 * 60 * 1000).toISOString(),
    };
  }
}

function objectIdFromEntry(entryId: string) {
  const prefix = `entry_${sourceId()}_`;
  return entryId.startsWith(prefix) ? entryId.slice(prefix.length) : entryId;
}
