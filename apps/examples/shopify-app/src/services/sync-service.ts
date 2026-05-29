/**
 * Multi-tenant sync service. Every method takes a shop domain, loads that
 * shop's installation (token + cursor + registration version) from the store,
 * pulls products via the Admin client, maps them to OCP CommercialObjects, and
 * pushes to the OCP catalog. One app process drives every installed merchant.
 */
import type { ShopifyAppConfig } from '../config';
import {
  buildTombstoneCommercialObject,
  mapShopifyProductToCommercialObject,
  providerIdForShop,
  type CommercialObject,
  type MapperContext,
} from '../mapper/product-to-commercial-object';
import type { ShopifyAdminClient, ShopSession } from '../shopify/admin-client';
import type { CatalogClient, CatalogClientError } from './catalog-client';
import type { InstallationStore, InstallationRow } from '../store/installation-store';

const SYNC_BATCH_SIZE = 25;

export interface SyncRunSummary {
  shop_domain: string;
  provider_id: string;
  type: 'sync_full' | 'sync_delta' | 'sync_one' | 'webhook';
  status: 'succeeded' | 'partial' | 'failed';
  registration_version: number;
  batches: number;
  objects_synced: number;
  accepted_count: number;
  rejected_count: number;
  errors: string[];
  cursor_advanced_to?: string | null;
}

export class SyncService {
  constructor(
    private readonly cfg: ShopifyAppConfig,
    private readonly admin: ShopifyAdminClient,
    private readonly catalog: CatalogClient,
    private readonly store: InstallationStore,
  ) {}

  /** Ensure the shop is registered as an OCP provider; returns version. */
  async register(shopDomain: string): Promise<number> {
    const install = await this.requireInstall(shopDomain);
    const session = await sessionOfInstall(install, this.store);
    const shop = await this.admin.shopProfile(session);
    const providerId = providerIdForShop(shopDomain);
    const version = await this.resolveNextVersion(providerId, install);
    const registration = buildProviderRegistration(this.cfg, shopDomain, shop, providerId, version);

    const result = await this.catalog.registerProvider(registration);
    if ((result as any).status === 'rejected') {
      throw new Error(`Catalog rejected registration: ${String((result as any).message ?? 'rejected')}`);
    }
    const accepted = ((result as any).effective_registration_version as number | undefined) ?? version;
    await this.store.setRegistrationVersion(shopDomain, accepted);
    await this.store.recordRun(shopDomain, { type: 'register', status: 'succeeded', at: new Date().toISOString(), objects_synced: 0 });
    return accepted;
  }

