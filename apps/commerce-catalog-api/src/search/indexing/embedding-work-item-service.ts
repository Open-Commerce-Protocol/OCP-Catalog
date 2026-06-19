import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

export type EnqueueEmbeddingWorkItemInput = {
  catalogId: string;
  providerId?: string | null;
  searchDocumentId: string;
  reason: string;
  sourceSearchIndexJobId?: string | null;
};

export type PendingEmbeddingWorkItem = {
  workItemId: string;
  documentId: string;
};

export class EmbeddingWorkItemService {
  constructor(
    private readonly db: Db,
    private readonly profile: {
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimension: number;
    },
  ) {}

  async enqueuePending(input: EnqueueEmbeddingWorkItemInput) {
    return this.enqueuePendingMany([input]);
  }

  async enqueuePendingMany(inputs: EnqueueEmbeddingWorkItemInput[]) {
    if (inputs.length === 0) return [];
    const rows = await this.db
      .insert(schema.catalogEmbeddingWorkItems)
      .values(inputs.map((input) => ({
        id: newId('embwork'),
        catalogId: input.catalogId,
        providerId: input.providerId ?? null,
        catalogSearchDocumentId: input.searchDocumentId,
        embeddingProvider: this.profile.embeddingProvider,
        embeddingModel: this.profile.embeddingModel,
        embeddingDimension: this.profile.embeddingDimension,
        status: 'pending' as const,
        reason: input.reason,
        sourceSearchIndexJobId: input.sourceSearchIndexJobId ?? null,
        error: null,
        updatedAt: new Date(),
      })))
      .onConflictDoUpdate({
        target: [
          schema.catalogEmbeddingWorkItems.catalogId,
          schema.catalogEmbeddingWorkItems.catalogSearchDocumentId,
          schema.catalogEmbeddingWorkItems.embeddingModel,
        ],
        set: {
          status: 'pending',
          reason: sql`excluded.reason`,
          providerId: sql`excluded.provider_id`,
          sourceSearchIndexJobId: sql`excluded.source_search_index_job_id`,
          embeddingBatchJobId: null,
          submittedAt: null,
          completedAt: null,
          error: null,
          updatedAt: new Date(),
        },
        setWhere: sql`${schema.catalogEmbeddingWorkItems.status} <> 'submitted'`,
      })
      .returning();
    return rows;
  }

  async loadPendingDocumentIds(options: { catalogId: string; limit: number; providerId?: string }) {
    const rows = await this.db
      .select({
        workItemId: schema.catalogEmbeddingWorkItems.id,
        documentId: schema.catalogEmbeddingWorkItems.catalogSearchDocumentId,
      })
      .from(schema.catalogEmbeddingWorkItems)
      .where(and(
        eq(schema.catalogEmbeddingWorkItems.catalogId, options.catalogId),
        eq(schema.catalogEmbeddingWorkItems.embeddingModel, this.profile.embeddingModel),
        eq(schema.catalogEmbeddingWorkItems.status, 'pending'),
        options.providerId ? eq(schema.catalogEmbeddingWorkItems.providerId, options.providerId) : undefined,
      ))
      .orderBy(
        schema.catalogEmbeddingWorkItems.createdAt,
        schema.catalogEmbeddingWorkItems.id,
      )
      .limit(options.limit);
    return rows satisfies PendingEmbeddingWorkItem[];
  }

  async claimPendingDocumentIds(options: {
    catalogId: string;
    embeddingBatchJobId: string;
    limit: number;
    providerId?: string;
  }) {
    const providerFilter = options.providerId ? sql`and provider_id = ${options.providerId}` : sql``;
    const rows = await this.db.execute(sql`
      with claimed as (
        select id
        from catalog_embedding_work_items
        where catalog_id = ${options.catalogId}
          and embedding_model = ${this.profile.embeddingModel}
          and status = 'pending'
          ${providerFilter}
        order by created_at asc, id asc
        limit ${options.limit}
        for update skip locked
      )
      update catalog_embedding_work_items work_items
      set
        status = 'submitted',
        embedding_batch_job_id = ${options.embeddingBatchJobId},
        attempt_count = work_items.attempt_count + 1,
        error = null,
        submitted_at = now(),
        updated_at = now()
      from claimed
      where work_items.id = claimed.id
      returning
        work_items.id as "workItemId",
        work_items.catalog_search_document_id as "documentId"
    `);
    return rows as unknown as PendingEmbeddingWorkItem[];
  }

