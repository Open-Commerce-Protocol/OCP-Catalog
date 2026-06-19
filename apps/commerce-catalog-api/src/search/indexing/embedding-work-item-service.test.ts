import { describe, expect, test } from 'bun:test';
import { EmbeddingWorkItemService } from './embedding-work-item-service';

describe('EmbeddingWorkItemService', () => {
  test('enqueuePendingMany does not overwrite submitted work items on conflict', async () => {
    const conflictOptions: unknown[] = [];
    const service = new EmbeddingWorkItemService(
      {
        insert() {
          return {
            values() {
              return {
                onConflictDoUpdate(options: unknown) {
                  conflictOptions.push(options);
                  return {
                    returning() {
                      return Promise.resolve([]);
                    },
                  };
                },
              };
            },
          };
        },
      } as never,
      {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      },
    );

    await service.enqueuePendingMany([{
      catalogId: 'cat_test',
      providerId: 'provider_test',
      searchDocumentId: 'sdoc_test',
      reason: 'document_indexed',
      sourceSearchIndexJobId: 'sjob_test',
    }]);

    expect(conflictOptions).toHaveLength(1);
    expect(conflictOptions[0]).toHaveProperty('setWhere');
    expect(conflictOptions[0]).toMatchObject({
      set: {
        status: 'pending',
        embeddingBatchJobId: null,
        submittedAt: null,
        completedAt: null,
      },
    });
  });

  test('claimPendingDocumentIds sets submitted deadline and increments attempts', async () => {
    const executedSql: string[] = [];
    const service = new EmbeddingWorkItemService(
      {
        execute(query: unknown) {
          executedSql.push(sqlText(query));
          return Promise.resolve([]);
        },
      } as never,
      {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      },
    );

    await service.claimPendingDocumentIds({
      catalogId: 'cat_test',
      embeddingBatchJobId: 'embbatch_test',
      limit: 10,
      submittedTimeoutMs: 60_000,
    });

    expect(executedSql).toHaveLength(1);
  });

  test('requeueTimedOutSubmitted fails items that reached max attempts and requeues retryable items', async () => {
    const executedSql: string[] = [];
    const service = new EmbeddingWorkItemService(
      {
        execute(query: unknown) {
          executedSql.push(sqlText(query));
          return Promise.resolve([{ failedCount: 2, requeuedCount: 3 }]);
        },
      } as never,
      {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      },
    );

    const result = await service.requeueTimedOutSubmitted({
      catalogId: 'cat_test',
      limit: 50,
      now: new Date('2026-01-01T00:00:00.000Z'),
      error: 'submitted timeout',
    });

    expect(result).toEqual({ failedCount: 2, requeuedCount: 3 });
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('left join catalog_embedding_batch_jobs batch_jobs');
    expect(executedSql[0]).toContain('for update of work_items skip locked');
  });

  test('releaseSubmittedBatchForRetry requeues retryable work items and fails exhausted work items', async () => {
    const executedSql: string[] = [];
    const service = new EmbeddingWorkItemService(
      {
        execute(query: unknown) {
          executedSql.push(sqlText(query));
          return Promise.resolve([{ failedCount: 1, requeuedCount: 2 }]);
        },
      } as never,
      {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      },
    );

    const result = await service.releaseSubmittedBatchForRetry({
      catalogId: 'cat_test',
      embeddingBatchJobId: 'embbatch_test',
      error: 'OpenAI create failed',
      retryDelayMs: 5000,
    });

    expect(result).toEqual({ failedCount: 1, requeuedCount: 2 });
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('update catalog_embedding_work_items');
    expect(executedSql[0]).toContain('update catalog_embedding_batch_items');
    expect(executedSql[0]).toContain('submitted.attempt_count >= submitted.max_attempts');
    expect(executedSql[0]).toContain('submitted.attempt_count < submitted.max_attempts');
    expect(executedSql[0]).toContain('embedding_batch_job_id = null');
    expect(executedSql[0]).toContain('submitted_at = null');
    expect(executedSql[0]).toContain('submitted_deadline_at = null');
    expect(executedSql[0]).toContain("batch_items.status = 'submitted'");
  });

  test('releaseSubmittedBatchForRetry rejects invalid retry delay', async () => {
    const service = new EmbeddingWorkItemService(
      {
        execute() {
          throw new Error('query must not run for invalid retry delay');
        },
      } as never,
      {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
      },
    );

    await expect(service.releaseSubmittedBatchForRetry({
      catalogId: 'cat_test',
      embeddingBatchJobId: 'embbatch_test',
      error: 'OpenAI create failed',
      retryDelayMs: -1,
    })).rejects.toThrow('retryDelayMs must be a non-negative finite number');
  });
});

function sqlText(query: unknown) {
  if (query && typeof query === 'object' && 'queryChunks' in query) {
    return (query as { queryChunks: unknown[] }).queryChunks.map(sqlChunkText).join('');
  }
  return String(query);
}

function sqlChunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk && typeof chunk === 'object' && 'value' in chunk) {
    const value = (chunk as { value: unknown }).value;
    if (Array.isArray(value)) return value.map(String).join('');
    return String(value);
  }
  return String(chunk);
}
