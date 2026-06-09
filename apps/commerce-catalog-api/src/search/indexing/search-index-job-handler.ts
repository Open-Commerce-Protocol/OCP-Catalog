import { SearchIndexJobService, type SearchIndexJob } from './index-job-service';
import type { SearchIndexJobHandler } from './index-worker';
import { SearchDocumentUpsertService, type SearchDocumentSnapshot } from './document-upsert-service';
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
        const result = resolveSearchDocumentSnapshot(job)
          ? await this.documents.upsertForSnapshot(resolveSearchDocumentSnapshot(job)!)
          : await this.documents.upsertForCatalogEntry(requireCatalogEntryId(job));
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

  async handleBatch(jobs: SearchIndexJob[]) {
    if (!this.jobs) return new Set<string>();
    const documentJobs = jobs.filter((job) => (
      (job.jobType === 'upsert_document' || job.jobType === 'rebuild_document')
      && Boolean(job.catalogEntryId)
    ));
    if (documentJobs.length === 0) return new Set<string>();

    const snapshotJobs = documentJobs
      .map((job) => {
        const snapshot = resolveSearchDocumentSnapshot(job);
        return snapshot ? { job, snapshot } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const snapshotJobIds = new Set(snapshotJobs.map((item) => item.job.id));
    const lookupJobs = documentJobs.filter((job) => !snapshotJobIds.has(job.id));

    const snapshotResults = await this.documents.upsertForSnapshots(snapshotJobs.map((item) => item.snapshot));
    const lookupResults = await this.documents.upsertForCatalogEntries(
      lookupJobs.map((job) => requireCatalogEntryId(job)),
    );
    const results = [...snapshotResults, ...lookupResults];
    const resultByCatalogEntryId = new Map(results.map((result) => [result.catalogEntryId, result]));
    const embeddingJobs = documentJobs
      .map((job) => {
        const result = job.catalogEntryId ? resultByCatalogEntryId.get(job.catalogEntryId) : undefined;
        if (!result || result.documentStatus !== 'active') return null;
        return {
          catalogId: job.catalogId,
          providerId: job.providerId,
          catalogEntryId: job.catalogEntryId,
          commercialObjectId: job.commercialObjectId,
          dedupeKey: `embedding:${job.id}:${result.documentId}`,
          payload: {
            search_document_id: result.documentId,
            source_job_id: job.id,
          },
        };
      })
      .filter((job): job is NonNullable<typeof job> => job !== null);
    await this.jobs.enqueueMany(embeddingJobs.map((job) => ({
      ...job,
      jobType: 'refresh_embedding',
    })));

    return new Set(documentJobs.map((job) => job.id));
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

function resolveSearchDocumentSnapshot(job: SearchIndexJob): SearchDocumentSnapshot | null {
  const value = job.payload.search_document_snapshot;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const objectUpdatedAt = snapshot.object_updated_at ?? snapshot.objectUpdatedAt;
  return {
    entryId: requireSnapshotString(snapshot.entry_id ?? snapshot.entryId, 'entry_id'),
    catalogId: requireSnapshotString(snapshot.catalog_id ?? snapshot.catalogId, 'catalog_id'),
    commercialObjectId: requireSnapshotString(
      snapshot.commercial_object_id ?? snapshot.commercialObjectId,
      'commercial_object_id',
    ),
    objectType: requireSnapshotString(snapshot.object_type ?? snapshot.objectType, 'object_type'),
    providerId: requireSnapshotString(snapshot.provider_id ?? snapshot.providerId, 'provider_id'),
    objectId: requireSnapshotString(snapshot.object_id ?? snapshot.objectId, 'object_id'),
    entryStatus: requireSnapshotEntryStatus(snapshot.entry_status ?? snapshot.entryStatus),
    title: requireSnapshotString(snapshot.title, 'title'),
    summary: optionalSnapshotString(snapshot.summary),
    brand: optionalSnapshotString(snapshot.brand),
    category: optionalSnapshotString(snapshot.category),
    currency: optionalSnapshotString(snapshot.currency),
    availabilityStatus: optionalSnapshotString(snapshot.availability_status ?? snapshot.availabilityStatus),
    searchText: requireSnapshotString(snapshot.search_text ?? snapshot.searchText, 'search_text'),
    projection: requireSnapshotRecord(snapshot.projection, 'projection'),
    explainProjection: requireSnapshotRecord(
      snapshot.explain_projection ?? snapshot.explainProjection,
      'explain_projection',
    ),
    objectStatus: requireSnapshotString(snapshot.object_status ?? snapshot.objectStatus, 'object_status'),
    objectUpdatedAt: requireSnapshotString(objectUpdatedAt, 'object_updated_at'),
  };
}

function requireSnapshotString(value: unknown, field: string) {
  if (typeof value !== 'string') throw new Error(`search_document_snapshot.${field} must be a string`);
  return value;
}

function optionalSnapshotString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function requireSnapshotRecord(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`search_document_snapshot.${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireSnapshotEntryStatus(value: unknown): SearchDocumentSnapshot['entryStatus'] {
  if (
    value === 'active'
    || value === 'inactive'
    || value === 'rejected'
    || value === 'pending_verification'
  ) {
    return value;
  }
  throw new Error('search_document_snapshot.entry_status is invalid');
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
