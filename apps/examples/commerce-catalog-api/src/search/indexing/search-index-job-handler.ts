import { SearchIndexJobService, type SearchIndexJob } from './index-job-service';
import type { SearchIndexJobHandler } from './index-worker';
import { SearchDocumentUpsertService } from './document-upsert-service';
import type { SearchEmbeddingService } from './search-embedding-service';

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
        const results = await this.documents.upsertForProvider({
          catalogId: job.catalogId,
          providerId: requireProviderId(job),
        });
        if (this.embeddings && this.jobs) {
          for (const result of results) {
            if (result.documentStatus !== 'active') continue;
            await this.jobs.enqueueEmbeddingRefresh({
              catalogId: job.catalogId,
              providerId: job.providerId,
              catalogEntryId: result.catalogEntryId,
              payload: {
                search_document_id: result.documentId,
                source_job_id: job.id,
              },
            });
          }
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

function assertNever(value: never): never {
  throw new Error(`Unsupported search index job type: ${String(value)}`);
}
