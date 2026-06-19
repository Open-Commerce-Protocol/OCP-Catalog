import type { CatalogDb as Db } from '@ocp-catalog/catalog-db';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import { newId } from '@ocp-catalog/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

const DEFAULT_SUBMITTED_TIMEOUT_MS = 30 * 60 * 60 * 1000;

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

export type EmbeddingBatchItemInput = {
  workItemId: string;
  documentId: string;
  inputText: string;
  inputTextHash: string;
};

export type EmbeddingBatchItem = {
  id: string;
  workItemId: string;
  documentId: string;
  inputText: string;
  inputTextHash: string;
  status: 'submitted' | 'completed' | 'failed';
};

export type EmbeddingWorkItemTerminalStatus = {
  id: string;
  status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
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
          scheduledAt: new Date(),
          submittedAt: null,
          submittedDeadlineAt: null,
          completedAt: null,
          lastErrorAt: null,
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
        schema.catalogEmbeddingWorkItems.scheduledAt,
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
    submittedTimeoutMs?: number;
  }) {
    const providerFilter = options.providerId ? sql`and provider_id = ${options.providerId}` : sql``;
    const submittedDeadline = new Date(Date.now() + (options.submittedTimeoutMs ?? DEFAULT_SUBMITTED_TIMEOUT_MS)).toISOString();
    const rows = await this.db.execute(sql`
      with claimed as (
        select id
        from catalog_embedding_work_items
        where catalog_id = ${options.catalogId}
          and embedding_model = ${this.profile.embeddingModel}
          and status = 'pending'
          and scheduled_at <= now()
          ${providerFilter}
        order by scheduled_at asc, created_at asc, id asc
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
        submitted_deadline_at = ${submittedDeadline}::timestamptz,
        updated_at = now()
      from claimed
      where work_items.id = claimed.id
      returning
        work_items.id as "workItemId",
        work_items.catalog_search_document_id as "documentId"
    `);
    return rows as unknown as PendingEmbeddingWorkItem[];
  }

  async requeueTimedOutSubmitted(input: {
    catalogId: string;
    limit: number;
    now?: Date;
    error: string;
    retryDelayMs?: number;
  }) {
    const now = (input.now ?? new Date()).toISOString();
    const retryAt = new Date((input.now ?? new Date()).getTime() + (input.retryDelayMs ?? 0)).toISOString();
    const rows = await this.db.execute(sql`
      with timed_out as (
        select work_items.id, work_items.attempt_count, work_items.max_attempts
        from catalog_embedding_work_items work_items
        left join catalog_embedding_batch_jobs batch_jobs
          on batch_jobs.id = work_items.embedding_batch_job_id
          and batch_jobs.catalog_id = work_items.catalog_id
        where work_items.catalog_id = ${input.catalogId}
          and work_items.embedding_model = ${this.profile.embeddingModel}
          and work_items.status = 'submitted'
          and work_items.submitted_deadline_at <= ${now}::timestamptz
          and (
            work_items.embedding_batch_job_id is null
            or batch_jobs.id is null
            or batch_jobs.status in ('failed', 'expired', 'cancelled')
          )
        order by work_items.submitted_deadline_at asc, work_items.id asc
        limit ${input.limit}
        for update of work_items skip locked
      ),
      failed_batch_items as (
        update catalog_embedding_batch_items batch_items
        set
          status = 'failed',
          error = ${input.error.slice(0, 4000)},
          completed_at = ${now}::timestamptz,
          updated_at = now()
        from timed_out
        where batch_items.embedding_work_item_id = timed_out.id
          and batch_items.status = 'submitted'
        returning batch_items.id
      ),
      failed as (
        update catalog_embedding_work_items work_items
        set
          status = 'failed',
          error = ${input.error.slice(0, 4000)},
          last_error_at = ${now}::timestamptz,
          updated_at = now()
        from timed_out
        where work_items.id = timed_out.id
          and timed_out.attempt_count >= timed_out.max_attempts
        returning work_items.id
      ),
      requeued as (
        update catalog_embedding_work_items work_items
        set
          status = 'pending',
          embedding_batch_job_id = null,
          submitted_at = null,
          submitted_deadline_at = null,
          scheduled_at = ${retryAt}::timestamptz,
          error = ${input.error.slice(0, 4000)},
          last_error_at = ${now}::timestamptz,
          updated_at = now()
        from timed_out
        where work_items.id = timed_out.id
          and timed_out.attempt_count < timed_out.max_attempts
        returning work_items.id
      )
      select
        (select count(*)::int from failed) as "failedCount",
        (select count(*)::int from requeued) as "requeuedCount"
    `);
    const [row] = rows as unknown as Array<{ failedCount: number; requeuedCount: number }>;
    return {
      failedCount: row?.failedCount ?? 0,
      requeuedCount: row?.requeuedCount ?? 0,
    };
  }

  async createBatchItems(input: {
    catalogId: string;
    embeddingBatchJobId: string;
    items: EmbeddingBatchItemInput[];
  }) {
    if (input.items.length === 0) return [];
    const rows = await this.db
      .insert(schema.catalogEmbeddingBatchItems)
      .values(input.items.map((item) => ({
        id: newId('embitem'),
        catalogId: input.catalogId,
        embeddingBatchJobId: input.embeddingBatchJobId,
        embeddingWorkItemId: item.workItemId,
        catalogSearchDocumentId: item.documentId,
        inputText: item.inputText,
        inputTextHash: item.inputTextHash,
        inputTextChars: item.inputText.length,
        status: 'submitted' as const,
        updatedAt: new Date(),
      })))
      .returning({
        id: schema.catalogEmbeddingBatchItems.id,
        workItemId: schema.catalogEmbeddingBatchItems.embeddingWorkItemId,
        documentId: schema.catalogEmbeddingBatchItems.catalogSearchDocumentId,
        inputText: schema.catalogEmbeddingBatchItems.inputText,
        inputTextHash: schema.catalogEmbeddingBatchItems.inputTextHash,
        status: schema.catalogEmbeddingBatchItems.status,
      });
    return rows satisfies EmbeddingBatchItem[];
  }

  async loadBatchItemsById(input: { catalogId: string; embeddingBatchJobId: string; batchItemIds: string[] }) {
    if (input.batchItemIds.length === 0) return new Map<string, EmbeddingBatchItem>();
    const rows = await this.db
      .select({
        id: schema.catalogEmbeddingBatchItems.id,
        workItemId: schema.catalogEmbeddingBatchItems.embeddingWorkItemId,
        documentId: schema.catalogEmbeddingBatchItems.catalogSearchDocumentId,
        inputText: schema.catalogEmbeddingBatchItems.inputText,
        inputTextHash: schema.catalogEmbeddingBatchItems.inputTextHash,
        status: schema.catalogEmbeddingBatchItems.status,
      })
      .from(schema.catalogEmbeddingBatchItems)
      .where(and(
        eq(schema.catalogEmbeddingBatchItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingBatchItems.embeddingBatchJobId, input.embeddingBatchJobId),
        inArray(schema.catalogEmbeddingBatchItems.id, input.batchItemIds),
      ));
    return new Map(rows.map((row) => [row.id, row satisfies EmbeddingBatchItem]));
  }

  async loadWorkItemStatusesById(input: { catalogId: string; workItemIds: string[] }) {
    if (input.workItemIds.length === 0) return new Map<string, EmbeddingWorkItemTerminalStatus>();
    const rows = await this.db
      .select({
        id: schema.catalogEmbeddingWorkItems.id,
        status: schema.catalogEmbeddingWorkItems.status,
      })
      .from(schema.catalogEmbeddingWorkItems)
      .where(and(
        eq(schema.catalogEmbeddingWorkItems.catalogId, input.catalogId),
        inArray(schema.catalogEmbeddingWorkItems.id, input.workItemIds),
      ));
    return new Map(rows.map((row) => [row.id, row satisfies EmbeddingWorkItemTerminalStatus]));
  }

  async markBatchItemsCompleted(input: { catalogId: string; embeddingBatchJobId: string; batchItemIds: string[]; outputLineStart: number }) {
    if (input.batchItemIds.length === 0) return 0;
    const rows = await this.db
      .update(schema.catalogEmbeddingBatchItems)
      .set({
        status: 'completed',
        error: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.catalogEmbeddingBatchItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingBatchItems.embeddingBatchJobId, input.embeddingBatchJobId),
        eq(schema.catalogEmbeddingBatchItems.status, 'submitted'),
        inArray(schema.catalogEmbeddingBatchItems.id, input.batchItemIds),
      ))
      .returning({ id: schema.catalogEmbeddingBatchItems.id });
    return rows.length;
  }

  async markBatchItemsFailed(input: { catalogId: string; embeddingBatchJobId: string; batchItemIds: string[]; error: string }) {
    if (input.batchItemIds.length === 0) return 0;
    const rows = await this.db
      .update(schema.catalogEmbeddingBatchItems)
      .set({
        status: 'failed',
        error: input.error.slice(0, 4000),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.catalogEmbeddingBatchItems.catalogId, input.catalogId),
        eq(schema.catalogEmbeddingBatchItems.embeddingBatchJobId, input.embeddingBatchJobId),
        eq(schema.catalogEmbeddingBatchItems.status, 'submitted'),
        inArray(schema.catalogEmbeddingBatchItems.id, input.batchItemIds),
      ))
      .returning({ id: schema.catalogEmbeddingBatchItems.id });
    return rows.length;
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
        lastErrorAt: new Date(),
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
    const message = input.error.slice(0, 4000);
    const rows = await this.db.execute(sql`
      with failed_work_items as (
        update catalog_embedding_work_items work_items
        set
          status = 'failed',
          error = ${message},
          last_error_at = now(),
          updated_at = now()
        where work_items.catalog_id = ${input.catalogId}
          and work_items.embedding_model = ${this.profile.embeddingModel}
          and work_items.embedding_batch_job_id = ${input.embeddingBatchJobId}
          and work_items.status = 'submitted'
        returning work_items.id
      ),
      failed_batch_items as (
        update catalog_embedding_batch_items batch_items
        set
          status = 'failed',
          error = ${message},
          completed_at = now(),
          updated_at = now()
        where batch_items.catalog_id = ${input.catalogId}
          and batch_items.embedding_batch_job_id = ${input.embeddingBatchJobId}
          and batch_items.status = 'submitted'
        returning batch_items.id
      )
      select count(*)::int as "failedCount"
      from failed_work_items
    `);
    const [row] = rows as unknown as Array<{ failedCount: number }>;
    return row?.failedCount ?? 0;
  }

}
