import { resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import type { AlimamaClient } from '../alimama/client';
import type { AlimamaConfig } from '../config';
import { privilegeToAffiliateLinks } from '../mapper/privilege-to-link';
import { sourceId } from './manifest';

export class AffiliateCatalogResolveService {
  constructor(
    private readonly alimama: AlimamaClient,
    private readonly cfg: AlimamaConfig,
  ) {}

  async resolve(input: unknown) {
    const request = resolveRequestSchema.parse(input);
    const objectId = objectIdFromEntry(request.entry_id);
    const checkedAt = new Date();
    const privilege = await this.alimama.generatePrivilegeLink({
      itemId: objectId,
      adzoneId: this.cfg.ALIMAMA_ADZONE_ID,
      externalId: request.entry_id,
    });
    const links = privilegeToAffiliateLinks(privilege.tbk_privilege_get_response?.result?.data);

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
      title: `Alimama affiliate item ${objectId}`,
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
          check_id: 'alimama_privilege_link',
          status: links.length > 0 ? 'passed' : 'unknown',
          checked_at: checkedAt.toISOString(),
          summary: links.length > 0 ? 'Alimama returned affiliate links.' : 'No affiliate links returned.',
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
