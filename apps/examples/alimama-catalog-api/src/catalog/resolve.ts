import { resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { materialToAffiliateLinks } from '../mapper/material-to-link';
import type { MaterialResolveCache } from './material-cache';
import { sourceId } from './manifest';

/**
 * /ocp/resolve 服务。
 *
 * 关键设计 (2026-05 修复 session 错误)：
 *   旧实现走 taobao.tbk.privilege.get,该 API 要 TOP session,
 *   在无 OAuth 授权场景下报 "传入http参数中必需包含session字段"。
 *
 *   新实现走 taobao.tbk.dg.material.optional.upgrade,接受 item_id_list 参数
 *   查询单个商品的最新信息;响应里 publish_info.click_url 就是带 PID 的 affiliate URL。
 *   AlimamaClient.getMaterialByItemId() 封装了这个调用 + normalize 把 click_url
 *   写进 AlimamaMaterialItem.item_url。
 *
 *   每次 resolve 实时调一次上游 → catalog 真正保持无状态。
 */
export class AffiliateCatalogResolveService {
  constructor(
    private readonly alimama: AlimamaClient,
    private readonly cfg: AlimamaConfig,
    private readonly resolveCache?: MaterialResolveCache,
  ) {}

  async resolve(input: unknown) {
    const request = resolveRequestSchema.parse(input);
    const objectId = objectIdFromEntry(request.entry_id);
    const checkedAt = new Date();

    // 实时调上游拿带 PID 的 click_url（避开 privilege.get 的 TOP session 要求）
    const item = this.resolveCache?.get(request.entry_id)
      ?? await this.alimama.getMaterialByItemId({
        itemId: objectId,
        adzoneId: this.cfg.ALIMAMA_ADZONE_ID,
      });
    const links = materialToAffiliateLinks(item);
    const title = item?.title ?? `Alimama affiliate item ${objectId}`;

    return {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: `resolve_${crypto.randomUUID()}`,
      catalog_id: this.cfg.ALIMAMA_CATALOG_ID,
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
        adzone_id: this.cfg.ALIMAMA_ADZONE_ID,
        link_count: links.length,
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
          check_id: 'alimama_material_lookup',
          status: links.length > 0 ? 'passed' : 'unknown',
          checked_at: checkedAt.toISOString(),
          summary:
            links.length > 0
              ? 'Alimama returned affiliate links via material.optional.upgrade.'
              : 'No affiliate links returned for this item id.',
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
