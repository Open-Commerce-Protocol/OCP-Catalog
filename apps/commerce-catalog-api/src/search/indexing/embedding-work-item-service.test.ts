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
});
