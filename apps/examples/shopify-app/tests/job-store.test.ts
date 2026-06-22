import { describe, expect, test } from 'bun:test';
import { shopifyAppSchema as schema } from '@ocp-catalog/shopify-app-db';
import { ShopifyAppWebhookEventStore } from '../src/store/job-store';

describe('ShopifyAppWebhookEventStore', () => {
  test('requeues a terminal failed job on duplicate webhook delivery', async () => {
    const state = createState({
      event: webhookEvent({ status: 'failed', error: 'previous failure' }),
      job: syncJob({ status: 'failed', attempts: 5, lastError: 'exhausted' }),
    });
    const store = new ShopifyAppWebhookEventStore(fakeDb(state) as any);

    const result = await store.recordAndEnqueue(recordInput());

    expect(result).toMatchObject({ duplicate: true, queued: true });
    expect(state.job).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
      lockedAt: null,
      completedAt: null,
    });
    expect(state.event).toMatchObject({ status: 'queued', error: null, processedAt: null });
  });

  test('marks an unprocessed duplicate event processed when its job already completed', async () => {
    const completedAt = new Date('2026-05-29T10:00:00.000Z');
    const state = createState({
      event: webhookEvent({ status: 'failed', error: 'mark processed failed' }),
      job: syncJob({ status: 'completed', completedAt }),
    });
    const store = new ShopifyAppWebhookEventStore(fakeDb(state) as any);

    const result = await store.recordAndEnqueue(recordInput());

    expect(result).toMatchObject({ duplicate: true, queued: false });
    expect(state.event).toMatchObject({ status: 'processed', error: null, processedAt: completedAt });
  });
});

function recordInput() {
  return {
    webhookId: 'wh_1',
    shopDomain: 'coffee.myshopify.com',
    topic: 'products/update',
    payload: { id: 9001 },
    job: {
      id: 'webhook_wh_1',
      type: 'product_sync_one' as const,
      payload: { product_id: 'gid://shopify/Product/9001' },
    },
  };
}

function webhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh_wh_1',
    webhookId: 'wh_1',
    shopDomain: 'coffee.myshopify.com',
    topic: 'products/update',
    status: 'queued',
    payload: { id: 9001 },
    error: null,
    receivedAt: new Date('2026-05-29T09:00:00.000Z'),
    processedAt: null,
    ...overrides,
  };
}

function syncJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook_wh_1',
    shopDomain: 'coffee.myshopify.com',
    type: 'product_sync_one',
    status: 'pending',
    payload: { webhook_event_id: 'wh_wh_1' },
    attempts: 0,
    lastError: null,
    runAfter: new Date('2026-05-29T09:00:00.000Z'),
    lockedAt: null,
    completedAt: null,
    createdAt: new Date('2026-05-29T09:00:00.000Z'),
    updatedAt: new Date('2026-05-29T09:00:00.000Z'),
    ...overrides,
  };
}

function createState(input: { event: Record<string, unknown> | null; job: Record<string, unknown> | null }) {
  return { event: input.event, job: input.job };
}

function fakeDb(state: ReturnType<typeof createState>) {
  return {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx(state)),
  };
}

function fakeTx(state: ReturnType<typeof createState>) {
  return {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            onConflictDoNothing() {
              return {
                returning: async () => {
                  if (table === schema.shopifyAppWebhookEvents) {
                    if (state.event) return [];
                    state.event = values;
                    return [state.event];
                  }
                  if (table === schema.shopifyAppSyncJobs) {
                    if (state.job) return [];
                    state.job = values;
                    return [state.job];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit: async () => {
                  if (table === schema.shopifyAppWebhookEvents) return state.event ? [state.event] : [];
                  if (table === schema.shopifyAppSyncJobs) return state.job ? [state.job] : [];
                  return [];
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async () => {
              if (table === schema.shopifyAppWebhookEvents && state.event) {
                Object.assign(state.event, values);
              }
              if (table === schema.shopifyAppSyncJobs && state.job) {
                Object.assign(state.job, values);
              }
              return [];
            },
          };
        },
      };
    },
  };
}
