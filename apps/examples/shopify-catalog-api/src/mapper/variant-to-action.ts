/**
 * Mapper: Shopify Variant → OCP ActionBinding.
 *
 * Each available variant with a non-empty `checkout_url` becomes one
 * action_binding the agent can present to the user. Unavailable or
 * url-less variants are skipped.
 */
import { moneyToMajorUnits, stripShopifyGid, type ShopifyVariant } from '../shopify/types';

export interface ActionBinding {
  action_id: string;
  action_type: 'url';
  label: string;
  description?: string;
  entrypoint: { url: string; method: 'GET' };
  auth_requirements: Record<string, unknown>;
  requires_user_confirmation: boolean;
}

export interface VariantContext {
  productTitle: string;
}

export function mapVariantToAction(
  v: ShopifyVariant,
  ctx: VariantContext,
): ActionBinding | null {
  if (!v.checkout_url) return null;
  if (v.availability?.available === false) return null;

  const variantId = stripShopifyGid(v.id);
  const optionLabel = (v.options ?? [])
    .map((o) => `${o.name}: ${o.label}`)
    .join(', ');
  const priceMajor = moneyToMajorUnits(v.price);
  const currency = v.price?.currency;
  const priceSuffix = currency && priceMajor > 0 ? ` (${priceMajor} ${currency})` : '';

  return {
    action_id: `action_${variantId}`,
    action_type: 'url',
    label: optionLabel ? `${ctx.productTitle} — ${optionLabel}` : ctx.productTitle,
    description: [
      v.sku ? `SKU ${v.sku}` : null,
      v.eligible?.native_checkout ? 'native checkout supported' : null,
      v.availability?.running_low ? 'running low' : null,
    ]
      .filter(Boolean)
      .join('; ') + priceSuffix,
    entrypoint: { url: v.checkout_url, method: 'GET' },
    auth_requirements: {},
    requires_user_confirmation: true,
  };
}

export function variantsToActions(
  variants: ShopifyVariant[] | undefined,
  ctx: VariantContext,
): ActionBinding[] {
  if (!variants) return [];
  return variants
    .map((v) => mapVariantToAction(v, ctx))
    .filter((a): a is ActionBinding => a !== null);
}
