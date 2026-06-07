import type { ActivityEventService } from '@ocp-catalog/ocp-activity-core';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import { sql, eq, type SQL } from 'drizzle-orm';
import type { SearchIndexJobService, SearchIndexJobType } from '../search/indexing/index-job-service';

type CatalogOutboxEvent = {
  id: string;
  catalogId: string;
  providerId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  dedupeKey: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
};

const SEARCH_INDEX_JOB_TYPES = new Set<SearchIndexJobType>([
  'upsert_document',
  'rebuild_document',
  'delete_document',
  'refresh_embedding',
  'rebuild_all_for_provider',
]);

export class CatalogOutboxService {
  constructor(
    private readonly db: Db,
    private readonly searchIndexJobs: SearchIndexJobService,
    private readonly activityEvents: ActivityEventService,
  ) {}

  async drain(input: {
    catalogId: string;
    limit?: number;
    retryDelayMs?: number;
    lockTimeoutMs?: number;
  }) {
    const events = await this.claimPending({
      catalogId: input.catalogId,
      limit: input.limit ?? 50,
      lockTimeoutMs: input.lockTimeoutMs ?? 300_000,
    });

    let completedCount = 0;
    let failedCount = 0;
    for (const event of events) {
      try {
        await this.deliver(event);
        await this.markCompleted(event.id);
        completedCount += 1;
      } catch (error) {
        await this.markFailed(event, error instanceof Error ? error.message : String(error), input.retryDelayMs ?? 30_000);
        failedCount += 1;
      }
    }

    return {
      claimed_count: events.length,
      completed_count: completedCount,
      failed_count: failedCount,
    };
  }

  async claimPending(input: {
    catalogId: string;
    limit: number;
    lockTimeoutMs: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const staleLockedBefore = new Date(now.getTime() - input.lockTimeoutMs);
    const nowIso = now.toISOString();
    const staleLockedBeforeIso = staleLockedBefore.toISOString();
    const rows = await this.claimRows(sql`
        status = 'pending'
        and scheduled_at <= ${nowIso}::timestamptz
      `, sql`scheduled_at asc, created_at asc, id asc`, input.limit, nowIso, input.catalogId);
    if (rows.length >= input.limit) return rows;

    const staleRows = await this.claimRows(sql`
        status = 'running'
        and locked_at is not null
        and locked_at <= ${staleLockedBeforeIso}::timestamptz
      `, sql`locked_at asc, scheduled_at asc, created_at asc, id asc`, input.limit - rows.length, nowIso, input.catalogId);
    return [...rows, ...staleRows];
  }

  private async claimRows(
    statusFilter: SQL,
    orderBy: SQL,
    limit: number,
    lockedAtIso: string,
    catalogId: string,
  ) {
    if (limit <= 0) return [];
    const rows = await this.db.execute(sql`
      with claimed_events as (
        select id
        from catalog_outbox_events
        where catalog_id = ${catalogId}
          and ${statusFilter}
        order by ${orderBy}
        for update skip locked
        limit ${limit}
      )
      update catalog_outbox_events as events
      set
        status = 'running',
        locked_at = ${lockedAtIso}::timestamptz,
        updated_at = ${lockedAtIso}::timestamptz
      from claimed_events
      where events.id = claimed_events.id
      returning
        events.id,
        events.catalog_id as "catalogId",
        events.provider_id as "providerId",
        events.event_type as "eventType",
        events.aggregate_type as "aggregateType",
        events.aggregate_id as "aggregateId",
        events.dedupe_key as "dedupeKey",
        events.status,
        events.attempt_count as "attemptCount",
        events.max_attempts as "maxAttempts",
        events.payload
    `);

    return rows as unknown as CatalogOutboxEvent[];
  }

  private async deliver(event: CatalogOutboxEvent) {
    if (event.eventType === 'search_index.enqueue_job') {
      const job = requireRecord(event.payload.job, 'payload.job');
      const jobType = requireSearchIndexJobType(job.jobType);
      await this.searchIndexJobs.enqueue({
        catalogId: requireString(job.catalogId, 'payload.job.catalogId'),
        providerId: optionalString(job.providerId, 'payload.job.providerId'),
        catalogEntryId: optionalString(job.catalogEntryId, 'payload.job.catalogEntryId'),
        commercialObjectId: optionalString(job.commercialObjectId, 'payload.job.commercialObjectId'),
        dedupeKey: requireString(job.dedupeKey, 'payload.job.dedupeKey'),
        jobType,
        payload: optionalRecord(job.payload, 'payload.job.payload') ?? {},
      });
      return;
    }

    if (event.eventType === 'activity.ingest') {
      await this.activityEvents.ingest(requireRecord(event.payload.event, 'payload.event'));
      return;
    }

    throw new Error(`Unsupported catalog outbox event type ${event.eventType}`);
  }

  private async markCompleted(eventId: string) {
    await this.db
      .update(schema.catalogOutboxEvents)
      .set({
        status: 'completed',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogOutboxEvents.id, eventId));
  }

  private async markFailed(event: CatalogOutboxEvent, error: string, retryDelayMs: number) {
    const nextAttemptCount = event.attemptCount + 1;
    const shouldRetry = nextAttemptCount < event.maxAttempts;
    await this.db
      .update(schema.catalogOutboxEvents)
      .set({
        status: shouldRetry ? 'pending' : 'failed',
        attemptCount: nextAttemptCount,
        scheduledAt: shouldRetry ? new Date(Date.now() + retryDelayMs) : new Date(),
        finishedAt: shouldRetry ? null : new Date(),
        error,
        updatedAt: new Date(),
      })
      .where(eq(schema.catalogOutboxEvents.id, event.id));
  }
}

function requireRecord(value: unknown, field: string) {
  const record = optionalRecord(value, field);
  if (!record) throw new Error(`${field} must be an object`);
  return record;
}

function optionalRecord(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function requireSearchIndexJobType(value: unknown) {
  const jobType = requireString(value, 'payload.job.jobType') as SearchIndexJobType;
  if (!SEARCH_INDEX_JOB_TYPES.has(jobType)) throw new Error(`Unsupported search index job type ${jobType}`);
  return jobType;
}
