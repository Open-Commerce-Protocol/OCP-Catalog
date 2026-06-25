import { createHash } from 'node:crypto';
import type { ActivityDb as Db } from '@ocp-catalog/activity-db';
import { activitySchema as schema } from '@ocp-catalog/activity-db';
import {
  ocpActivityBatchInputSchema,
  ocpActivityEventInputSchema,
  ocpActivityEventSchema,
  ocpPublicActivityEventSchema,
  type OcpActivityBatchInput,
  type OcpActivityEvent,
  type OcpActivityEventInput,
  type OcpPublicActivityEvent,
} from '@ocp-catalog/ocp-activity-schema';
import { newId, nowIso } from '@ocp-catalog/shared';
import { desc, eq, or, sql } from 'drizzle-orm';

export function normalizeActivityEvent(input: unknown): OcpActivityEvent {
  const parsed = ocpActivityEventInputSchema.parse(input);
  const timestamp = nowIso();
  return ocpActivityEventSchema.parse({
    ...parsed,
    event_id: parsed.event_id ?? newId('evt'),
    occurred_at: parsed.occurred_at ?? timestamp,
    observed_at: parsed.observed_at ?? timestamp,
  });
}

export function createPublicActivityEvent(event: OcpActivityEvent): OcpPublicActivityEvent | null {
  if (event.public_visibility === 'private') return null;

  const createdAt = nowIso();
  return {
    public_event_id: newId('pevt'),
    raw_event_id: event.event_id,
    occurred_at: event.occurred_at,
    event_type: event.event_type,
    source_kind: event.source_kind,
    client_kind: event.client_kind,
    protocol_family: event.protocol_family,
    catalog_id: event.public_visibility === 'public' ? event.catalog_id ?? null : null,
    provider_id: event.public_visibility === 'public' ? event.provider_id ?? null : null,
    object_type: event.object_type ?? null,
    status_class: statusClass(event),
    duration_bucket: durationBucket(event.duration_ms),
    result_count_bucket: countBucket(event.result_count ?? event.sync_object_count),
    public_summary: publicSummary(event),
    correlation_id_hash: event.correlation_id ? stableHash(event.correlation_id) : null,
    created_at: createdAt,
  };
}

export class ActivityEventService {
  constructor(private readonly db: Db) {}

  async ingest(input: unknown) {
    const event = normalizeActivityEvent(input);
    const [inserted] = await this.db
      .insert(schema.ocpActivityRawEvents)
      .values(rawEventToRow(event))
      .onConflictDoNothing()
      .returning();

    const raw = inserted ?? await this.findRawEvent(event);
    if (!raw) {
      throw new Error(`Failed to persist or locate activity event ${event.event_id}`);
    }

    let [publicEvent] = await this.db
      .select()
      .from(schema.ocpActivityPublicEvents)
      .where(eq(schema.ocpActivityPublicEvents.rawEventId, raw.id))
      .limit(1);

    if (!publicEvent && inserted) {
      const projection = createPublicActivityEvent(event);
      if (projection) {
        [publicEvent] = await this.db
          .insert(schema.ocpActivityPublicEvents)
          .values(publicEventToRow(projection))
          .onConflictDoNothing()
          .returning();
      }
    }

    return {
      event_id: raw.id,
      duplicate: !inserted,
      public_event: publicEvent ? publicRowToApi(publicEvent) : null,
    };
  }

  async ingestBatch(input: unknown) {
    const batch = ocpActivityBatchInputSchema.parse(input);
    const events = [];
    for (const event of batch.events) {
      events.push(await this.ingest(event));
    }
    return { events };
  }

  async listRecentPublicEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = await this.db
      .select()
      .from(schema.ocpActivityPublicEvents)
      .orderBy(desc(schema.ocpActivityPublicEvents.occurredAt))
      .limit(safeLimit);

    return rows.map(publicRowToApi);
  }

  async getRollups(hours = 24) {
    const safeHours = Math.max(1, Math.min(Math.trunc(hours), 168));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const rows = await this.db
      .select()
      .from(schema.ocpActivityPublicEvents)
      .where(sql`${schema.ocpActivityPublicEvents.occurredAt} >= ${since}::timestamptz`);

    const byType: Record<string, number> = {};
    const byProtocol: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const row of rows) {
      byType[row.eventType] = (byType[row.eventType] ?? 0) + 1;
      byProtocol[row.protocolFamily] = (byProtocol[row.protocolFamily] ?? 0) + 1;
      byStatus[row.statusClass] = (byStatus[row.statusClass] ?? 0) + 1;
    }

    return {
      window_hours: safeHours,
      event_count: rows.length,
      by_event_type: byType,
      by_protocol_family: byProtocol,
      by_status_class: byStatus,
    };
  }

  /**
   * Per-provider rollup for provider-facing dashboards (e.g. a merchant seeing
   * how often agents resolved their catalog entries). Counts bucket by
   * event_type so callers read e.g. `catalog.resolved` (opens).
   *
   * Reads the RAW events table (not the public feed): the public feed nulls
   * provider_id for `aggregate_only` events by design, so per-provider rollups
   * must come from raw. A provider sees only their OWN attributed counts.
   */
  async getProviderRollups(providerId: string, hours = 168) {
    const safeHours = Math.max(1, Math.min(Math.trunc(hours), 720));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const rows = await this.db
      .select()
      .from(schema.ocpActivityRawEvents)
      .where(sql`${schema.ocpActivityRawEvents.providerId} = ${providerId}
        AND ${schema.ocpActivityRawEvents.occurredAt} >= ${since}::timestamptz`);

    const byType: Record<string, number> = {};
    let success = 0;
    let error = 0;
    for (const row of rows) {
      byType[row.eventType] = (byType[row.eventType] ?? 0) + 1;
      if (typeof row.statusCode === 'number' && row.statusCode >= 200 && row.statusCode < 400) success += 1;
      else if (typeof row.statusCode === 'number') error += 1;
    }

    return {
      provider_id: providerId,
      window_hours: safeHours,
      event_count: rows.length,
      // Convenience aliases for the common dashboard metrics.
      queried: byType['catalog.queried'] ?? 0,
      resolved: byType['catalog.resolved'] ?? 0,
      object_synced: byType['catalog.object_synced'] ?? 0,
      by_event_type: byType,
      by_status_class: { success, error },
    };
  }

  private async findRawEvent(event: OcpActivityEvent) {
    const conditions = event.idempotency_key
      ? or(
        eq(schema.ocpActivityRawEvents.id, event.event_id),
        eq(schema.ocpActivityRawEvents.idempotencyKey, event.idempotency_key),
      )
      : eq(schema.ocpActivityRawEvents.id, event.event_id);

    const [raw] = await this.db
      .select()
      .from(schema.ocpActivityRawEvents)
      .where(conditions)
      .limit(1);

    return raw ?? null;
  }
}

