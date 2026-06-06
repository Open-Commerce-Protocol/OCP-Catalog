import { SearchIndexJobService, type SearchIndexJob } from './index-job-service';
import type { SearchIndexJobHandler } from './index-worker';
import { SearchDocumentUpsertService } from './document-upsert-service';
import type { SearchEmbeddingService } from './search-embedding-service';

const REBUILD_PROVIDER_DEFAULT_PAGE_SIZE = 500;
const REBUILD_PROVIDER_MAX_PAGE_SIZE = 1_000;

export class SearchIndexJobHandlerService implements SearchIndexJobHandler {
  constructor(
    private readonly documents: SearchDocumentUpsertService,
    private readonly jobs?: SearchIndexJobService,
    private readonly embeddings?: SearchEmbeddingService,
  ) {}

  async handle(job: SearchIndexJob): Promise<void> {
    switch (job.jobType) {
      case 'upsert_document':
      case 'rebuild_document': {
        const result = await this.documents.upsertForCatalogEntry(requireCatalogEntryId(job));
        if (result?.documentStatus === 'active') {
          await this.enqueueEmbeddingRefresh(job, result.documentId);
        }
        return;
      }
      case 'delete_document':
        await this.documents.deleteForCatalogEntry(requireCatalogEntryId(job));
        return;
      case 'rebuild_all_for_provider': {
        if (!this.jobs) throw new Error('rebuild_all_for_provider requires SearchIndexJobService');
        const page = await this.documents.listProviderCatalogEntryPage({
          catalogId: job.catalogId,
          providerId: requireProviderId(job),
          limit: resolveRebuildPageSize(job),
          cursor: resolveRebuildCursor(job),
        });
        for (const entry of page.entries) {
          await this.jobs.enqueue({
            catalogId: job.catalogId,
            providerId: job.providerId,
            catalogEntryId: entry.catalogEntryId,
            commercialObjectId: entry.commercialObjectId,
            dedupeKey: `rebuild:${job.id}:document:${entry.catalogEntryId}`,
            jobType: 'rebuild_document',
            payload: {
              source_job_id: job.id,
            },
          });
        }
        if (page.nextCursor) {
          await this.jobs.enqueue({
            catalogId: job.catalogId,
            providerId: job.providerId,
            dedupeKey: `rebuild:${job.id}:next:${page.nextCursor.catalogEntryId}`,
            jobType: 'rebuild_all_for_provider',
            payload: {
              source_job_id: job.id,
              page_size: resolveRebuildPageSize(job),
              cursor_updated_at: page.nextCursor.updatedAt.toISOString(),
              cursor_entry_id: page.nextCursor.catalogEntryId,
            },
          });
        }
        return;
      }
      case 'refresh_embedding':
        if (!this.embeddings) throw new Error('refresh_embedding job received but search embeddings are not enabled');
        const result = await this.embeddings.refreshForSearchDocument(resolveSearchDocumentId(job));
        if (result?.status === 'failed') {
          throw new Error(`Embedding refresh failed for ${result.documentId}: ${result.error ?? 'unknown error'}`);
        }
        return;
      default:
        assertNever(job.jobType);
    }
  }

  private async enqueueEmbeddingRefresh(job: SearchIndexJob, documentId: string) {
    if (!this.embeddings || !this.jobs) return;

    await this.jobs.enqueueEmbeddingRefresh({
      catalogId: job.catalogId,
      providerId: job.providerId,
      catalogEntryId: job.catalogEntryId,
      commercialObjectId: job.commercialObjectId,
      dedupeKey: `embedding:${job.id}:${documentId}`,
      payload: {
        search_document_id: documentId,
        source_job_id: job.id,
      },
    });
  }
}

function requireCatalogEntryId(job: SearchIndexJob) {
  if (!job.catalogEntryId) throw new Error(`${job.jobType} job ${job.id} requires catalogEntryId`);
  return job.catalogEntryId;
}

function requireProviderId(job: SearchIndexJob) {
  if (!job.providerId) throw new Error(`${job.jobType} job ${job.id} requires providerId`);
  return job.providerId;
}

function resolveSearchDocumentId(job: SearchIndexJob) {
  const value = job.payload.search_document_id;
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`refresh_embedding job ${job.id} requires payload.search_document_id`);
}

function resolveRebuildPageSize(job: SearchIndexJob) {
  const value = job.payload.page_size;
  if (value === undefined) return REBUILD_PROVIDER_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > REBUILD_PROVIDER_MAX_PAGE_SIZE) {
    throw new Error(`rebuild_all_for_provider job ${job.id} has invalid payload.page_size`);
  }
  return value;
}

function resolveRebuildCursor(job: SearchIndexJob) {
  const updatedAt = job.payload.cursor_updated_at;
  const entryId = job.payload.cursor_entry_id;
  if (updatedAt === undefined && entryId === undefined) return null;
  if (typeof updatedAt !== 'string' || typeof entryId !== 'string' || !entryId.trim()) {
    throw new Error(`rebuild_all_for_provider job ${job.id} has invalid cursor payload`);
  }
  const parsedUpdatedAt = new Date(updatedAt);
  if (Number.isNaN(parsedUpdatedAt.getTime())) {
    throw new Error(`rebuild_all_for_provider job ${job.id} has invalid cursor_updated_at`);
  }
  return {
    updatedAt: parsedUpdatedAt,
    catalogEntryId: entryId,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported search index job type: ${String(value)}`);
}
