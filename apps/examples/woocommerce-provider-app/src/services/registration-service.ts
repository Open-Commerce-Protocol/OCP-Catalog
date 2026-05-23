import type { WcProviderConfig } from '../config';
import type { WcRestClient } from '../woocommerce/rest-client';
import { CatalogClient, CatalogClientError } from './catalog-client';
import type { StateStore } from './state-store';

export class RegistrationService {
  constructor(
    private readonly cfg: WcProviderConfig,
    private readonly wc: WcRestClient,
    private readonly catalog: CatalogClient,
    private readonly state: StateStore,
  ) {}

  async register(opts: { registrationVersion?: number } = {}) {
    const site = await this.wc.siteProfile();
    const version = opts.registrationVersion ?? await this.resolveNextRegistrationVersion();
    const registration = buildWcProviderRegistration(this.cfg, site, version);
    const startedAt = new Date();
    try {
      const result = await this.catalog.registerProvider(registration);
      const acceptedVersion = (result.effective_registration_version as number | undefined) ?? version;
      await this.state.update({
        active_registration_version: acceptedVersion,
        last_run: {
          type: 'register',
          status: 'succeeded',
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
          objects_synced: 0,
        },
      });
      return { registration, result };
    } catch (err) {
      await this.state.update({
        last_run: {
          type: 'register',
          status: 'failed',
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
          objects_synced: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  private async resolveNextRegistrationVersion(): Promise<number> {
    try {
      const existing = await this.catalog.getProvider(this.cfg.WC_PROVIDER_ID);
      if (existing?.active_registration_version) return existing.active_registration_version + 1;
    } catch (err) {
      if (!(err instanceof CatalogClientError && err.status === 404)) throw err;
    }
    const snapshot = await this.state.snapshot();
    return (snapshot.active_registration_version ?? 0) + 1;
  }
}

export function buildWcProviderRegistration(
  cfg: WcProviderConfig,
  site: { name: string; url: string; default_currency: string },
  registrationVersion: number,
) {
  const host = (() => { try { return new URL(site.url).host; } catch { return site.url; } })();
  return {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `reg_${cfg.WC_PROVIDER_ID}_${registrationVersion}`,
    catalog_id: cfg.WC_PROVIDER_CATALOG_ID,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: cfg.WC_PROVIDER_ID,
      entity_type: 'merchant' as const,
      display_name: cfg.WC_PROVIDER_DISPLAY_NAME || site.name,
      homepage: site.url,
      ...(cfg.WC_PROVIDER_CONTACT_EMAIL ? { contact_email: cfg.WC_PROVIDER_CONTACT_EMAIL } : {}),
      domains: [host],
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.product.core.v1#/product_url',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
        ],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/brand',
          'ocp.commerce.product.core.v1#/category',
          'ocp.commerce.product.core.v1#/sku',
          'ocp.commerce.product.core.v1#/image_urls',
          'ocp.commerce.inventory.v1#/availability_status',
          'ocp.commerce.inventory.v1#/quantity',
        ],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {
            webhook: { url: `${cfg.WC_PROVIDER_PUBLIC_BASE_URL}/webhooks/woocommerce` },
          },
        },
      },
    ],
  };
}
