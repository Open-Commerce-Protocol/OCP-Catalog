import { shopifyAppSchema as schema, type ShopifyAppDb as Db } from '@ocp-catalog/shopify-app-db';
import { and, eq, inArray, lte, or } from 'drizzle-orm';

export type ShopifyAppJobType =
  | 'install_sync'
  | 'product_sync_one'
  | 'product_tombstone'
  | 'app_uninstalled'
  | 'shop_redact'
  | 'catalog_deactivate'
  | 'catalog_erase';

export type ShopifyAppJob = typeof schema.shopifyAppSyncJobs.$inferSelect;

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export class ShopifyAppJobStore {
  constructor(private readonly db: Db) {}

  async enqueue(input: {
    id?: string;
    shopDomain: string;
    type: ShopifyAppJobType;
    payload?: Record<string, unknown>;
  }): Promise<ShopifyAppJob> {
    const [row] = await this.db
      .insert(schema.shopifyAppSyncJobs)
      .values({
        id: input.id ?? newId('sjob'),
        shopDomain: input.shopDomain,
        type: input.type,
        payload: input.payload ?? {},
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await this.db
      .select()
      .from(schema.shopifyAppSyncJobs)
      .where(eq(schema.shopifyAppSyncJobs.id, input.id ?? ''))
      .limit(1);
    if (!existing) throw new Error('Failed to enqueue Shopify app job');
    return existing;
  }

  async claim(limit: number): Promise<ShopifyAppJob[]> {
    const now = new Date();
    const staleRunningBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const pending = await this.db
      .select()
      .from(schema.shopifyAppSyncJobs)
      .where(or(
        and(eq(schema.shopifyAppSyncJobs.status, 'pending'), lte(schema.shopifyAppSyncJobs.runAfter, now)),
        and(eq(schema.shopifyAppSyncJobs.status, 'running'), lte(schema.shopifyAppSyncJobs.lockedAt, staleRunningBefore)),
      ))
      .limit(limit);
    const claimed: ShopifyAppJob[] = [];
    for (const job of pending) {
      const [row] = await this.db
        .update(schema.shopifyAppSyncJobs)
        .set({ status: 'running', lockedAt: now, attempts: job.attempts + 1, updatedAt: now })
        .where(and(eq(schema.shopifyAppSyncJobs.id, job.id), inArray(schema.shopifyAppSyncJobs.status, ['pending', 'running'])))
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async complete(id: string): Promise<void> {
    await this.db
      .update(schema.shopifyAppSyncJobs)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.shopifyAppSyncJobs.id, id));
  }

  async fail(job: ShopifyAppJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetry = job.attempts < 5;
    await this.db
      .update(schema.shopifyAppSyncJobs)
      .set({
        status: shouldRetry ? 'pending' : 'failed',
        lastError: message,
        runAfter: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts)),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopifyAppSyncJobs.id, job.id));
  }
}

export type ShopifyAppWebhookEvent = typeof schema.shopifyAppWebhookEvents.$inferSelect;

export class ShopifyAppWebhookEventStore {
  constructor(private readonly db: Db) {}