function rawEventToRow(event: OcpActivityEvent): typeof schema.ocpActivityRawEvents.$inferInsert {
  return {
    id: event.event_id,
    eventVersion: event.event_version,
    eventType: event.event_type,
    idempotencyKey: event.idempotency_key ?? null,
    occurredAt: new Date(event.occurred_at),
    observedAt: new Date(event.observed_at),
    correlationId: event.correlation_id ?? null,
    traceId: event.trace_id ?? null,
    spanId: event.span_id ?? null,
    parentEventId: event.parent_event_id ?? null,
    sourceKind: event.source_kind,
    clientKind: event.client_kind,
    endpointRole: event.endpoint_role,
    protocolFamily: event.protocol_family,
    protocolVersion: event.protocol_version ?? null,
    method: event.method ?? null,
    pathTemplate: event.path_template ?? null,
    statusCode: event.status_code ?? null,
    durationMs: event.duration_ms ?? null,
    errorCode: event.error_code ?? null,
    registrationId: event.registration_id ?? null,
    catalogId: event.catalog_id ?? null,
    providerId: event.provider_id ?? null,
    objectType: event.object_type ?? null,
    queryPack: event.query_pack ?? null,
    capabilityId: event.capability_id ?? null,
    resultCount: event.result_count ?? null,
    syncObjectCount: event.sync_object_count ?? null,
    publicVisibility: event.public_visibility,
    redactionPolicyVersion: event.redaction_policy_version,
    payloadHash: event.payload_hash ?? null,
    metadata: event.metadata,
    rawEvent: event as unknown as Record<string, unknown>,
  };
}

function publicEventToRow(event: OcpPublicActivityEvent): typeof schema.ocpActivityPublicEvents.$inferInsert {
  return {
    id: event.public_event_id,
    rawEventId: event.raw_event_id,
    occurredAt: new Date(event.occurred_at),
    eventType: event.event_type,
    sourceKind: event.source_kind,
    clientKind: event.client_kind,
    protocolFamily: event.protocol_family,
    catalogId: event.catalog_id,
    providerId: event.provider_id,
    objectType: event.object_type,
    statusClass: event.status_class,
    durationBucket: event.duration_bucket,
    resultCountBucket: event.result_count_bucket,
    publicSummary: event.public_summary,
    correlationIdHash: event.correlation_id_hash,
    createdAt: new Date(event.created_at),
  };
}

function publicRowToApi(row: typeof schema.ocpActivityPublicEvents.$inferSelect): OcpPublicActivityEvent {
  return ocpPublicActivityEventSchema.parse({
    public_event_id: row.id,
    raw_event_id: row.rawEventId,
    occurred_at: row.occurredAt.toISOString(),
    event_type: row.eventType,
    source_kind: row.sourceKind,
    client_kind: row.clientKind,
    protocol_family: row.protocolFamily,
    catalog_id: row.catalogId,
    provider_id: row.providerId,
    object_type: row.objectType,
    status_class: row.statusClass,
    duration_bucket: row.durationBucket,
    result_count_bucket: row.resultCountBucket,
    public_summary: row.publicSummary,
    correlation_id_hash: row.correlationIdHash,
    created_at: row.createdAt.toISOString(),
  });
}

function statusClass(event: OcpActivityEvent) {
  if (event.event_type === 'policy.denied') return 'policy_denied';
  if (!event.status_code) return event.error_code ? 'server_error' : 'unknown';
  if (event.status_code >= 500) return 'server_error';
  if (event.status_code >= 400) return 'client_error';
  return 'success';
}

function durationBucket(durationMs: number | undefined) {
  if (durationMs == null) return 'none';
  if (durationMs < 100) return 'lt_100ms';
  if (durationMs < 500) return 'lt_500ms';
  if (durationMs < 1000) return 'lt_1s';
  if (durationMs < 5000) return 'lt_5s';
  return 'gte_5s';
}

function countBucket(count: number | undefined) {
  if (count == null) return 'none';
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  if (count < 10) return 'lt_10';
  if (count < 100) return 'lt_100';
  return 'gte_100';
}

function publicSummary(event: OcpActivityEvent) {
  const subject = event.catalog_id ?? event.registration_id ?? event.provider_id ?? event.source_kind;
  const status = event.status_code ? `HTTP ${event.status_code}` : event.error_code ? `error ${event.error_code}` : 'recorded';
  return `${event.event_type} for ${subject} (${status})`;
}

function stableHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
