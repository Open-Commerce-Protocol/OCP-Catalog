import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
import { schema, type Db } from '@ocp-catalog/db';
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
    let seedMissingDocumentsCallCount = 0;
    const loadPendingDocumentIdsCalls: number[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      db,
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async seedMissingDocuments() {
          seedMissingDocumentsCallCount += 1;
        },
        async loadPendingDocumentIds(input: { limit: number }) {
          loadPendingDocumentIdsCalls.push(input.limit);
          return [{ documentId: document.id }];
        },
        async markCompletedByDocumentIds() {},
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await service.submit({ dryRun: true, limit: 2 });

    expect(loadPendingDocumentIdsCalls).toEqual([2, 1]);
    expect(seedMissingDocumentsCallCount).toBe(0);
    expect(result).toEqual({
      status: 'dry_run',
      requestedCount: 1,
      inputTextChars: 11,
      sampleCustomIds: ['sdoc_duplicate'],
    });
  });

  test('seeds missing documents only after pending work items are drained', async () => {
    const document = searchDocument({ id: 'sdoc_seeded' });
    const db = selectOnlyDb([
      [],
      [document],
    ]);
    let loadCallCount = 0;
    let seedMissingDocumentsCallCount = 0;
    const service = new OpenAIEmbeddingBatchBackfillService(
      db,
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async seedMissingDocuments() {
          seedMissingDocumentsCallCount += 1;
        },
        async loadPendingDocumentIds() {
          loadCallCount += 1;
          return loadCallCount === 1 ? [] : [{ documentId: document.id }];
        },
        async markCompletedByDocumentIds() {},
      } as unknown as EmbeddingWorkItemService,
    );

    const result = await service.submit({ dryRun: true, limit: 1 });

    expect(seedMissingDocumentsCallCount).toBe(1);
    expect(result.status).toBe('dry_run');
    expect(result.requestedCount).toBe(1);
    expect(result.sampleCustomIds).toEqual(['sdoc_seeded']);
  });

  test('fails loud when batch requests contain duplicate custom ids', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      selectOnlyDb([]),
      testConfig(),
      {} as SearchEmbeddingService,
      {} as EmbeddingWorkItemService,
    );
    (service as unknown as { loadCandidates: () => Promise<unknown[]> }).loadCandidates = async () => [
      searchDocument({ id: 'sdoc_duplicate' }),
      searchDocument({ id: 'sdoc_duplicate' }),
    ];

    await expect(service.submit({ dryRun: true, limit: 2 }))
      .rejects.toThrow('OpenAI embedding batch request contains duplicate custom_id values: sdoc_duplicate');
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
        async seedMissingDocuments() {},
        async claimPendingDocumentIds(input: unknown) {
          claimed.push(input);
          return [{ workItemId: 'embwork_1', documentId: document.id }];
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

  test('marks claimed work items failed when OpenAI batch creation fails', async () => {
    const document = searchDocument({ id: 'sdoc_claimed' });
    const failedBatches: unknown[] = [];
    const service = new OpenAIEmbeddingBatchBackfillService(
      submitDb({ selectResults: [[], [document]], insertedJobs: [], updatedJobs: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {
        async seedMissingDocuments() {},
        async claimPendingDocumentIds(input: { embeddingBatchJobId: string }) {
          return [{ workItemId: 'embwork_1', documentId: document.id, embeddingBatchJobId: input.embeddingBatchJobId }];
        },
        async markCompletedByDocumentIds() {
          return 0;
        },
        async markFailedByDocumentIds() {
          return 0;
        },
        async markSubmittedBatchFailed(input: unknown) {
          failedBatches.push(input);
          return 1;
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
    expect(failedBatches).toHaveLength(1);
    expect(failedBatches[0]).toMatchObject({
      catalogId: 'cat_test',
      error: 'OpenAI create failed',
    });
    expect((failedBatches[0] as { embeddingBatchJobId: string }).embeddingBatchJobId).toStartWith('embbatch_');
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
        async markCompletedByDocumentIds() {
          return 1;
        },
        async markFailedByDocumentIds() {
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
      outputLine('sdoc_1', [0.1, 0.2, 0.3]),
      outputLine('sdoc_2', [0.4, 0.5, 0.6]),
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
        async markCompletedByDocumentIds(input: unknown) {
          completed.push(input);
          return 0;
        },
        async markFailedByDocumentIds(input: unknown) {
          failed.push(input);
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
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('sdoc_1', [], 400), 1);

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
    }).ingestOutput(batchJob({ requestedCount: 1 }), outputLine('sdoc_1', [0.1, 0.2, 0.3]), 1))
      .rejects.toThrow('completed 1 documents but updated 0 work items');
    expect(updates).toEqual([]);
  });

  test('rejects output lines without custom ids instead of skipping them', async () => {
    const service = new OpenAIEmbeddingBatchBackfillService(
      ingestDb({ updates: [], insertedEmbeddingRows: [] }),
      testConfig(),
      {} as SearchEmbeddingService,
      {} as EmbeddingWorkItemService,
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
      {} as EmbeddingWorkItemService,
    );

    await expect((service as never as {
      ingestOutput(job: unknown, content: string, limit?: number): Promise<unknown>;
    }).ingestOutput(batchJob({}), outputLine('sdoc_missing', [0.1, 0.2, 0.3]), 1))
      .rejects.toThrow('output references unknown search document sdoc_missing');
  });

  test('rejects duplicate custom ids inside an output chunk', () => {
    expect(() => __OpenAIEmbeddingBatchBackfillTestOnly.assertValidOutputCustomIds('embbatch_test', [
      { custom_id: 'sdoc_1' },
      { custom_id: 'sdoc_1' },
    ], 0)).toThrow('duplicate custom_id sdoc_1 at line 2');
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

function testConfig() {
  return {
    CATALOG_ID: 'cat_test',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.test',
    OPENAI_TIMEOUT_MS: 1000,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSION: 1536,
    OPENAI_EMBEDDING_MAX_INPUT_CHARS: 1000,
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
