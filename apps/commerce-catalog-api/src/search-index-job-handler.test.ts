import { describe, expect, test } from 'bun:test';
import type { SearchDocumentUpsertService } from './search/indexing/document-upsert-service';
import type { SearchEmbeddingService } from './search/indexing/search-embedding-service';
import { SearchIndexJobHandlerService } from './search/indexing/search-index-job-handler';
import {
  retryDelayWithBackoff,
  searchIndexJobPriority,
  type SearchIndexJob,
  type SearchIndexJobService,
} from './search/indexing/index-job-service';
import { SearchIndexWorker } from './search/indexing/index-worker';

describe('SearchIndexJobHandlerService', () => {
  test('enqueues embedding refresh after active document upsert', async () => {
    const enqueued: unknown[] = [];
    const handler = new SearchIndexJobHandlerService(
      {
        async upsertForCatalogEntry(catalogEntryId: string) {
          return {
            catalogEntryId,
            documentId: 'sdoc_test',
            documentStatus: 'active' as const,
          };
        },
      } as unknown as SearchDocumentUpsertService,
      {
        async enqueueEmbeddingRefresh(input: unknown) {
          enqueued.push(input);
          return {};
        },
      } as unknown as SearchIndexJobService,
      {} as SearchEmbeddingService,
    );

    await handler.handle(searchIndexJob({
      catalogEntryId: 'centry_test',
      commercialObjectId: 'cobj_test',
      jobType: 'upsert_document',
    }));

    expect(enqueued).toEqual([{
      catalogId: 'cat_test',
      providerId: 'provider_test',
      catalogEntryId: 'centry_test',
      commercialObjectId: 'cobj_test',
      dedupeKey: 'embedding:sjob_test:sdoc_test',
      payload: {
        search_document_id: 'sdoc_test',
        source_job_id: 'sjob_test',
      },
    }]);
  });

  test('uses search document snapshots without reloading catalog entries', async () => {
    const snapshots: unknown[] = [];
    const handler = new SearchIndexJobHandlerService(
      {
        async upsertForSnapshot(snapshot: unknown) {
          snapshots.push(snapshot);
          return {
            catalogEntryId: 'centry_test',
            documentId: 'sdoc_test',
            documentStatus: 'inactive' as const,
          };
        },
        async upsertForCatalogEntry() {
          throw new Error('catalog entry reload should not be used');
        },
      } as unknown as SearchDocumentUpsertService,
    );

    await handler.handle(searchIndexJob({
      catalogEntryId: 'centry_test',
      commercialObjectId: 'cobj_test',
      jobType: 'upsert_document',
      payload: {
        search_document_snapshot: searchDocumentSnapshot(),
      },
    }));

    expect(snapshots).toEqual([{
      entryId: 'centry_test',
      catalogId: 'cat_test',
      commercialObjectId: 'cobj_test',
      objectType: 'product',
      providerId: 'provider_test',
      objectId: 'sku_test',
      entryStatus: 'active',
      title: 'Test product',
      summary: null,
      brand: null,
      category: null,
      currency: 'USD',
      availabilityStatus: 'in_stock',
      searchText: 'test product',
      projection: {
        title: 'Test product',
      },
      explainProjection: {
        indexed_fields: ['title'],
      },
      objectStatus: 'active',
      objectUpdatedAt: '2026-01-01T00:00:00.000Z',
    }]);
  });

  test('refreshes embeddings for explicit refresh job', async () => {
    const refreshed: string[] = [];
    const handler = new SearchIndexJobHandlerService(
      {} as SearchDocumentUpsertService,
      undefined,
      {
        async refreshForSearchDocument(documentId: string) {
          refreshed.push(documentId);
          return null;
        },
      } as unknown as SearchEmbeddingService,
    );

    await handler.handle(searchIndexJob({
      jobType: 'refresh_embedding',
      payload: {
        search_document_id: 'sdoc_test',
      },
    }));

    expect(refreshed).toEqual(['sdoc_test']);
  });

  test('throws when embedding refresh returns failed status', async () => {
    const handler = new SearchIndexJobHandlerService(
      {} as SearchDocumentUpsertService,
      undefined,
      {
        async refreshForSearchDocument(documentId: string) {
          return {
            status: 'failed' as const,
            documentId,
            embeddingId: 'semb_test',
            embeddingTextHash: 'hash_test',
            error: 'provider rejected model',
          };
        },
      } as unknown as SearchEmbeddingService,
    );

    await expect(handler.handle(searchIndexJob({
      jobType: 'refresh_embedding',
      payload: {
        search_document_id: 'sdoc_test',
      },
    }))).rejects.toThrow('provider rejected model');
  });

  test('fans provider rebuild out into paged rebuild document jobs', async () => {
    const enqueued: unknown[] = [];
    const handler = new SearchIndexJobHandlerService(
      {
        async listProviderCatalogEntryPage() {
          return {
            entries: [
              {
                catalogEntryId: 'centry_1',
                commercialObjectId: 'cobj_1',
                updatedAt: new Date('2026-01-02T00:00:00.000Z'),
              },
              {
                catalogEntryId: 'centry_2',
                commercialObjectId: 'cobj_2',
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
            nextCursor: {
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              catalogEntryId: 'centry_2',
            },
          };
        },
      } as unknown as SearchDocumentUpsertService,
      {
        async enqueue(input: unknown) {
          enqueued.push(input);
          return {};
        },
      } as unknown as SearchIndexJobService,
    );

    await handler.handle(searchIndexJob({
      jobType: 'rebuild_all_for_provider',
      payload: {
        page_size: 2,
      },
    }));

    expect(enqueued).toEqual([
      {
        catalogId: 'cat_test',
        providerId: 'provider_test',
        catalogEntryId: 'centry_1',
        commercialObjectId: 'cobj_1',
        dedupeKey: 'rebuild:sjob_test:document:centry_1',
        jobType: 'rebuild_document',
        payload: {
          source_job_id: 'sjob_test',
        },
      },
      {
        catalogId: 'cat_test',
        providerId: 'provider_test',
        catalogEntryId: 'centry_2',
        commercialObjectId: 'cobj_2',
        dedupeKey: 'rebuild:sjob_test:document:centry_2',
        jobType: 'rebuild_document',
        payload: {
          source_job_id: 'sjob_test',
        },
      },
      {
        catalogId: 'cat_test',
        providerId: 'provider_test',
        dedupeKey: 'rebuild:sjob_test:next:centry_2',
        jobType: 'rebuild_all_for_provider',
        payload: {
          source_job_id: 'sjob_test',
          page_size: 2,
          cursor_updated_at: '2026-01-01T00:00:00.000Z',
          cursor_entry_id: 'centry_2',
        },
      },
    ]);
  });

  test('worker processes queued jobs sequentially', async () => {
    const events: string[] = [];
    const jobs = [
      searchIndexJob({ id: 'sjob_1', jobType: 'refresh_embedding', payload: { search_document_id: 'sdoc_1' } }),
      searchIndexJob({ id: 'sjob_2', jobType: 'refresh_embedding', payload: { search_document_id: 'sdoc_2' } }),
    ];
    const worker = new SearchIndexWorker(
      {
        async claimPending() {
          return jobs;
        },
        async markCompleted(jobId: string) {
          events.push(`completed:${jobId}`);
        },
        async failJob() {
          throw new Error('unexpected failure');
        },
      } as unknown as SearchIndexJobService,
      {
        async handle(job: SearchIndexJob) {
          events.push(`handle:start:${job.id}`);
          await Promise.resolve();
          events.push(`handle:end:${job.id}`);
        },
      },
    );

    const result = await worker.runBatch();

    expect(result).toEqual({
      claimedCount: 2,
      completedCount: 2,
      failedCount: 0,
    });
    expect(events).toEqual([
      'handle:start:sjob_1',
      'handle:end:sjob_1',
      'completed:sjob_1',
      'handle:start:sjob_2',
      'handle:end:sjob_2',
      'completed:sjob_2',
    ]);
  });

  test('worker can process queued jobs concurrently', async () => {
    const events: string[] = [];
    let releaseFirstJob: (() => void) = () => {};
    const firstJobBlocker = new Promise<void>((resolve) => {
      releaseFirstJob = resolve;
    });
    const jobs = [
      searchIndexJob({ id: 'sjob_1', jobType: 'upsert_document', catalogEntryId: 'centry_1' }),
      searchIndexJob({ id: 'sjob_2', jobType: 'upsert_document', catalogEntryId: 'centry_2' }),
    ];
    const worker = new SearchIndexWorker(
      {
        async claimPending() {
          return jobs;
        },
        async markCompleted(jobId: string) {
          events.push(`completed:${jobId}`);
        },
        async failJob() {
          throw new Error('unexpected failure');
        },
      } as unknown as SearchIndexJobService,
      {
        async handle(job: SearchIndexJob) {
          events.push(`handle:start:${job.id}`);
          if (job.id === 'sjob_1') {
            await firstJobBlocker;
          }
          events.push(`handle:end:${job.id}`);
        },
      },
    );

    const resultPromise = worker.runBatch({ concurrency: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'handle:start:sjob_1',
      'handle:start:sjob_2',
      'handle:end:sjob_2',
      'completed:sjob_2',
    ]);
    releaseFirstJob();
    const result = await resultPromise;

    expect(result).toEqual({
      claimedCount: 2,
      completedCount: 2,
      failedCount: 0,
    });
    expect(events).toEqual([
      'handle:start:sjob_1',
      'handle:start:sjob_2',
      'handle:end:sjob_2',
      'completed:sjob_2',
      'handle:end:sjob_1',
      'completed:sjob_1',
    ]);
  });

  test('worker applies retry backoff options after handler failure', async () => {
    const failed: unknown[] = [];
    const worker = new SearchIndexWorker(
      {
        async claimPending() {
          return [searchIndexJob({ id: 'sjob_fail', jobType: 'refresh_embedding', payload: { search_document_id: 'sdoc_1' } })];
        },
        async markCompleted() {
          throw new Error('unexpected completion');
        },
        async failJob(job: SearchIndexJob, error: string, retry: unknown) {
          failed.push({ jobId: job.id, error, retry });
        },
      } as unknown as SearchIndexJobService,
      {
        async handle() {
          throw new Error('temporary provider failure');
        },
      },
    );

    const result = await worker.runBatch({
      retryDelayMs: 30_000,
      retryMaxDelayMs: 900_000,
      retryJitterRatio: 0,
    });

    expect(result).toEqual({
      claimedCount: 1,
      completedCount: 0,
      failedCount: 1,
    });
    expect(failed).toEqual([{
      jobId: 'sjob_fail',
      error: 'temporary provider failure',
      retry: {
        baseDelayMs: 30_000,
        maxDelayMs: 900_000,
        jitterRatio: 0,
      },
    }]);
  });

  test('worker can defer embedding refresh jobs for batch backfill', async () => {
    const claimOptions: unknown[] = [];
    const worker = new SearchIndexWorker(
      {
        async claimPending(options: unknown) {
          claimOptions.push(options);
          return [];
        },
        async markCompleted() {
          throw new Error('unexpected completion');
        },
        async failJob() {
          throw new Error('unexpected failure');
        },
      } as unknown as SearchIndexJobService,
      {
        async handle() {
          throw new Error('unexpected handle');
        },
      },
    );

    await worker.runBatch({
      catalogId: 'cat_test',
      includeEmbeddingRefresh: false,
    });

    expect(claimOptions).toEqual([{
      catalogId: 'cat_test',
      limit: undefined,
      includeEmbeddingRefresh: false,
    }]);
  });
});

describe('retryDelayWithBackoff', () => {
  test('doubles delay per attempt and caps at max', () => {
    expect(retryDelayWithBackoff(30_000, 900_000, 1, 0)).toBe(30_000);
    expect(retryDelayWithBackoff(30_000, 900_000, 2, 0)).toBe(60_000);
    expect(retryDelayWithBackoff(30_000, 900_000, 10, 0)).toBe(900_000);
  });
});

describe('searchIndexJobPriority', () => {
  test('keeps query-visible document work ahead of embedding refresh backlog', () => {
    expect([
      'refresh_embedding',
      'rebuild_all_for_provider',
      'rebuild_document',
      'upsert_document',
      'delete_document',
    ].sort((left, right) => (
      searchIndexJobPriority(left as Parameters<typeof searchIndexJobPriority>[0])
      - searchIndexJobPriority(right as Parameters<typeof searchIndexJobPriority>[0])
    ))).toEqual([
      'delete_document',
      'rebuild_document',
      'upsert_document',
      'rebuild_all_for_provider',
      'refresh_embedding',
    ]);
  });
});

function searchIndexJob(input: Partial<SearchIndexJob>): SearchIndexJob {
  return {
    id: 'sjob_test',
    catalogId: 'cat_test',
    providerId: 'provider_test',
    catalogEntryId: null,
    commercialObjectId: null,
    dedupeKey: null,
    jobType: 'upsert_document',
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    scheduledAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...input,
  };
}

function searchDocumentSnapshot() {
  return {
    entry_id: 'centry_test',
    catalog_id: 'cat_test',
    commercial_object_id: 'cobj_test',
    object_type: 'product',
    provider_id: 'provider_test',
    object_id: 'sku_test',
    entry_status: 'active',
    title: 'Test product',
    summary: null,
    brand: null,
    category: null,
    currency: 'USD',
    availability_status: 'in_stock',
    search_text: 'test product',
    projection: {
      title: 'Test product',
    },
    explain_projection: {
      indexed_fields: ['title'],
    },
    object_status: 'active',
    object_updated_at: '2026-01-01T00:00:00.000Z',
  };
}
