/**
 * Merchant dashboard aggregator (Shopify-only, P1 + P2).
 *
 * Combines three sources into one DashboardData object the embedded /app page
 * renders:
 *   P1 (always available):
 *     - install state   ← InstallationStore (shopify-app Postgres)
 *     - catalog quality  ← CatalogClient.getProviderRecord (object counts, tiers)
 *   P2 (when activity service configured):
 *     - views / resolves ← ActivityClient.providerRollup
 *
 * Every field degrades gracefully: a brand-new install with no catalog record
 * yet, or no activity service, still returns a well-formed object with nulls.
 */
import { providerIdForShop } from '../mapper/product-to-commercial-object';
import type { ActivityClient } from './activity-client';
import type { CatalogClient } from './catalog-client';
import type { InstallationStore } from '../store/installation-store';

export interface DashboardData {
  shop_domain: string;
  provider_id: string;
  connected: boolean;
  status: string | null;
  catalog_id: string | null;
  active_registration_version: number | null;
  last_synced_at: string | null;
  last_run: Record<string, unknown> | null;
  // P1 — catalog quality
  listing: {
    object_count: number | null;
    active_entry_count: number | null;
    rich_entry_count: number | null;
    standard_entry_count: number | null;
    basic_entry_count: number | null;
    out_of_stock_count: number | null;
    missing_image_count: number | null;
    missing_product_url_count: number | null;
  };
  // P2 — agent activity (null when activity service not wired)
  activity: {
    available: boolean;
    window_hours: number | null;
    views: number | null;       // catalog.queried — appeared in agent search
    resolves: number | null;    // catalog.resolved — agent opened the entry
  };
  generated_at: string;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export class DashboardService {
  constructor(
    private readonly store: InstallationStore,
    private readonly catalog: CatalogClient,
    private readonly activity: ActivityClient,
  ) {}

  async build(shopDomain: string, opts: { hours?: number } = {}): Promise<DashboardData | null> {
    const providerId = providerIdForShop(shopDomain);
    const install = await this.store.get(shopDomain);
    if (!install) return null;

    const data: DashboardData = {
      shop_domain: shopDomain,
      provider_id: providerId,
      connected: install.status === 'active',
      status: install.status ?? null,
      catalog_id: install.catalogId ?? null,
      active_registration_version: install.activeRegistrationVersion ?? null,
      last_synced_at: install.lastSyncedAt ? install.lastSyncedAt.toISOString() : null,
      last_run: (install.lastRun as Record<string, unknown>) ?? null,
      listing: {
        object_count: null,
        active_entry_count: null,
        rich_entry_count: null,
        standard_entry_count: null,
        basic_entry_count: null,
        out_of_stock_count: null,
        missing_image_count: null,
        missing_product_url_count: null,
      },
      activity: { available: this.activity.enabled, window_hours: null, views: null, resolves: null },
      generated_at: new Date().toISOString(),
    };

    // P1: catalog quality (best-effort; provider may not be registered yet)
    try {
      const record = await this.catalog.getProviderRecord(providerId);
      const q = (record?.catalog_quality as Record<string, unknown> | undefined) ?? undefined;
      if (q) {
        data.listing = {
          object_count: numOrNull(q.object_count),
          active_entry_count: numOrNull(q.active_entry_count),
          rich_entry_count: numOrNull(q.rich_entry_count),
          standard_entry_count: numOrNull(q.standard_entry_count),
          basic_entry_count: numOrNull(q.basic_entry_count),
          out_of_stock_count: numOrNull(q.out_of_stock_count),
          missing_image_count: numOrNull(q.missing_image_count),
          missing_product_url_count: numOrNull(q.missing_product_url_count),
        };
      }
    } catch {
      // leave listing nulls — dashboard still renders install + activity
    }

    // P2: agent activity rollup
    const hours = opts.hours ?? 168;
    const rollup = await this.activity.providerRollup(providerId, hours);
    if (rollup) {
      data.activity = {
        available: true,
        window_hours: rollup.window_hours,
        views: numOrNull(rollup.queried),
        resolves: numOrNull(rollup.resolved),
      };
    }

    return data;
  }
}