  async syncFull(shopDomain: string): Promise<SyncRunSummary> {
    return this.runSync(shopDomain, 'sync_full', async (session) => {
      const objects: CommercialObject[] = [];
      let cursor: string | null | undefined = null;
      let latest: string | null = null;
      do {
        const page = await this.admin.listProducts(session, { cursor });
        for (const p of page.nodes) {
          objects.push(this.mapWith(shopDomain, session, p));
          if (!latest || p.updatedAt > latest) latest = p.updatedAt;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return { objects, cursorAdvancedTo: latest };
    });
  }

  async syncDelta(shopDomain: string): Promise<SyncRunSummary> {
    const install = await this.requireInstall(shopDomain);
    const since = install.lastSyncedAt ? install.lastSyncedAt.toISOString() : null;
    return this.runSync(shopDomain, 'sync_delta', async (session) => {
      const objects: CommercialObject[] = [];
      let cursor: string | null | undefined = null;
      let latest: string | null = since;
      do {
        const page = await this.admin.listProducts(session, { cursor, updatedAfter: since });
        for (const p of page.nodes) {
          objects.push(this.mapWith(shopDomain, session, p));
          if (!latest || p.updatedAt > latest) latest = p.updatedAt;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return { objects, cursorAdvancedTo: latest };
    });
  }

  async syncOne(shopDomain: string, productId: string, runType: 'sync_one' | 'webhook' = 'sync_one'): Promise<SyncRunSummary> {
    return this.runSync(shopDomain, runType, async (session) => {
      const product = await this.admin.getProduct(session, productId);
      if (!product) return { objects: [], cursorAdvancedTo: null };
      return { objects: [this.mapWith(shopDomain, session, product)], cursorAdvancedTo: null };
    });
  }

  async syncTombstone(shopDomain: string, productId: string): Promise<SyncRunSummary> {
    return this.runSync(shopDomain, 'webhook', async () => {
      const ctx = this.ctxFor(shopDomain);
      return { objects: [buildTombstoneCommercialObject(productId, ctx)], cursorAdvancedTo: null };
    });
  }

  async tombstoneKnownObjects(shopDomain: string): Promise<SyncRunSummary | null> {
    const install = await this.store.get(shopDomain);
    if (!install?.activeRegistrationVersion) return null;
    const objectIds = install.syncedObjectIds ?? [];
    if (objectIds.length === 0) return null;
    const providerId = providerIdForShop(shopDomain);
    const ctx = this.ctxFor(shopDomain);
    return this.pushObjects(shopDomain, providerId, install.activeRegistrationVersion, 'webhook', objectIds.map((id) => (
      buildTombstoneCommercialObject(id, ctx)
    )));
  }

  async deactivateShopProvider(shopDomain: string): Promise<void> {
    await this.catalog.deactivateProvider(providerIdForShop(shopDomain));
  }

  async eraseShopProvider(shopDomain: string): Promise<void> {
    await this.catalog.eraseProvider(providerIdForShop(shopDomain));
  }

  private mapWith(shopDomain: string, _session: ShopSession, p: Parameters<typeof mapShopifyProductToCommercialObject>[0]): CommercialObject {
    return mapShopifyProductToCommercialObject(p, this.ctxFor(shopDomain));
  }

  private ctxFor(shopDomain: string): MapperContext {
    return {
      providerId: providerIdForShop(shopDomain),
      defaultCurrency: this.cfg.SHOPIFY_APP_DEFAULT_CURRENCY,
      storeDomain: shopDomain,
    };
  }

  private async runSync(
    shopDomain: string,
    type: SyncRunSummary['type'],
    collect: (session: ShopSession) => Promise<{ objects: CommercialObject[]; cursorAdvancedTo: string | null }>,
  ): Promise<SyncRunSummary> {
    const install = await this.requireInstall(shopDomain);
    const providerId = providerIdForShop(shopDomain);
    const registrationVersion = install.activeRegistrationVersion;
    if (!registrationVersion) throw new Error(`Shop ${shopDomain} is not registered; call register() first.`);

    const session = await sessionOfInstall(install, this.store);
    // Mapper currency uses the shop's currency when available.
    const shop = await this.admin.shopProfile(session).catch(() => null);
    const ctxCurrency = shop?.currencyCode ?? this.cfg.SHOPIFY_APP_DEFAULT_CURRENCY;

    let objects: CommercialObject[] = [];
    let cursorAdvancedTo: string | null = null;
    try {
      const collected = await collect(session);
      objects = collected.objects.map((o) => withCurrency(o, ctxCurrency));
      cursorAdvancedTo = collected.cursorAdvancedTo;
    } catch (err) {
      await this.store.recordRun(shopDomain, {
        type,
        status: 'failed',
        at: new Date().toISOString(),
        objects_synced: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const result = await this.pushObjects(shopDomain, providerId, registrationVersion, type, objects);
    if (result.status === 'succeeded' || result.status === 'partial') {
      await this.store.mergeSyncedObjectIds(shopDomain, objects.map((object) => object.object_id));
    }

    const advanceCursorTo =
      (type === 'sync_full' || type === 'sync_delta') && result.status === 'succeeded' ? cursorAdvancedTo : null;

    await this.store.recordRun(shopDomain, {
      type,
      status: result.status,
      at: new Date().toISOString(),
      objects_synced: result.accepted_count,
      error: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : null,
    }, { advanceCursorTo });

    return { ...result, cursor_advanced_to: advanceCursorTo };
  }

  private async pushObjects(
    shopDomain: string,
    providerId: string,
    registrationVersion: number,
    type: SyncRunSummary['type'],
    objects: CommercialObject[],
  ): Promise<SyncRunSummary> {
    const chunks = chunk(objects, SYNC_BATCH_SIZE);
    let accepted = 0;
    let rejected = 0;
    const errors: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      const request = {
        ocp_version: '1.0' as const,
        kind: 'ObjectSyncRequest' as const,
        catalog_id: this.cfg.SHOPIFY_APP_CATALOG_ID,
        provider_id: providerId,
        registration_version: registrationVersion,
        batch_id: `shopifyapp_${type}_${Date.now()}_${i + 1}`,
        objects: batch,
      };
      try {
        const result = await this.catalog.syncObjects(request);
        accepted += numberValue((result as any).accepted_count);
        rejected += numberValue((result as any).rejected_count);
        if (Array.isArray((result as any).items)) {
          for (const item of (result as any).items as Array<{ status: string; errors?: string[]; object_id?: string }>) {
            if (item.status !== 'accepted' && item.errors) for (const e of item.errors) errors.push(`${item.object_id ?? '?'}: ${e}`);
          }
        }
      } catch (err) {
        rejected += batch.length;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const status: SyncRunSummary['status'] =
      rejected === 0 && objects.length > 0 ? 'succeeded' : accepted > 0 ? 'partial' : objects.length === 0 ? 'succeeded' : 'failed';

    return {
      shop_domain: shopDomain,
      provider_id: providerId,
      type,
      status,
      registration_version: registrationVersion,
      batches: chunks.length,
      objects_synced: accepted,
      accepted_count: accepted,
      rejected_count: rejected,
      errors,
    };
  }

  private async requireInstall(shopDomain: string): Promise<InstallationRow> {
    const install = await this.store.get(shopDomain);
    const accessToken = install ? await this.store.getAccessToken(shopDomain) : null;
    if (!install || install.status !== 'active' || !accessToken) {
      throw new Error(`No active installation for ${shopDomain}`);
    }
    return install;
  }

  private async resolveNextVersion(providerId: string, install: InstallationRow): Promise<number> {
    try {
      const existing = await this.catalog.getProvider(providerId);
      if (existing?.active_registration_version) return existing.active_registration_version + 1;
    } catch (err) {
      if (!(err as CatalogClientError)?.status || (err as CatalogClientError).status !== 404) throw err;
    }
    return (install.activeRegistrationVersion ?? 0) + 1;
  }
}

async function sessionOfInstall(install: InstallationRow, store: InstallationStore): Promise<ShopSession> {
  const accessToken = await store.getAccessToken(install.shopDomain);
  if (!accessToken) throw new Error(`No access token for ${install.shopDomain}`);
  return { shopDomain: install.shopDomain, accessToken };
}

function withCurrency(obj: CommercialObject, currency: string): CommercialObject {
  const price = obj.descriptors.find((d) => d.pack_id === 'ocp.commerce.price.v1');
  if (price && typeof price.data.currency === 'string') price.data.currency = currency;
  return obj;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildProviderRegistration(
  cfg: ShopifyAppConfig,
  shopDomain: string,
  shop: { name: string; email?: string },
  providerId: string,
  registrationVersion: number,
) {
  return {
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: `reg_${providerId}_${registrationVersion}`,
    catalog_id: cfg.SHOPIFY_APP_CATALOG_ID,
    registration_version: registrationVersion,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: providerId,
      entity_type: 'merchant' as const,
      display_name: shop.name || shopDomain,
      homepage: `https://${shopDomain}`,
      ...(shop.email ? { contact_email: shop.email } : {}),
      domains: [shopDomain],
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
          provider_endpoints: { webhook: { url: `${cfg.SHOPIFY_APP_URL.replace(/\/$/, '')}/webhooks/products` } },
        },
      },
    ],
  };
}