  async markCompletedByDocumentIds(input: { catalogId: string; documentIds: string[]; embeddingBatchJobId?: string }) {
    if (input.documentIds.length === 0) return 0;
    const rows = await this.db
      .update(schema.catalogEmbeddingWorkItems)
      .set({
        status: 'completed',
        error: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.catalogEmbeddingWorkItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingWorkItems.embeddingModel, this.profile.embeddingModel),
        input.embeddingBatchJobId
          ? eq(schema.catalogEmbeddingWorkItems.embeddingBatchJobId, input.embeddingBatchJobId)
          : undefined,
        inArray(schema.catalogEmbeddingWorkItems.status, ['pending', 'submitted'] as const),
        inArray(schema.catalogEmbeddingWorkItems.catalogSearchDocumentId, input.documentIds),
      ))
      .returning({ id: schema.catalogEmbeddingWorkItems.id });
    return rows.length;
  }

  async markFailedByDocumentIds(input: {
    catalogId: string;
    documentIds: string[];
    embeddingBatchJobId?: string;
    error: string;
  }) {
    if (input.documentIds.length === 0) return 0;
    const rows = await this.db
      .update(schema.catalogEmbeddingWorkItems)
      .set({
        status: 'failed',
        error: input.error.slice(0, 4000),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.catalogEmbeddingWorkItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingWorkItems.embeddingModel, this.profile.embeddingModel),
        input.embeddingBatchJobId
          ? eq(schema.catalogEmbeddingWorkItems.embeddingBatchJobId, input.embeddingBatchJobId)
          : undefined,
        inArray(schema.catalogEmbeddingWorkItems.status, ['pending', 'submitted'] as const),
        inArray(schema.catalogEmbeddingWorkItems.catalogSearchDocumentId, input.documentIds),
      ))
      .returning({ id: schema.catalogEmbeddingWorkItems.id });
    return rows.length;
  }

  async markSubmittedBatchFailed(input: { catalogId: string; embeddingBatchJobId: string; error: string }) {
    const rows = await this.db
      .update(schema.catalogEmbeddingWorkItems)
      .set({
        status: 'failed',
        error: input.error.slice(0, 4000),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.catalogEmbeddingWorkItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingWorkItems.embeddingModel, this.profile.embeddingModel),
        eq(schema.catalogEmbeddingWorkItems.embeddingBatchJobId, input.embeddingBatchJobId),
        eq(schema.catalogEmbeddingWorkItems.status, 'submitted'),
      ))
      .returning({ id: schema.catalogEmbeddingWorkItems.id });
    return rows.length;
  }

  async seedMissingDocuments(input: { catalogId: string; limit: number; providerId?: string }) {
    const providerFilter = input.providerId ? sql`and docs.provider_id = ${input.providerId}` : sql``;
    const rows = await this.db.execute(sql`
      with missing_documents as (
        select
          docs.id as document_id,
          docs.provider_id
        from catalog_search_documents docs
        left join catalog_search_embeddings embeddings
          on embeddings.catalog_search_document_id = docs.id
         and embeddings.embedding_model = ${this.profile.embeddingModel}
         and embeddings.status = 'ready'
        left join catalog_embedding_work_items work_items
          on work_items.catalog_id = docs.catalog_id
         and work_items.catalog_search_document_id = docs.id
         and work_items.embedding_model = ${this.profile.embeddingModel}
         and work_items.status in ('pending', 'submitted')
        where docs.catalog_id = ${input.catalogId}
          and docs.document_status = 'active'
          ${providerFilter}
          and embeddings.id is null
          and work_items.id is null
        order by docs.updated_at desc, docs.id asc
        limit ${input.limit}
      )
      insert into catalog_embedding_work_items (
        id,
        catalog_id,
        provider_id,
        catalog_search_document_id,
        embedding_provider,
        embedding_model,
        embedding_dimension,
        status,
        reason,
        created_at,
        updated_at
      )
      select
        ${newId('embseed') || ''} || '_' || row_number() over (),
        ${input.catalogId},
        missing_documents.provider_id,
        missing_documents.document_id,
        ${this.profile.embeddingProvider},
        ${this.profile.embeddingModel},
        ${this.profile.embeddingDimension},
        'pending',
        'missing_ready_embedding',
        now(),
        now()
      from missing_documents
      on conflict (catalog_id, catalog_search_document_id, embedding_model)
      do update set
        status = 'pending',
        reason = 'missing_ready_embedding',
        provider_id = excluded.provider_id,
        embedding_batch_job_id = null,
        submitted_at = null,
        completed_at = null,
        error = null,
        updated_at = now()
      where catalog_embedding_work_items.status not in ('pending', 'submitted')
      returning id
    `);
    return rows.length;
  }
}
