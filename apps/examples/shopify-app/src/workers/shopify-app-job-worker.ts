import type { InstallationStore } from '../store/installation-store';
import type { ShopifyAppJob, ShopifyAppJobStore, ShopifyAppWebhookEventStore } from '../store/job-store';
import type { SyncService } from '../services/sync-service';

const DEFAULT_INTERVAL_MS = 5_000;

export class ShopifyAppJobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly jobs: ShopifyAppJobStore,
    private readonly webhookEvents: ShopifyAppWebhookEventStore,
    private readonly sync: SyncService,
    private readonly store: InstallationStore,
  ) {}

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(limit = 10): Promise<{ processed: number; failed: number }> {
    if (this.running) return { processed: 0, failed: 0 };
    this.running = true;
    let processed = 0;
    let failed = 0;
    try {
      const jobs = await this.jobs.claim(limit);
      for (const job of jobs) {
        try {
          await this.handle(job);
          await this.jobs.complete(job.id);
          const eventId = stringPayload(job.payload, 'webhook_event_id');
          if (eventId) await this.webhookEvents.markProcessed(eventId);
          processed += 1;
        } catch (err) {
          await this.jobs.fail(job, err);
          const eventId = stringPayload(job.payload, 'webhook_event_id');
          if (eventId) await this.webhookEvents.markFailed(eventId, err);
          failed += 1;
        }
      }
      return { processed, failed };
    } finally {
      this.running = false;
    }
  }

  private async handle(job: ShopifyAppJob): Promise<void> {
    switch (job.type) {
      case 'install_sync':
        await this.sync.register(job.shopDomain);
        await this.sync.syncFull(job.shopDomain);
        return;
      case 'product_sync_one': {
        const productId = requireString(job.payload, 'product_id');
        await this.sync.syncOne(job.shopDomain, productId, 'webhook');
        return;
      }
      case 'product_tombstone': {
        const productId = requireString(job.payload, 'product_id');
        await this.sync.syncTombstone(job.shopDomain, productId);
        return;
      }
      case 'app_uninstalled':
        await this.store.markUninstalled(job.shopDomain);
        await this.store.recordRun(job.shopDomain, {
          type: 'uninstall',
          status: 'succeeded',
          at: new Date().toISOString(),
          objects_synced: 0,
        });
        await this.jobs.enqueue({
          id: `catalog_deactivate_${job.shopDomain.replace(/[^a-zA-Z0-9_]/g, '_')}`,
          shopDomain: job.shopDomain,
          type: 'catalog_deactivate',
        });
        return;
      case 'shop_redact':
        const catalogEraseJobId = `catalog_erase_${job.shopDomain.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        await this.jobs.enqueue({
          id: catalogEraseJobId,
          shopDomain: job.shopDomain,
          type: 'catalog_erase',
        });
        await this.store.hardDelete(job.shopDomain, {
          jobIds: [job.id, catalogEraseJobId],
          webhookEventIds: [stringPayload(job.payload, 'webhook_event_id')].filter((id): id is string => Boolean(id)),
        });
        return;
      case 'catalog_deactivate':
        await this.sync.tombstoneKnownObjects(job.shopDomain);
        await this.sync.deactivateShopProvider(job.shopDomain);
        return;
      case 'catalog_erase':
        await this.sync.eraseShopProvider(job.shopDomain);
        return;
      default:
        throw new Error(`Unknown Shopify app job type: ${job.type}`);
    }
  }
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = stringPayload(payload, key);
  if (!value) throw new Error(`Job payload missing ${key}`);
  return value;
}

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
