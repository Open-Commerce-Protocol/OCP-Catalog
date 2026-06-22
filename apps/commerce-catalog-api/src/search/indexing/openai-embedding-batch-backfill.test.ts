import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
import { catalogSchema as schema, type CatalogDb as Db } from '@ocp-catalog/catalog-db';
import type { SearchEmbeddingService } from './search-embedding-service';
import type { EmbeddingWorkItemService } from './embedding-work-item-service';
import {
  __OpenAIEmbeddingBatchBackfillTestOnly,
  OpenAIEmbeddingBatchBackfillService,
} from './openai-embedding-batch-backfill';

describe('OpenAIEmbeddingBatchBackfillService', () => {
  test('deduplicates pending document ids across candidate sweeps before building batch requests', async () => {
    const document = searchDocument({ id: 'sdoc_duplicate' });
    const db = selectOnlyDb([
      [],
      [document],
    ]);
    const loadPendingDocumentIdsCalls: number[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      db,
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async loadPendingDocumentIds(input: { limit: number }) {
          loadPendingDocumentIdsCalls.push(input.limit);
          return [{ documentId: document.id }];
        },
        async markCompletedByDocumentIds() {},
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await service.submit({ dryRun: true, limit: 2 });

    expect(loadPendingDocumentIdsCalls).toEqual([2, 1]);
    expect(result).toEqual({
      status: 'dry_run',
      requestedCount: 1,
      inputTextChars: 11,
      sampleCustomIds: ['sdoc_duplicate'],
    });
  });

  test('returns an empty dry run when no pending work items are available', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      selectOnlyDb([]),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async loadPendingDocumentIds() {
          return [];
        },
        async markCompletedByDocumentIds() {},
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await service.submit({ dryRun: true, limit: 1 });

    expect(result.status).toBe('dry_run');
    expect(result.requestedCount).toBe(0);
    expect(result.sampleCustomIds).toEqual([]);
  });

  test('fails loud when batch requests contain duplicate custom ids', async () => {
    expect(() => __OpenAIEmbeddingBatchBackfillTestOnly.assertUniqueBatchCustomIds([
      { custom_id: 'embitem_duplicate', method: 'POST', url: '/v1/embeddings', body: { model: 'm', input: 'a', dimensions: 1 } },
      { custom_id: 'embitem_duplicate', method: 'POST', url: '/v1/embeddings', body: { model: 'm', input: 'b', dimensions: 1 } },
    ])).toThrow('OpenAI embedding batch request contains duplicate custom_id values: embitem_duplicate');
  });

  test('claims pending work items for a local batch job before OpenAI submission', async () => {
    const document = searchDocument({ id: 'sdoc_claimed' });
    const insertedJobs: unknown[] = [];
    const updatedJobs: unknown[] = [];
    const claimed: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({
        selectResults: [[], [document]],
        insertedJobs,
        updatedJobs,
      }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async claimPendingDocumentIds(input: unknown) {
          claimed.push(input);
          return [{ workItemId: 'embwork_1', documentId: document.id }];
        },
        async createBatchItems() {
          return [{
            id: 'embitem_1',
            catalogSearchDocumentId: document.id,
            documentId: document.id,
            inputText: 'Batch title',
            inputTextHash: 'hash_batch',
            status: 'submitted',
          }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );
    (service as unknown as { client: unknown }).client = {
      async uploadBatchInput() {
        return { id: 'file_input' };
      },
      async createBatch() {
        return {
          id: 'batch_test',
          status: 'validating',
          output_file_id: null,
          error_file_id: null,
          request_counts: { completed: 0, failed: 0 },
        };
      },
    };

    const result = await service.submit({ limit: 1 });

    expect(result.status).toBe('submitted');
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      catalogId: 'cat_test',
      limit: 1,
    });
    expect((claimed[0] as { embeddingBatchJobId: string }).embeddingBatchJobId).toStartWith('embbatch_');
    expect(insertedJobs).toMatchObject([{
      status: 'created',
      requestedCount: 1,
    }]);
    expect(updatedJobs).toContainEqual(expect.objectContaining({
      status: 'validating',
      openaiBatchId: 'batch_test',
      inputFileId: 'file_input',
    }));
  });

  test('marks claimed work items failed when search documents are unavailable', async () => {
    const failedDocuments: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({
        selectResults: [
          [],
          [],
        ],
        insertedJobs: [],
        updatedJobs: [],
      }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async claimPendingDocumentIds() {
          return [{ workItemId: 'embwork_missing', documentId: 'sdoc_missing' }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds(input: unknown) {
          failedDocuments.push(input);
          return 1;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await service.submit({ limit: 1 });

    expect(result).toEqual({
      status: 'empty',
      requestedCount: 0,
      inputTextChars: 0,
    });
    expect(failedDocuments).toEqual([expect.objectContaining({
      catalogId: 'cat_test',
      documentIds: ['sdoc_missing'],
      error: 'Search document is missing, inactive, or outside the requested provider scope',
    })]);
  });

  test('fails loud when unavailable claimed work items are not marked failed', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({
        selectResults: [
          [],
          [],
        ],
        insertedJobs: [],
        updatedJobs: [],
      }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async claimPendingDocumentIds() {
          return [{ workItemId: 'embwork_missing', documentId: 'sdoc_missing' }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await expect(service.submit({ limit: 1 })).rejects.toThrow(
      /Embedding batch embbatch_[a-f0-9]+ failed 1 unavailable documents but updated 0 work items/,
    );
  });

  test('stores immutable batch item inputs and uses batch item ids as OpenAI custom ids', async () => {
    const document = searchDocument({ id: 'sdoc_claimed', title: 'Snapshot title' });
    const uploaded: string[] = [];
    const createdBatchItems: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({ selectResults: [[], [document]], insertedJobs: [], updatedJobs: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async claimPendingDocumentIds(input: { embeddingBatchJobId: string }) {
          return [{ workItemId: 'embwork_1', documentId: document.id, embeddingBatchJobId: input.embeddingBatchJobId }];
        },
        async createBatchItems(input: unknown) {
          createdBatchItems.push(input);
          return [{
            id: 'embitem_1',
            catalogSearchDocumentId: document.id,
            inputText: 'Snapshot title',
            inputTextHash: 'stored_hash',
          }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );
    (service as unknown as { client: unknown }).client = {
      async uploadBatchInput(_filename: string, content: string) {
        uploaded.push(content);
        return { id: 'file_input' };
      },
      async createBatch() {
        return {
          id: 'batch_test',
          status: 'validating',
          output_file_id: null,
          error_file_id: null,
          request_counts: { completed: 0, failed: 0 },
        };
      },
    };

    await service.submit({ limit: 1 });

    expect(createdBatchItems).toEqual([expect.objectContaining({
      catalogId: 'cat_test',
      items: [expect.objectContaining({
        workItemId: 'embwork_1',
        documentId: document.id,
        inputText: 'Snapshot title',
      })],
    })]);
    const request = JSON.parse(uploaded[0]!.trim());
    expect(request.custom_id).toBe('embitem_1');
    expect(request.body.input).toBe('Snapshot title');
  });

  test('releases claimed work items for retry when OpenAI batch creation fails', async () => {
    const document = searchDocument({ id: 'sdoc_claimed' });
    const releasedBatches: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({ selectResults: [[], [document]], insertedJobs: [], updatedJobs: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async claimPendingDocumentIds(input: { embeddingBatchJobId: string }) {
          return [{ workItemId: 'embwork_1', documentId: document.id, embeddingBatchJobId: input.embeddingBatchJobId }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
        async createBatchItems() {
          return [{
            id: 'embitem_1',
            catalogSearchDocumentId: document.id,
            documentId: document.id,
            inputText: 'Batch title',
            inputTextHash: 'hash_batch',
            status: 'submitted',
          }];
        },
        async releaseSubmittedBatchForRetry(input: unknown) {
          releasedBatches.push(input);
          return { failedCount: 0, requeuedCount: 1 };
        },
        async markSubmittedBatchFailed() {
          throw new Error('permanent fail path must not be used for batch creation failure');
        },
      } as unknown as EmbeddingWorkItemService,
    );
    (service as unknown as { client: unknown }).client = {
      async uploadBatchInput() {
        return { id: 'file_input' };
      },
      async createBatch() {
        throw new Error('OpenAI create failed');
      },
    };

    await expect(service.submit({ limit: 1 })).rejects.toThrow('OpenAI create failed');
    expect(releasedBatches).toHaveLength(1);
    expect(releasedBatches[0]).toMatchObject({
      catalogId: 'cat_test',
      error: 'OpenAI create failed',
      retryDelayMs: 1000,
    });
    expect((releasedBatches[0] as { embeddingBatchJobId: string }).embeddingBatchJobId).toStartWith('embbatch_');
  });

  test('releases submitted work items for retry when OpenAI batch reaches terminal failed, expired, or cancelled status', async () => {
    const releasedBatches: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({ selectResults: [], insertedJobs: [], updatedJobs: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async releaseSubmittedBatchForRetry(input: unknown) {
          releasedBatches.push(input);
          return { failedCount: 0, requeuedCount: 1 };
        },
        async markSubmittedBatchFailed() {
          throw new Error('permanent fail path must not be used for terminal batch failure');
        },
      } as unknown as EmbeddingWorkItemService,
    );

    for (const status of ['failed', 'expired', 'cancelled'] as const) {
      await (service as never as {
        updateJobFromBatch(job: unknown, batch: unknown): Promise<unknown>;
      }).updateJobFromBatch(batchJob({
        status: 'in_progress',
        outputFileId: null,
        error: null,
      }), {
        id: `batch_${status}`,
        status,
        request_counts: { completed: 0, failed: 1 },
        errors: { message: `batch ${status}` },
      });
    }

    expect(releasedBatches).toEqual([
      expect.objectContaining({
        catalogId: 'cat_test',
        embeddingBatchJobId: 'embbatch_test',
        error: JSON.stringify({ message: 'batch failed' }),
        retryDelayMs: 1000,
      }),
      expect.objectContaining({
        catalogId: 'cat_test',
        embeddingBatchJobId: 'embbatch_test',
        error: JSON.stringify({ message: 'batch expired' }),
        retryDelayMs: 1000,
      }),
      expect.objectContaining({
        catalogId: 'cat_test',
        embeddingBatchJobId: 'embbatch_test',
        error: JSON.stringify({ message: 'batch cancelled' }),
        retryDelayMs: 1000,
      }),
    ]);
  });

  test('releases submitted work items for retry on ingest failure while preserving fail-loud throw', async () => {
    const updates: unknown[] = [];
    const releasedBatches: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestFailureDb({
        jobs: [batchJob({ status: 'completed', outputFileId: 'file_output' })],
        updates,
      }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async releaseSubmittedBatchForRetry(input: unknown) {
          releasedBatches.push(input);
          return { failedCount: 0, requeuedCount: 1 };
        },
        async markSubmittedBatchFailed() {
          throw new Error('permanent fail path must not be used for ingest failure');
        },
      } as unknown as EmbeddingWorkItemService,
    );
    (service as unknown as { client: unknown }).client = {
      async downloadFileContent() {
        throw new Error('OpenAI output download failed');
      },
    };

    await expect(service.ingest({ jobId: 'embbatch_test' })).rejects.toThrow('OpenAI output download failed');
    expect(updates).toContainEqual(expect.objectContaining({ status: 'ingesting' }));
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      error: 'OpenAI output download failed',
    }));
    expect(releasedBatches).toEqual([expect.objectContaining({
      catalogId: 'cat_test',
      embeddingBatchJobId: 'embbatch_test',
      error: 'OpenAI output download failed',
      retryDelayMs: 1000,
    })]);
  });

  test('fails loudly on unknown OpenAI batch status', () => {
    expect(() => __OpenAIEmbeddingBatchBackfillTestOnly.normalizeBatchStatus('paused')).toThrow(
      'Unknown OpenAI batch status: paused',
    );
  });

  test('resumes limited output ingest from the persisted output cursor', async () => {
    const updates: unknown[] = [];
    const insertedEmbeddingRows: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates, insertedEmbeddingRows }),
      {
        ...testConfig(),
        EMBEDDING_DIMENSION: 3,
      },
      {
        writableVectorIndex: {
          async bulkUpsert() {},
        },
      } as unknown as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map([
            ['embitem_2', batchItem({ id: 'embitem_2', documentId: 'sdoc_2', inputText: 'Second product', inputTextHash: 'hash_second' })],
          ]);
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
        async markCompletedByDocumentIds() {
          return 1;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
        async markBatchItemsCompleted() {
          return 1;
        },
        async markBatchItemsFailed() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await (service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<{
        ingestedCount: number;
        failedCount: number;
        skippedCount: number;
        processedOutputLineCount: number;
      }>;
    }).ingestOutput(batchJob({
      ingestedCount: 1,
      failedCount: 0,
      ingestedOutputLineCount: 1,
      requestedCount: 2,
    }), [
      outputLine('embitem_1', [0.1, 0.2, 0.3]),
      outputLine('embitem_2', [0.4, 0.5, 0.6]),
    ].join('\n'), 1);

    expect(result).toEqual({
      ingestedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      processedOutputLineCount: 1,
    });
    expect(insertedEmbeddingRows).toHaveLength(1);
    expect(insertedEmbeddingRows).toMatchObject([{ catalogSearchDocumentId: 'sdoc_2' }]);
    expect(updates).toContainEqual(expect.objectContaining({
      ingestedCount: 2,
      failedCount: 0,
      ingestedOutputLineCount: 2,
    }));
  });

  test('marks failed output work items failed instead of completed', async () => {
    const completed: unknown[] = [];
    const failed: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates: [], insertedEmbeddingRows: [] }),
      {
        ...testConfig(),
        EMBEDDING_DIMENSION: 3,
      },
      {
        writableVectorIndex: {
          async bulkUpsert() {},
        },
      } as unknown as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map([
            ['embitem_1', batchItem({ id: 'embitem_1', documentId: 'sdoc_1' })],
          ]);
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
        async markCompletedByDocumentIds(input: unknown) {
          completed.push(input);
          return 0;
        },
        async markFailedByDocumentIds(input: unknown) {
          failed.push(input);
          return 1;
        },
        async markBatchItemsCompleted() {
          return 0;
        },
        async markBatchItemsFailed() {
          return 1;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await (service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<{
        ingestedCount: number;
        failedCount: number;
        skippedCount: number;
        processedOutputLineCount: number;
      }>;
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('embitem_1', [], 400), 1);

    expect(result.failedCount).toBe(1);
    expect(completed).toEqual([expect.objectContaining({
      embeddingBatchJobId: 'embbatch_test',
      documentIds: [],
    })]);
    expect(failed).toEqual([expect.objectContaining({
      embeddingBatchJobId: 'embbatch_test',
      documentIds: ['sdoc_1'],
    })]);
  });

  test('ingest uses stored batch item input hash instead of current document text', async () => {
    const insertedEmbeddingRows: unknown[] = [];
    const vectorDocuments: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates: [], insertedEmbeddingRows }),
      {
        ...testConfig(),
        EMBEDDING_DIMENSION: 3,
      },
      {
        writableVectorIndex: {
          async bulkUpsert(rows: unknown[]) {
            vectorDocuments.push(...rows);
          },
        },
      } as unknown as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map([
            ['embitem_1', batchItem({
              id: 'embitem_1',
              documentId: 'sdoc_1',
              inputText: 'Submitted title',
              inputTextHash: 'submitted_hash',
            })],
          ]);
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
        async markCompletedByDocumentIds() {
          return 1;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
        async markBatchItemsCompleted() {
          return 1;
        },
        async markBatchItemsFailed() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await (service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('embitem_1', [0.1, 0.2, 0.3]), 1);

    expect(insertedEmbeddingRows).toMatchObject([{
      catalogSearchDocumentId: 'sdoc_1',
      embeddingText: 'Submitted title',
      embeddingTextHash: 'submitted_hash',
    }]);
    expect(vectorDocuments).toMatchObject([{
      documentId: 'sdoc_1',
      embeddingTextHash: 'submitted_hash',
    }]);
  });

  test('does not advance ingest cursor when work item terminal update count mismatches output', async () => {
    const updates: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates, insertedEmbeddingRows: [] }),
      {
        ...testConfig(),
        EMBEDDING_DIMENSION: 3,
      },
      {
        writableVectorIndex: {
          async bulkUpsert() {},
        },
      } as unknown as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map([
            ['embitem_1', batchItem({ id: 'embitem_1', documentId: 'sdoc_1' })],
          ]);
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
        async markBatchItemsCompleted() {
          return 1;
        },
        async markBatchItemsFailed() {
          return 0;
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await expect((service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('embitem_1', [0.1, 0.2, 0.3]), 1))
      .rejects.toThrow('completed 1 documents but updated 0 work items');
    expect(updates).toEqual([]);
  });

  test('rejects terminal batch item when work item status does not match', async () => {
    const updates: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates, insertedEmbeddingRows: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map([
            ['embitem_1', batchItem({ id: 'embitem_1', documentId: 'sdoc_1', status: 'completed' })],
          ]);
        },
        async loadWorkItemStatusesById() {
          return new Map([
            ['embwork_1', { id: 'embwork_1', status: 'submitted' }],
          ]);
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await expect((service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('embitem_1', [0.1, 0.2, 0.3]), 1))
      .rejects.toThrow('batch item embitem_1 is completed but work item embwork_1 is submitted');
    expect(updates).toEqual([]);
  });

  test('rejects output lines without custom ids instead of skipping them', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates: [], insertedEmbeddingRows: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map();
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await expect((service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({}), JSON.stringify({ response: { status_code: 200 } }), 1))
      .rejects.toThrow('output line 1 is missing custom_id');
  });

  test('rejects output lines for unknown search documents instead of skipping them', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates: [], insertedEmbeddingRows: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async loadBatchItemsById() {
          return new Map();
        },
        async loadWorkItemStatusesById() {
          return new Map();
        },
      } as unknown as EmbeddingWorkItemService,
    );

    await expect((service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({}), outputLine('embitem_missing', [0.1, 0.2, 0.3]), 1))
      .rejects.toThrow('output references unknown embedding batch item embitem_missing');
  });

  test('rejects duplicate custom ids inside an output chunk', () => {
    expect(() => __OpenAIEmbeddingBatchBackfillTestOnly.assertValidOutputCustomIds('embbatch_test', [
      { custom_id: 'embitem_1' },
      { custom_id: 'embitem_1' },
    ], 0)).toThrow('duplicate custom_id embitem_1 at line 2');
  });
});

