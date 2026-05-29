import { describe, expect, test } from 'bun:test';
import { ShopifyAppJobWorker } from '../src/workers/shopify-app-job-worker';

describe('ShopifyAppJobWorker lifecycle jobs', () => {
  test('uninstall purges token first and queues catalog cleanup separately', async () => {
    const calls: string[] = [];
    const job = { id: 'job_1', shopDomain: 'coffee.myshopify.com', type: 'app_uninstalled', payload: { webhook_event_id: 'event_1' }, attempts: 1 };
    const worker = new ShopifyAppJobWorker(
      {
        claim: async () => [job],
        enqueue: async (input: { type: string }) => calls.push(`job.enqueue.${input.type}`),
        complete: async () => calls.push('job.complete'),
        fail: async () => calls.push('job.fail'),
      } as any,
      {
        markProcessed: async () => calls.push('event.processed'),
        markFailed: async () => calls.push('event.failed'),
      } as any,
      {} as any,
      {
        markUninstalled: async () => calls.push('store.markUninstalled'),
        recordRun: async () => calls.push('store.recordRun'),
      } as any,
    );

    const result = await worker.runOnce();

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(calls).toEqual([
      'store.markUninstalled',
      'store.recordRun',
      'job.enqueue.catalog_deactivate',
      'job.complete',
      'event.processed',
    ]);
  });

  test('shop redact queues catalog erase before deleting local state and preserves recovery carriers', async () => {
    const calls: string[] = [];
    const preserved: any[] = [];
    const job = { id: 'job_1', shopDomain: 'coffee.myshopify.com', type: 'shop_redact', payload: { webhook_event_id: 'event_1' }, attempts: 1 };
    const worker = new ShopifyAppJobWorker(
      {
        claim: async () => [job],
        enqueue: async (input: { type: string }) => calls.push(`job.enqueue.${input.type}`),
        complete: async () => calls.push('job.complete'),
        fail: async () => calls.push('job.fail'),
      } as any,
      { markProcessed: async () => undefined, markFailed: async () => undefined } as any,
      {} as any,
      {
        hardDelete: async (_shop: string, preserve: any) => {
          preserved.push(preserve);
          calls.push('store.hardDelete');
        },
      } as any,
    );

    const result = await worker.runOnce();

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(calls).toEqual(['job.enqueue.catalog_erase', 'store.hardDelete', 'job.complete']);
    expect(preserved[0].jobIds).toEqual(['job_1', 'catalog_erase_coffee_myshopify_com']);
    expect(preserved[0].webhookEventIds).toEqual(['event_1']);
  });

  test('shop redact leaves persisted catalog erase retryable when hard delete fails', async () => {
    const calls: string[] = [];
    const job = { id: 'job_1', shopDomain: 'coffee.myshopify.com', type: 'shop_redact', payload: { webhook_event_id: 'event_1' }, attempts: 1 };
    const worker = new ShopifyAppJobWorker(
      {
        claim: async () => [job],
        enqueue: async (input: { type: string }) => calls.push(`job.enqueue.${input.type}`),
        complete: async () => calls.push('job.complete'),
        fail: async () => calls.push('job.fail'),
      } as any,
      {
        markProcessed: async () => calls.push('event.processed'),
        markFailed: async () => calls.push('event.failed'),
      } as any,
      {} as any,
      {
        hardDelete: async () => {
          calls.push('store.hardDelete');
          throw new Error('delete failed');
        },
      } as any,
    );

    const result = await worker.runOnce();

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(calls).toEqual([
      'job.enqueue.catalog_erase',
      'store.hardDelete',
      'job.fail',
      'event.failed',
    ]);
  });
});
