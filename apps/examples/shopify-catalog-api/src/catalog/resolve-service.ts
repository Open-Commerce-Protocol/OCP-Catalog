import { resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import type { ShopifyConfig } from '../config';
import { variantsToActions } from '../mapper/variant-to-action';
import type { ShopifyCatalogClient } from '../shopify/mcp-client';
import { sourceId } from './manifest';

const RESOLVE_TTL_MS = 15 * 60 * 1000;

export class ShopifyCatalogResolveService {
  constructor(
    private readonly shopify: ShopifyCatalogClient,
    private readonly cfg: ShopifyConfig,
  ) {}

  async resolve(input: unknown) {
    const request = resolveRequestSchema.parse(input);
    const sid = sourceId(this.cfg);
    const productGid = productGidFromEntryId(request.entry_id, sid);

    const upstream = await this.shopify.getProduct({ id: productGid });
    const product = upstream.product;
    const checkedAt = new Date();

    const actions = variantsToActions(product.variants, { productTitle: product.title });
    const variants = product.variants ?? [];
    const availableCount = variants.filter((v) => v.availability?.available !== false).length;

    const liveStatus: 'passed' | 'failed' | 'unknown' =
      variants.length === 0 ? 'unknown' : availableCount > 0 ? 'passed' : 'failed';

    return {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: `resolve_${crypto.randomUUID()}`,
      catalog_id: this.cfg.SHOPIFY_CATALOG_ID,
      entry_id: request.entry_id,
      commercial_object_id: `obj_${sid}_${stripGid(product.id)}`,
      object_id: stripGid(product.id),
      object_type: 'product',
      provider_id: sid,
      title: product.title,
      visible_attributes: {
        source_id: sid,
        source_type: 'shopify_catalog',
        source_object_id: product.id,
        selected_options: product.selected ?? [],
        available_variants: availableCount,
        total_variants: variants.length,
        rating: product.rating ?? null,
        url: product.url ?? null,
      },
      access: {
        visibility: 'public',
        permission_state: 'granted',
        redacted_fields: [],
        policy_notes: [
          'Shopify checkout URLs may expire or change once inventory state changes.',
          'Higher-trust agents can invoke Shopify Cart/Checkout MCP directly; this node only exposes URL action bindings.',
        ],
      },
      live_checks: [
        {
          check_id: 'shopify_variant_availability',
          status: liveStatus,
          checked_at: checkedAt.toISOString(),
          summary: `${availableCount}/${variants.length} variants available`,
          details: { mock: this.cfg.SHOPIFY_MOCK },
        },
      ],
      action_bindings: actions,
      freshness: {
        object_updated_at: checkedAt.toISOString(),
        resolved_at: checkedAt.toISOString(),
      },
      expires_at: new Date(checkedAt.getTime() + RESOLVE_TTL_MS).toISOString(),
    };
  }
}

function stripGid(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\//, '');
}

/**
 * entry_id is shaped `entry_<sid>_<gid-suffix>`. Reconstruct the original
 * Shopify GID so we can call get_product. We don't know in advance whether
 * the suffix is `Product/...` or `p/...` (Global uses `p/{upid}`, Storefront
 * uses `Product/{id}`), so we just re-prefix and let Shopify decide.
 */
function productGidFromEntryId(entryId: string, sid: string): string {
  const prefix = `entry_${sid}_`;
  const suffix = entryId.startsWith(prefix) ? entryId.slice(prefix.length) : entryId;
  if (suffix.startsWith('gid://')) return suffix;
  return `gid://shopify/${suffix}`;
}