  async recordOnce(input: {
    webhookId: string;
    shopDomain: string;
    topic: string;
    payload: Record<string, unknown>;
  }): Promise<{ event: ShopifyAppWebhookEvent; duplicate: boolean }> {
    const id = `wh_${input.webhookId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const [inserted] = await this.db
      .insert(schema.shopifyAppWebhookEvents)
      .values({
        id,
        webhookId: input.webhookId,
        shopDomain: input.shopDomain,
        topic: input.topic,
        payload: input.payload,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { event: inserted, duplicate: false };
    const [existing] = await this.db
      .select()
      .from(schema.shopifyAppWebhookEvents)
      .where(eq(schema.shopifyAppWebhookEvents.webhookId, input.webhookId))
      .limit(1);
    if (!existing) throw new Error('Failed to persist webhook event');
    return { event: existing, duplicate: true };
  }

  async recordAndEnqueue(input: {
    webhookId: string;
    shopDomain: string;
    topic: string;
    payload: Record<string, unknown>;
    job: {
      id: string;
      type: ShopifyAppJobType;
      payload: Record<string, unknown>;
    };
  }): Promise<{ event: ShopifyAppWebhookEvent; duplicate: boolean; queued: boolean }> {
    return this.db.transaction(async (tx) => {
      const id = `wh_${input.webhookId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const now = new Date();
      const [inserted] = await tx
        .insert(schema.shopifyAppWebhookEvents)
        .values({
          id,
          webhookId: input.webhookId,
          shopDomain: input.shopDomain,
          topic: input.topic,
          payload: input.payload,
        })
        .onConflictDoNothing()
        .returning();
      const event = inserted ?? (await tx
        .select()
        .from(schema.shopifyAppWebhookEvents)
        .where(eq(schema.shopifyAppWebhookEvents.webhookId, input.webhookId))
        .limit(1))[0];
      if (!event) throw new Error('Failed to persist webhook event');

      let queued = false;
      if (!inserted && event.status === 'processed') {
        return { event, duplicate: true, queued };
      }

      const [existingJob] = await tx
        .select()
        .from(schema.shopifyAppSyncJobs)
        .where(eq(schema.shopifyAppSyncJobs.id, input.job.id))
        .limit(1);

      if (existingJob?.status === 'completed') {
        await tx
          .update(schema.shopifyAppWebhookEvents)
          .set({ status: 'processed', processedAt: existingJob.completedAt ?? now, error: null })
          .where(eq(schema.shopifyAppWebhookEvents.id, event.id));
        return { event, duplicate: !inserted, queued };
      }

      if (existingJob?.status === 'failed') {
        await tx
          .update(schema.shopifyAppSyncJobs)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            runAfter: now,
            lockedAt: null,
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(schema.shopifyAppSyncJobs.id, existingJob.id));
        await tx
          .update(schema.shopifyAppWebhookEvents)
          .set({ status: 'queued', error: null, processedAt: null })
          .where(eq(schema.shopifyAppWebhookEvents.id, event.id));
        return { event, duplicate: !inserted, queued: true };
      }

      if (!existingJob) {
        const [insertedJob] = await tx
          .insert(schema.shopifyAppSyncJobs)
          .values({
            id: input.job.id,
            shopDomain: input.shopDomain,
            type: input.job.type,
            payload: { ...input.job.payload, webhook_event_id: event.id },
          })
          .onConflictDoNothing()
          .returning();
        queued = Boolean(insertedJob);
        if (!queued) {
          const [racedJob] = await tx
            .select()
            .from(schema.shopifyAppSyncJobs)
            .where(eq(schema.shopifyAppSyncJobs.id, input.job.id))
            .limit(1);
          if (!racedJob) throw new Error('Failed to enqueue Shopify app job');
          if (racedJob.status === 'failed') {
            await tx
              .update(schema.shopifyAppSyncJobs)
              .set({
                status: 'pending',
                attempts: 0,
                lastError: null,
                runAfter: now,
                lockedAt: null,
                completedAt: null,
                updatedAt: now,
              })
              .where(eq(schema.shopifyAppSyncJobs.id, racedJob.id));
            queued = true;
          }
        }
      }
      return { event, duplicate: !inserted, queued };
    });
  }

  async markProcessed(webhookEventId: string): Promise<void> {
    await this.db
      .update(schema.shopifyAppWebhookEvents)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(schema.shopifyAppWebhookEvents.id, webhookEventId));
  }

  async markFailed(webhookEventId: string, error: unknown): Promise<void> {
    await this.db
      .update(schema.shopifyAppWebhookEvents)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(schema.shopifyAppWebhookEvents.id, webhookEventId));
  }
}
