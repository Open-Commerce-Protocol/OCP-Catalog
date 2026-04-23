import { describe, expect, test } from 'bun:test';
import type { SearchDocumentUpsertService } from './search/indexing/document-upsert-service';
import type { SearchEmbeddingService } from './search/indexing/search-embedding-service';
import { SearchIndexJobHandlerService } from './search/indexing/search-index-job-handler';
import type { SearchIndexJob, SearchIndexJobService } from './search/indexing/index-job-service';

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
      payload: {
        search_document_id: 'sdoc_test',
        source_job_id: 'sjob_test',
      },
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
});

function searchIndexJob(input: Partial<SearchIndexJob>): SearchIndexJob {
  return {
    id: 'sjob_test',
    catalogId: 'cat_test',
    providerId: 'provider_test',
    catalogEntryId: null,
    commercialObjectId: null,
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
