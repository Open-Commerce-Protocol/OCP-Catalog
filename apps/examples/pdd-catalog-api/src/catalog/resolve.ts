import { resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import type { PddClient } from '../pdd/client';
import type { PddConfig } from '../config';
import {
  promotionUrlToAffiliateLinks,
  type AffiliateLink,
} from '../mapper/url-to-link';
import { sourceId } from './manifest';

/**
 * /ocp/resolve 服务。
 *
 * 关键设计:
 *   - 单一 resolve 路径(unlike JD 的 A/B 双策略):
 *     调 pdd.ddk.goods.promotion.url.generate 单 API,拿带 PID 归因的短链
 *   - custom_parameters 透传机制 (由 cfg.PDD_CUSTOM_PARAMS_MODE 控制):
 *     - 'enabled': 把 OCP entry_id 塞进 custom_parameters.sid,订单回流时反查
 *     - 'disabled': 不透传,订单回流时 externalId/agentExternalId 都是 null
 *   - 与 alimama / JD resolve 一致: catalog 保持无状态,每次实时打上游
 *   - 上游失败时降级到 unknown + action_bindings=[],不抛 500
 *
 * 未来扩展点:
 *   - 当 OCP resolveRequestSchema 加入 agent 字段后,把 request.agent.agent_id
 *     塞进 custom_parameters.uid,实现 per-Agent 归因
 */
export class PddCatalogResolveService {
  constructor(
    private readonly pdd: PddClient,
    private readonly cfg: PddConfig,
  ) {}

  async resolve(input: unknown) {
    const request = resolveRequestSchema.parse(input);
    const objectId = objectIdFromEntry(request.entry_id);
    const checkedAt = new Date();

    // 构造 custom_parameters (PoC 阶段只塞 sid;OCP schema 支持 agent 后再加 uid)
    const customParameters =
      this.cfg.PDD_CUSTOM_PARAMS_MODE === 'enabled'
        ? JSON.stringify({ sid: request.entry_id })
        : undefined;

    let links: AffiliateLink[] = [];
    let title = `PDD affiliate item ${objectId}`;
    let strategySummary =
      'PDD Duoduojinbao returned affiliate links via promotion.url.generate.';

    try {
      const items = await this.pdd.generatePromotionUrl({
        goodsIdList: [objectId],
        customParameters,
      });
      const item = items[0];
      if (item) {
        links = promotionUrlToAffiliateLinks(item);
      }
    } catch (err) {
      links = [];
      strategySummary =
        err instanceof Error
          ? `Upstream call failed: ${err.message}`
          : 'Upstream call failed.';
    }

    return {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: `resolve_${crypto.randomUUID()}`,
      catalog_id: this.cfg.PDD_CATALOG_ID,
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
        pid: this.cfg.PDD_PID,
        link_count: links.length,
        custom_params_mode: this.cfg.PDD_CUSTOM_PARAMS_MODE,
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
          check_id: 'pdd_promotion_url_generate',
          status: links.length > 0 ? 'passed' : 'unknown',
          checked_at: checkedAt.toISOString(),
          summary:
            links.length > 0
              ? strategySummary
              : 'No affiliate links returned for this goods id.',
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
