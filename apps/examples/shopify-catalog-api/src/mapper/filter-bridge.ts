/**
 * Bridge OCP CatalogQueryRequest.filters → Shopify search_catalog filters.
 *
 * OCP exposes a generic strict filter set (category/brand/currency/min_amount/
 * max_amount/in_stock_only/...). Shopify's Global Catalog only accepts
 * `available` and `ships_to`; Storefront accepts even less.
 *
 * Filters that Shopify can honor are translated and listed under
 * `accepted_filters`. Filters Shopify can't honor are listed under
 * `rejected_filters` with a human-readable warning. We never silently drop
 * filters — the OCP query response's `policy_summary` carries this back to
 * the caller so they know what was actually used.
 */
import type { CatalogQueryRequest } from '@ocp-catalog/ocp-schema';

export interface FilterBridgeResult {
  /** What to pass to Shopify search_catalog's `filters` object. */
  shopifyFilters: Record<string, unknown>;
  acceptedFilters: string[];
  rejectedFilters: string[];
  warnings: string[];
}

export interface FilterBridgeOptions {
  mode: 'global' | 'storefront';
  /** Optional shipping country for Global Catalog's ships_to filter. */
  shipsToCountry?: string;
}

export function bridgeFilters(
  req: CatalogQueryRequest,
  opts: FilterBridgeOptions,
): FilterBridgeResult {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};

  const filters = req.filters ?? {};

  // in_stock_only → Shopify `available`
  if (filters.in_stock_only !== undefined) {
    out.available = Boolean(filters.in_stock_only);
    accepted.push('in_stock_only');
  }

  // ships_to (global only). OCP doesn't have a ships_to filter, but if the
  // operator pre-set shipsToCountry, we layer it in here.
  if (opts.mode === 'global' && opts.shipsToCountry) {
    out.ships_to = { country: opts.shipsToCountry };
  }

  // Filters Shopify can't honor — record reasons.
  const unsupportedSimple: Array<keyof typeof filters> = [
    'category',
    'brand',
    'currency',
    'availability_status',
    'provider_id',
    'sku',
    'min_amount',
    'max_amount',
    'has_image',
  ];

  for (const key of unsupportedSimple) {
    if (filters[key] !== undefined) {
      rejected.push(key);
      warnings.push(`Shopify catalog does not accept filter '${String(key)}'; ignored.`);
    }
  }

  if (opts.mode === 'storefront' && out.ships_to) {
    delete out.ships_to;
    warnings.push("Shopify Storefront catalog does not support 'ships_to'; ignored.");
  }

  return {
    shopifyFilters: out,
    acceptedFilters: accepted,
    rejectedFilters: rejected,
    warnings,
  };
}
