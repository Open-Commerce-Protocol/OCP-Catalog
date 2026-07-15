/**
 * Reads per-provider activity rollups from the OCP activity service for the
 * merchant dashboard (views = catalog.queried, resolves = catalog.resolved).
 *
 * Optional dependency: if SHOPIFY_APP_ACTIVITY_BASE_URL is not configured, the
 * client is "disabled" and returns null so the dashboard degrades gracefully.
 */
import type { ShopifyAppConfig } from '../config';

export interface ProviderRollup {
  provider_id: string;
  window_hours: number;
  event_count: number;
  queried: number;
  resolved: number;
  object_synced: number;
  by_event_type: Record<string, number>;
}

export class ActivityClient {
  private readonly baseUrl: string | null;
  constructor(private readonly cfg: ShopifyAppConfig) {
    this.baseUrl = cfg.SHOPIFY_APP_ACTIVITY_BASE_URL
      ? cfg.SHOPIFY_APP_ACTIVITY_BASE_URL.replace(/\/$/, '')
      : null;
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  /** Returns null if activity service is unconfigured or unreachable. */
  async providerRollup(providerId: string, hours = 168): Promise<ProviderRollup | null> {
    if (!this.baseUrl) return null;
    try {
      const url = `${this.baseUrl}/api/activity/providers/${encodeURIComponent(providerId)}/rollups?hours=${hours}`;
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.cfg.SHOPIFY_APP_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as ProviderRollup;
    } catch {
      // Dashboard must not break if the activity service is down.
      return null;
    }
  }
}
