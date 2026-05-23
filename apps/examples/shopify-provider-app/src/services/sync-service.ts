import type { ShopifyProviderConfig } from '../config';
import {
  buildTombstoneCommercialObject,
  mapShopifyProductToCommercialObject,
  type CommercialObject,
  type MapperContext,
} from '../mapper/product-to-commercial-object';
import type { ShopifyAdminClient } from '../shopify/admin-client';
import type { CatalogClient } from './catalog-client';
import type { StateStore } from './state-store';

const SYNC_BATCH_SIZE = 25;

export interface SyncRunSummary {
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
    private readonly cfg: ShopifyProviderConfig,
    private readonly admin: ShopifyAdminClient,
    private readonly catalog: CatalogClient,
    private readonly state: StateStore,
  ) {}

  async syncFull(): Promise<SyncRunSummary> {
    return this.runSync('sync_full', async (ctx) => {
      const objects: CommercialObject[] = [];
      let cursor: string | null | undefined = null;
      let latestUpdate: string | null = null;
      do {
        const page = await this.admin.listProducts({ cursor });
        for (const p of page.nodes) {
          objects.push(mapShopifyProductToCommercialObject(p, ctx));
          if (!latestUpdate || p.updatedAt > latestUpdate) latestUpdate = p.updatedAt;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return { objects, cursorAdvancedTo: latestUpdate };
    });
  }

  async syncDelta(): Promise<SyncRunSummary> {
    const snapshot = await this.state.snapshot();
    const since = snapshot.last_synced_at;
    return this.runSync('sync_delta', async (ctx) => {
      const objects: CommercialObject[] = [];
      let cursor: string | null | undefined = null;
      let latestUpdate: string | null = since;
      do {
        const page = await this.admin.listProducts({ cursor, updatedAfter: since });
        for (const p of page.nodes) {
          objects.push(mapShopifyProductToCommercialObject(p, ctx));
          if (!latestUpdate || p.updatedAt > latestUpdate) latestUpdate = p.updatedAt;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return { objects, cursorAdvancedTo: latestUpdate };
    });
  }

  async syncOne(productId: string, runType: 'sync_one' | 'webhook' = 'sync_one'): Promise<SyncRunSummary> {
    return this.runSync(runType, async (ctx) => {
      const product = await this.admin.getProduct(productId);
      if (!product) {
        return { objects: [], cursorAdvancedTo: null };
      }
      return { objects: [mapShopifyProductToCommercialObject(product, ctx)], cursorAdvancedTo: product.updatedAt };
    });
  }

  async syncTombstone(productId: string): Promise<SyncRunSummary> {
    return this.runSync('webhook', async (ctx) => {
      const tombstone = buildTombstoneCommercialObject(productId, ctx);
      return { objects: [tombstone], cursorAdvancedTo: null };
    });
  }

  private async runSync(
    type: SyncRunSummary['type'],
    collect: (ctx: MapperContext) => Promise<{ objects: CommercialObject[]; cursorAdvancedTo: string | null }>,
  ): Promise<SyncRunSummary> {
    const startedAt = new Date();
    const snapshot = await this.state.snapshot();
    const registrationVersion = snapshot.active_registration_version;
    if (!registrationVersion) {
      throw new Error('Provider is not yet registered with the catalog; call /admin/register first.');
    }

    const shop = await this.admin.shopProfile();
    const ctx: MapperContext = {
      providerId: this.cfg.SHOPIFY_PROVIDER_ID,
      defaultCurrency: shop.currencyCode ?? this.cfg.SHOPIFY_PROVIDER_DEFAULT_CURRENCY,
      storeDomain: this.cfg.SHOPIFY_PROVIDER_STORE_DOMAIN ?? shop.primaryDomain,
    };

    let objects: CommercialObject[] = [];
    let cursorAdvancedTo: string | null = null;
    try {
      const collected = await collect(ctx);
      objects = collected.objects;
      cursorAdvancedTo = collected.cursorAdvancedTo;
    } catch (err) {
      await this.state.update({
        last_run: {
          type,
          status: 'failed',
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
          objects_synced: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    const chunks = chunk(objects, SYNC_BATCH_SIZE);
    let accepted = 0;
    let rejected = 0;
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      const request = {
        ocp_version: '1.0' as const,
        kind: 'ObjectSyncRequest' as const,
        catalog_id: this.cfg.SHOPIFY_PROVIDER_CATALOG_ID,
        provider_id: this.cfg.SHOPIFY_PROVIDER_ID,
        registration_version: registrationVersion,
        batch_id: `shopify_${type}_${Date.now()}_${i + 1}`,
        objects: batch,
      };
      try {
        const result = await this.catalog.syncObjects(request);
        accepted += numberValue(result.accepted_count);
        rejected += numberValue(result.rejected_count);
        if (Array.isArray(result.items)) {
          for (const item of result.items as Array<{ status: string; errors?: string[]; object_id?: string }>) {
            if (item.status !== 'accepted' && item.errors) {
              for (const e of item.errors) errors.push(`${item.object_id ?? '?'}: ${e}`);
            }
          }
        }
      } catch (err) {
        rejected += batch.length;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const status: SyncRunSummary['status'] =
      rejected === 0 && objects.length > 0
        ? 'succeeded'
        : accepted > 0
        ? 'partial'
        : objects.length === 0
        ? 'succeeded'
        : 'failed';

    const finished = new Date();
    await this.state.update({
      ...(cursorAdvancedTo ? { last_synced_at: cursorAdvancedTo } : {}),
      last_run: {
        type,
        status,
        started_at: startedAt.toISOString(),
        finished_at: finished.toISOString(),
        objects_synced: accepted,
        error: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
      },
    });

    return {
      type,
      status,
      registration_version: registrationVersion,
      batches: chunks.length,
      objects_synced: accepted,
      accepted_count: accepted,
      rejected_count: rejected,
      errors,
      cursor_advanced_to: cursorAdvancedTo,
    };
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