function selectOnlyDb(selectResults: unknown[][]) {
  let selectCall = 0;
  return {
    select() {
      const rows = selectResults[selectCall];
      if (!rows) {
        throw new Error(`unexpected db.select call ${selectCall + 1}`);
      }
      selectCall += 1;
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => rows,
                then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => {
                  Promise.resolve(rows).then(resolve, reject);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function submitDb(state: {
  selectResults: unknown[][];
  insertedJobs: unknown[];
  updatedJobs: unknown[];
}) {
  let selectCall = 0;
  return {
    select() {
      const rows = state.selectResults[selectCall];
      if (!rows) {
        throw new Error(`unexpected db.select call ${selectCall + 1}`);
      }
      selectCall += 1;
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => rows,
                then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => {
                  Promise.resolve(rows).then(resolve, reject);
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          if (table !== schema.catalogEmbeddingBatchJobs) throw new Error('unexpected insert table');
          state.insertedJobs.push(values);
          return {
            returning() {
              return Promise.resolve([{
                inputFileId: null,
                ...values,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              }]);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          if (table !== schema.catalogEmbeddingBatchJobs) throw new Error('unexpected update table');
          state.updatedJobs.push(values);
          return {
            where() {
              return {
                returning() {
                  return Promise.resolve([{
                    id: 'embbatch_updated',
                    ...state.insertedJobs[0] as Record<string, unknown>,
                    ...values,
                  }]);
                },
                then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
                  Promise.resolve(undefined).then(resolve, reject);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function ingestDb(state: { updates: unknown[]; insertedEmbeddingRows: unknown[] }) {
  const docs = [
    searchDocument({ id: 'sdoc_1', title: 'First product' }),
    searchDocument({ id: 'sdoc_2', title: 'Second product' }),
  ];
  return {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              if (table === schema.catalogSearchDocuments) return Promise.resolve(docs);
              if (table === schema.catalogSearchEmbeddings) return Promise.resolve([]);
              throw new Error('unexpected select table');
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(rows: unknown[]) {
          if (table !== schema.catalogSearchEmbeddings) throw new Error('unexpected insert table');
          state.insertedEmbeddingRows.push(...rows);
          return {
            onConflictDoUpdate() {
              return Promise.resolve();
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          if (table !== schema.catalogEmbeddingBatchJobs) throw new Error('unexpected update table');
          state.updates.push(values);
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function ingestFailureDb(state: { jobs: unknown[]; updates: unknown[] }) {
  return {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              if (table !== schema.catalogEmbeddingBatchJobs) throw new Error('unexpected select table');
              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(state.jobs);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          if (table !== schema.catalogEmbeddingBatchJobs) throw new Error('unexpected update table');
          state.updates.push(values);
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function outputLine(customId: string, embedding: number[], statusCode = 200) {
  return JSON.stringify({
    custom_id: customId,
    response: {
      status_code: statusCode,
      body: {
        model: 'text-embedding-3-small',
        data: [{ embedding }],
      },
    },
  });
}

function batchJob(overrides: Record<string, unknown>) {
  return {
    id: 'embbatch_test',
    catalogId: 'cat_test',
    status: 'completed',
    openaiBatchId: 'batch_test',
    inputFileId: 'file_input',
    outputFileId: 'file_output',
    errorFileId: null,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 3,
    requestedCount: 2,
    completedCount: 2,
    failedCount: 0,
    ingestedCount: 0,
    ingestedOutputLineCount: 0,
    inputTextChars: 0,
    metadata: {},
    error: null,
    submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:00:00.000Z'),
    ingestedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function batchItem(input: {
  id: string;
  documentId: string;
  inputText?: string;
  inputTextHash?: string;
  status?: 'submitted' | 'completed' | 'failed';
}) {
  return {
    id: input.id,
    catalogId: 'cat_test',
    embeddingBatchJobId: 'embbatch_test',
    embeddingWorkItemId: 'embwork_1',
    workItemId: 'embwork_1',
    catalogSearchDocumentId: input.documentId,
    documentId: input.documentId,
    inputText: input.inputText ?? 'First product',
    inputTextHash: input.inputTextHash ?? 'hash_first',
    status: input.status ?? 'submitted',
  };
}

function testConfig() {
  return {
    CATALOG_ID: 'cat_test',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.test',
    OPENAI_TIMEOUT_MS: 1000,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSION: 1536,
    OPENAI_EMBEDDING_MAX_INPUT_CHARS: 1000,
    CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS: 1000,
  } as AppConfig;
}

function searchDocument(input: { id: string; title?: string }) {
  return {
    id: input.id,
    catalogId: 'cat_test',
    providerId: 'provider_test',
    objectType: 'product',
    documentStatus: 'active',
    title: input.title ?? 'Batch title',
    summary: null,
    brand: null,
    category: null,
    sku: null,
    amount: null,
    availabilityStatus: null,
    searchText: null,
  };
}
