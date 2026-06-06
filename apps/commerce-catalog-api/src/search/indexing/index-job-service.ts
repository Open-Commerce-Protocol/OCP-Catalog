import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { newId } from '@ocp-catalog/shared';
import { and, asc, eq, lte, sql } from 'drizzle-orm';

export type SearchIndexJobType =
  | 'upsert_document'
  | 'rebuild_document'
  | 'delete_document'
  | 'refresh_embedding'
  | 'rebuild_all_for_provider';

export type SearchIndexJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SearchIndexJobPayload = Record<string, unknown>;

export type SearchIndexJob = {
  id: string;
  catalogId: string;
  providerId: string | null;
  catalogEntryId: string | null;
  commercialObjectId: string | null;
  dedupeKey: string | null;
  jobType: SearchIndexJobType;
  status: SearchIndexJobStatus;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  payload: SearchIndexJobPayload;
  createdAt: Date;
  updatedAt: Date;
};

type EnqueueJobInput = {
  catalogId: string;
  jobType: SearchIndexJobType;
  providerId?: string | null;
  catalogEntryId?: string | null;
  commercialObjectId?: string | null;
  dedupeKey?: string | null;
  payload?: SearchIndexJobPayload;
  scheduledAt?: Date;
  maxAttempts?: number;
};

export class SearchIndexJobService {
  constructor(private readonly db: Db) {}

  async enqueue(input: EnqueueJobInput) {
    const [job] = await this.db
      .insert(schema.catalogSearchIndexJobs)
      .values(toInsertValue(input))
      .onConflictDoNothing({
        target: [
          schema.catalogSearchIndexJobs.catalogId,
          schema.catalogSearchIndexJobs.dedupeKey,
        ],
      })
      .returning();

    return job ? toSearchIndexJob(job) : null;
  }

  async enqueueMany(inputs: EnqueueJobInput[]) {
    if (inputs.length === 0) return [];
    const rows = await this.db
      .insert(schema.catalogSearchIndexJobs)
      .values(inputs.map(toInsertValue))
      .onConflictDoNothing({
        target: [
          schema.catalogSearchIndexJobs.catalogId,
          schema.catalogSearchIndexJobs.dedupeKey,
        ],
      })
      .returning();

    return rows.map(toSearchIndexJob);
  }

  async enqueueDocumentUpsert(input: Omit<EnqueueJobInput, 'jobType'>) {
    return this.enqueue({
      ...input,
      jobType: 'upsert_document',
    });
  }

  async enqueueEmbeddingRefresh(input: Omit<EnqueueJobInput, 'jobType'>) {
    return this.enqueue({
      ...input,
      jobType: 'refresh_embedding',
    });
  }

  async claimPending(input: {
    catalogId?: string;
    limit?: number;
    now?: Date;
  } = {}) {
    const startedAt = new Date();
    const catalogFilter = input.catalogId
      ? sql`and catalog_id = ${input.catalogId}`
      : sql``;

    const rows = await this.db.execute(sql`
      with claimed_jobs as (
        select id
        from catalog_search_index_jobs
        where status = 'pending'
          and scheduled_at <= ${input.now ?? startedAt}
          ${catalogFilter}
        order by scheduled_at asc, catalog_id asc, created_at asc, id asc
        for update skip locked
        limit ${input.limit ?? 25}
      )
      update catalog_search_index_jobs as jobs
      set
        status = 'running',
        started_at = ${startedAt},
        updated_at = ${startedAt}
      from claimed_jobs
      where jobs.id = claimed_jobs.id
      returning
        jobs.id,
        jobs.catalog_id as "catalogId",
        jobs.provider_id as "providerId",
        jobs.catalog_entry_id as "catalogEntryId",
        jobs.commercial_object_id as "commercialObjectId",
        jobs.job_type as "jobType",
        jobs.status,
        jobs.attempt_count as "attemptCount",
        jobs.max_attempts as "maxAttempts",
        jobs.scheduled_at as "scheduledAt",
        jobs.started_at as "startedAt",
        jobs.finished_at as "finishedAt",
        jobs.error,
        jobs.payload,
        jobs.created_at as "createdAt",
        jobs.updated_at as "updatedAt"
    `);

    return (rows as unknown as Array<typeof schema.catalogSearchIndexJobs.$inferSelect>).map(toSearchIndexJob);
  }

  async listPending(input: {
    catalogId?: string;
    limit?: number;
    now?: Date;
  } = {}) {
    const conditions = [
      eq(schema.catalogSearchIndexJobs.status, 'pending'),
      lte(schema.catalogSearchIndexJobs.scheduledAt, input.now ?? new Date()),
    ];
    if (input.catalogId) conditions.push(eq(schema.catalogSearchIndexJobs.catalogId, input.catalogId));

    const rows = await this.db
      .select()
      .from(schema.catalogSearchIndexJobs)
      .where(and(...conditions))
      .orderBy(
        sql`case ${schema.catalogSearchIndexJobs.jobType}
          when 'refresh_embedding' then 0
          when 'upsert_document' then 1
          when 'rebuild_document' then 1
          when 'rebuild_all_for_provider' then 2
          when 'delete_document' then 3
          else 4
        end`,
        asc(schema.catalogSearchIndexJobs.scheduledAt),
        asc(schema.catalogSearchIndexJobs.createdAt),
      )
      .limit(input.limit ?? 25);

    return rows.map(toSearchIndexJob);
  }

  async markCompleted(jobId: string) {
    await this.db
      .update(schema.catalogSearchIndexJobs)
      .set({
        status: 'completed',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogSearchIndexJobs.id, jobId));
  }

  async failJob(job: SearchIndexJob, error: string, retryDelayMs?: number) {
    const nextAttemptCount = job.attemptCount + 1;
    const shouldRetry = typeof retryDelayMs === 'number' && retryDelayMs > 0 && nextAttemptCount < job.maxAttempts;

    await this.db
      .update(schema.catalogSearchIndexJobs)
      .set({
        status: shouldRetry ? 'pending' : 'failed',
        attemptCount: nextAttemptCount,
        error,
        scheduledAt: shouldRetry ? new Date(Date.now() + retryDelayMs) : job.scheduledAt,
        finishedAt: shouldRetry ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogSearchIndexJobs.id, job.id));
  }
}

function toInsertValue(input: EnqueueJobInput) {
  return {
    id: newId('sjob'),
    catalogId: input.catalogId,
    providerId: input.providerId ?? null,
    catalogEntryId: input.catalogEntryId ?? null,
    commercialObjectId: input.commercialObjectId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    jobType: input.jobType,
    status: 'pending' as const,
    payload: input.payload ?? {},
    scheduledAt: input.scheduledAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
  };
}

function toSearchIndexJob(row: typeof schema.catalogSearchIndexJobs.$inferSelect): SearchIndexJob {
  return {
    ...row,
    providerId: row.providerId ?? null,
    catalogEntryId: row.catalogEntryId ?? null,
    commercialObjectId: row.commercialObjectId ?? null,
    dedupeKey: row.dedupeKey ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    error: row.error ?? null,
    payload: row.payload,
  };
}
