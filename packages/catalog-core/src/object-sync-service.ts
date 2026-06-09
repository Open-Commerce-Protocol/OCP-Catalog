import type { AppConfig } from '@ocp-catalog/config';
import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  commercialObjectSchema,
  objectSyncRequestSchema,
  type CommercialObject,
  type ObjectSyncItemResult,
  type ObjectSyncRequest,
  type ObjectSyncResult,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { isPresent, readDescriptorField } from './field-ref';
import type { CatalogScenarioModule, SearchProjection } from './scenario';
import type { RegistrationService } from './registration-service';

const MAX_DESCRIPTOR_PAYLOAD_BYTES = 64 * 1024;
const MAX_OBJECT_SYNC_BATCH_SIZE = 1_000;
const UNCHANGED_OBJECT_WARNING = 'unchanged_object_hash';
// Multi-row INSERT/UPSERT statements are split into groups of this many rows to
// stay well under the PostgreSQL/postgres-js bind-parameter ceiling. Wide tables
// (commercial_objects, catalog_entries) carry ~15-18 columns per row, and the
// flattened descriptor insert can exceed the object count, so we keep this
// conservative. Mirrors the chunking precedent in the embedding backfill path.
const BULK_WRITE_CHUNK_SIZE = 500;

export type ObjectSyncOptions = {
  syncRun?: {
    syncRunId?: string;
    runMode: 'batch' | 'stream';
    streamBatchId?: string;
    chunkOrdinal?: number;
    complete?: boolean;
    requestMetadata?: Record<string, unknown>;
  };
  sideEffects?: {
    searchIndexJobs?: boolean;
    activityEvent?: {
      method: string;
      pathTemplate: string;
      statusCode: number;
      metadata?: Record<string, unknown>;
    };
  };
};

export class ObjectSyncService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly registrations: RegistrationService,
    private readonly scenario: CatalogScenarioModule,
  ) {}

  async sync(input: unknown, options: ObjectSyncOptions = {}): Promise<ObjectSyncResult> {
    const startedAt = performance.now();
    const timings: Record<string, number> = {};
    const request = objectSyncRequestSchema.parse(input);
    timings.parse_ms = elapsedMs(startedAt);
    if (request.catalog_id !== this.config.CATALOG_ID) {
      throw new AppError('validation_error', `catalog_id must be ${this.config.CATALOG_ID}`, 400);
    }
    if (request.objects.length > MAX_OBJECT_SYNC_BATCH_SIZE) {
      throw new AppError('validation_error', `Object sync batch exceeds ${MAX_OBJECT_SYNC_BATCH_SIZE} objects`, 413, {
        max_object_count: MAX_OBJECT_SYNC_BATCH_SIZE,
        object_count: request.objects.length,
      });
    }
    const duplicateObjectId = firstDuplicateObjectId(request.objects);
    if (duplicateObjectId) {
      throw new AppError('validation_error', 'Object sync batch contains duplicate object_id values', 400, {
        object_id: duplicateObjectId,
      });
    }

    const providerStartedAt = performance.now();
    const providerState = await this.registrations.findProviderState(request.provider_id);
    timings.provider_state_ms = elapsedMs(providerStartedAt);
    if (!providerState || providerState.status !== 'active') {
      throw new AppError('validation_error', `Provider ${request.provider_id} is not active`, 400);
    }
    if (providerState.activeRegistrationVersion !== request.registration_version) {
      throw new AppError('validation_error', 'registration_version does not match active provider contract state', 400, {
        active_registration_version: providerState.activeRegistrationVersion,
      });
    }

    const batchId = request.batch_id ?? newId('batch');
    const requestHash = await hashJson({
      catalog_id: request.catalog_id,
      provider_id: request.provider_id,
      registration_version: request.registration_version,
      objects: request.objects,
    });
    const replayStartedAt = performance.now();
    const existingResult = await this.findExistingBatchResult({
      catalogId: request.catalog_id,
      providerId: request.provider_id,
      registrationVersion: request.registration_version,
      batchId,
      requestHash,
    });
    timings.replay_lookup_ms = elapsedMs(replayStartedAt);
    if (existingResult) {
      logObjectSyncTiming(request, existingResult, timings, startedAt, 'replayed');
      return existingResult;
    }

    const throttleStartedAt = performance.now();
    await this.assertProviderSyncAllowed(request.provider_id);
    timings.throttle_ms = elapsedMs(throttleStartedAt);

    const batchRowId = newId('syncbatch');
    const transactionStartedAt = performance.now();
    const result = await this.db.transaction(async (tx) => {
      const syncDb = tx as unknown as Db;
      const syncRun = await this.ensureSyncRun(syncDb, request, batchId, options);
      const [insertedBatch] = await syncDb
        .insert(schema.objectSyncChunks)
        .values({
          id: batchRowId,
          catalogId: request.catalog_id,
          providerId: request.provider_id,
          registrationVersion: request.registration_version,
          syncRunRowId: syncRun?.id ?? null,
          chunkOrdinal: options.syncRun?.chunkOrdinal ?? null,
          batchId,
          status: 'rejected',
          requestHash,
          requestMetadata: {
            object_count: request.objects.length,
            has_client_batch_id: request.batch_id !== undefined,
            request_hash: requestHash,
          },
        })
        .onConflictDoNothing({
          target: [
            schema.objectSyncChunks.catalogId,
            schema.objectSyncChunks.providerId,
            schema.objectSyncChunks.batchId,
          ],
        })
        .returning({ id: schema.objectSyncChunks.id });
      if (!insertedBatch) {
        const replayed = await this.findExistingBatchResult({
          catalogId: request.catalog_id,
          providerId: request.provider_id,
          registrationVersion: request.registration_version,
          batchId,
          requestHash,
        }, syncDb);
        if (replayed) return replayed;
        throw new AppError('validation_error', 'batch_id already exists but could not be replayed', 409, {
          batch_id: batchId,
        });
      }

      const items = await this.syncChunk(syncDb, request.objects, {
        catalogId: request.catalog_id,
        providerId: request.provider_id,
        registrationVersion: request.registration_version,
        scenario: this.scenario,
      });

      if (items.length > 0) {
        await syncDb.insert(schema.objectSyncItemResults).values(items.map((item, itemOrdinal) => ({
          id: newId('syncitem'),
          syncChunkId: batchRowId,
          itemOrdinal,
          objectId: item.object_id ?? null,
          status: item.status,
          commercialObjectId: item.commercial_object_id ?? null,
          catalogEntryId: item.catalog_entry_id ?? null,
          errors: item.errors,
          warnings: item.warnings,
        })));
      }

      const acceptedCount = items.filter((item) => item.status === 'accepted').length;
      const rejectedCount = items.length - acceptedCount;
      const status = acceptedCount === 0 ? 'rejected' : rejectedCount > 0 ? 'partial' : 'accepted';
      const result: ObjectSyncResult = {
        ocp_version: '1.0',
        kind: 'ObjectSyncResult',
        id: newId('syncres'),
        catalog_id: request.catalog_id,
        provider_id: request.provider_id,
        registration_version: request.registration_version,
        batch_id: batchId,
        status,
        accepted_count: acceptedCount,
        rejected_count: rejectedCount,
        error_count: rejectedCount,
        items: items.map(toPublicItemResult),
      };

      await syncDb
        .update(schema.objectSyncChunks)
        .set({
          status,
          acceptedCount,
          rejectedCount,
          errorCount: rejectedCount,
          resultSummary: {
            result_id: result.id,
            item_count: items.length,
            accepted_count: acceptedCount,
            rejected_count: rejectedCount,
            error_count: rejectedCount,
          },
          finishedAt: new Date(),
        })
        .where(eq(schema.objectSyncChunks.id, batchRowId));

      if (syncRun) {
        await this.updateSyncRunAfterBatch(syncDb, syncRun.id, result, options);
      }

      await this.insertOutboxEvents(syncDb, result, items, options);

      return result;
    });
    timings.transaction_ms = elapsedMs(transactionStartedAt);
    logObjectSyncTiming(request, result, timings, startedAt, 'committed');
    return result;
  }

  async listProviderObjects(providerId: string) {
    return this.db
      .select({
        id: schema.commercialObjects.id,
        catalog_id: schema.commercialObjects.catalogId,
        provider_id: schema.commercialObjects.providerId,
        object_id: schema.commercialObjects.objectId,
        object_type: schema.commercialObjects.objectType,
        title: schema.commercialObjects.title,
        summary: schema.commercialObjects.summary,
        status: schema.commercialObjects.status,
        source_url: schema.commercialObjects.sourceUrl,
        updated_at: schema.commercialObjects.updatedAt,
      })
      .from(schema.commercialObjects)
      .where(and(
        eq(schema.commercialObjects.catalogId, this.config.CATALOG_ID),
        eq(schema.commercialObjects.providerId, providerId),
      ));
  }

  async getObject(objectId: string) {
    const [object] = await this.db
      .select()
      .from(schema.commercialObjects)
      .where(eq(schema.commercialObjects.id, objectId))
      .limit(1);

    if (!object) throw new AppError('not_found', `Commercial object ${objectId} was not found`, 404);
    return object;
  }

  async getSyncRun(syncRunId: string, providerId?: string) {
    const [run] = await this.db
      .select()
      .from(schema.objectSyncRuns)
      .where(and(
        eq(schema.objectSyncRuns.catalogId, this.config.CATALOG_ID),
        eq(schema.objectSyncRuns.syncRunId, syncRunId),
        ...(providerId ? [eq(schema.objectSyncRuns.providerId, providerId)] : []),
      ))
      .limit(1);

    if (!run) throw new AppError('not_found', `Object sync run ${syncRunId} was not found`, 404);
    return this.buildSyncRunResult(run);
  }

  async completeSyncRun(syncRunId: string, providerId?: string) {
    const [run] = await this.db
      .select()
      .from(schema.objectSyncRuns)
      .where(and(
        eq(schema.objectSyncRuns.catalogId, this.config.CATALOG_ID),
        eq(schema.objectSyncRuns.syncRunId, syncRunId),
        ...(providerId ? [eq(schema.objectSyncRuns.providerId, providerId)] : []),
      ))
      .limit(1);

    if (!run) throw new AppError('not_found', `Object sync run ${syncRunId} was not found`, 404);
    if (run.status !== 'running') return this.buildSyncRunResult(run);

    const summary = await this.aggregateSyncRun(this.db, run.id);
    const status = syncRunStatusFromCounts(summary.acceptedCount, summary.rejectedCount);
    const [updated] = await this.db
      .update(schema.objectSyncRuns)
      .set({
        status,
        batchCount: summary.batchCount,
        acceptedCount: summary.acceptedCount,
        rejectedCount: summary.rejectedCount,
        errorCount: summary.errorCount,
        checkpoint: summary.checkpoint,
        resultSummary: {
          batch_count: summary.batchCount,
          accepted_count: summary.acceptedCount,
          rejected_count: summary.rejectedCount,
          error_count: summary.errorCount,
        },
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(schema.objectSyncRuns.id, run.id))
      .returning();

    return this.buildSyncRunResult(updated ?? run);
  }

  private async findExistingBatchResult(input: {
    catalogId: string;
    providerId: string;
    registrationVersion: number;
    batchId: string;
    requestHash: string;
  }, db: Db = this.db): Promise<ObjectSyncResult | null> {
    const [batch] = await db
      .select()
      .from(schema.objectSyncChunks)
      .where(and(
        eq(schema.objectSyncChunks.catalogId, input.catalogId),
        eq(schema.objectSyncChunks.providerId, input.providerId),
        eq(schema.objectSyncChunks.batchId, input.batchId),
      ))
      .limit(1);

    if (!batch) return null;
    if (batch.requestHash !== input.requestHash) {
      throw new AppError('validation_error', 'batch_id already exists with a different request hash', 409, {
        batch_id: input.batchId,
      });
    }

    const items = await db
      .select()
      .from(schema.objectSyncItemResults)
      .where(eq(schema.objectSyncItemResults.syncChunkId, batch.id))
      .orderBy(schema.objectSyncItemResults.itemOrdinal, schema.objectSyncItemResults.id);

    return {
      ocp_version: '1.0',
      kind: 'ObjectSyncResult',
      id: stringValue(batch.resultSummary.result_id) ?? newId('syncres'),
      catalog_id: input.catalogId,
      provider_id: input.providerId,
      registration_version: input.registrationVersion,
      batch_id: input.batchId,
      status: batch.status,
      accepted_count: batch.acceptedCount,
      rejected_count: batch.rejectedCount,
      error_count: batch.errorCount,
      items: items.map((item) => ({
        object_id: item.objectId ?? undefined,
        status: item.status,
        commercial_object_id: item.commercialObjectId ?? undefined,
        catalog_entry_id: item.catalogEntryId ?? undefined,
        errors: item.errors,
        warnings: item.warnings,
      })),
    };
  }

  private async ensureSyncRun(db: Db, request: ObjectSyncRequest, batchId: string, options: ObjectSyncOptions) {
    if (!options.syncRun) return null;
    const syncRunId = options.syncRun.syncRunId ?? batchId;
    const runRowId = newId('syncrun');
    await db
      .insert(schema.objectSyncRuns)
      .values({
        id: runRowId,
        catalogId: request.catalog_id,
        providerId: request.provider_id,
        registrationVersion: request.registration_version,
        syncRunId,
        runMode: options.syncRun.runMode,
        streamBatchId: options.syncRun.streamBatchId ?? null,
        requestMetadata: {
          ...options.syncRun.requestMetadata,
          sync_run_id: syncRunId,
          run_mode: options.syncRun.runMode,
        },
      })
      .onConflictDoNothing({
        target: [
          schema.objectSyncRuns.catalogId,
          schema.objectSyncRuns.providerId,
          schema.objectSyncRuns.syncRunId,
        ],
      });

    const [run] = await db
      .select()
      .from(schema.objectSyncRuns)
      .where(and(
        eq(schema.objectSyncRuns.catalogId, request.catalog_id),
        eq(schema.objectSyncRuns.providerId, request.provider_id),
        eq(schema.objectSyncRuns.syncRunId, syncRunId),
      ))
      .limit(1);

    if (!run) {
      throw new AppError('internal_error', `Failed to create object sync run ${syncRunId}`, 500);
    }
    if (run.registrationVersion !== request.registration_version) {
      throw new AppError('validation_error', 'sync_run_id already exists with a different registration_version', 409, {
        sync_run_id: syncRunId,
      });
    }
    if (run.runMode !== options.syncRun.runMode) {
      throw new AppError('validation_error', 'sync_run_id already exists with a different run mode', 409, {
        sync_run_id: syncRunId,
      });
    }
    if (run.status !== 'running') {
      throw new AppError('validation_error', 'sync_run_id is already terminal', 409, {
        sync_run_id: syncRunId,
        status: run.status,
      });
    }
    return run;
  }

  private async updateSyncRunAfterBatch(
    db: Db,
    syncRunRowId: string,
    result: ObjectSyncResult,
    options: ObjectSyncOptions,
  ) {
    const completed = options.syncRun?.complete === true;
    if (!completed) {
      await db
        .update(schema.objectSyncRuns)
        .set({
          status: 'running',
          batchCount: sql`${schema.objectSyncRuns.batchCount} + 1`,
          acceptedCount: sql`${schema.objectSyncRuns.acceptedCount} + ${result.accepted_count}`,
          rejectedCount: sql`${schema.objectSyncRuns.rejectedCount} + ${result.rejected_count}`,
          errorCount: sql`${schema.objectSyncRuns.errorCount} + ${result.error_count}`,
          lastBatchId: result.batch_id,
          lastChunkOrdinal: options.syncRun?.chunkOrdinal ?? null,
          checkpoint: sql`jsonb_set(
            jsonb_set(
              coalesce(${schema.objectSyncRuns.checkpoint}, '{}'::jsonb),
              '{last_batch_id}',
              to_jsonb(${result.batch_id}::text),
              true
            ),
            '{last_chunk_ordinal}',
            coalesce(to_jsonb(${options.syncRun?.chunkOrdinal ?? null}::int), 'null'::jsonb),
            true
          )`,
          resultSummary: {
            last_batch_id: result.batch_id,
            last_chunk_ordinal: options.syncRun?.chunkOrdinal ?? null,
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.objectSyncRuns.id, syncRunRowId));
      return;
    }

    const summary = await this.aggregateSyncRun(db, syncRunRowId);
    await db
      .update(schema.objectSyncRuns)
      .set({
        status: syncRunStatusFromCounts(summary.acceptedCount, summary.rejectedCount),
        batchCount: summary.batchCount,
        acceptedCount: summary.acceptedCount,
        rejectedCount: summary.rejectedCount,
        errorCount: summary.errorCount,
        lastBatchId: result.batch_id,
        lastChunkOrdinal: options.syncRun?.chunkOrdinal ?? null,
        checkpoint: summary.checkpoint,
        resultSummary: {
          batch_count: summary.batchCount,
          accepted_count: summary.acceptedCount,
          rejected_count: summary.rejectedCount,
          error_count: summary.errorCount,
          last_batch_id: result.batch_id,
          last_chunk_ordinal: options.syncRun?.chunkOrdinal ?? null,
        },
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(schema.objectSyncRuns.id, syncRunRowId));
  }

  private async aggregateSyncRun(db: Db, syncRunRowId: string) {
    const [aggregate] = await db
      .select({
        batchCount: sql<number>`count(*)::int`,
        acceptedCount: sql<number>`coalesce(sum(${schema.objectSyncChunks.acceptedCount}), 0)::int`,
        rejectedCount: sql<number>`coalesce(sum(${schema.objectSyncChunks.rejectedCount}), 0)::int`,
        errorCount: sql<number>`coalesce(sum(${schema.objectSyncChunks.errorCount}), 0)::int`,
        lastChunkOrdinal: sql<number | null>`max(${schema.objectSyncChunks.chunkOrdinal})::int`,
      })
      .from(schema.objectSyncChunks)
      .where(eq(schema.objectSyncChunks.syncRunRowId, syncRunRowId));

    const batches = await db
      .select({
        batch_id: schema.objectSyncChunks.batchId,
        chunk_ordinal: schema.objectSyncChunks.chunkOrdinal,
        status: schema.objectSyncChunks.status,
        accepted_count: schema.objectSyncChunks.acceptedCount,
        rejected_count: schema.objectSyncChunks.rejectedCount,
        error_count: schema.objectSyncChunks.errorCount,
        request_hash: schema.objectSyncChunks.requestHash,
        finished_at: schema.objectSyncChunks.finishedAt,
      })
      .from(schema.objectSyncChunks)
      .where(eq(schema.objectSyncChunks.syncRunRowId, syncRunRowId))
      .orderBy(asc(schema.objectSyncChunks.chunkOrdinal), asc(schema.objectSyncChunks.createdAt));

    return {
      batchCount: aggregate?.batchCount ?? 0,
      acceptedCount: aggregate?.acceptedCount ?? 0,
      rejectedCount: aggregate?.rejectedCount ?? 0,
      errorCount: aggregate?.errorCount ?? 0,
      checkpoint: {
        committed_chunk_count: batches.length,
        last_committed_chunk_ordinal: aggregate?.lastChunkOrdinal ?? null,
        chunks: batches.map((batch) => ({
          batch_id: batch.batch_id,
          chunk_ordinal: batch.chunk_ordinal,
          status: batch.status,
          accepted_count: batch.accepted_count,
          rejected_count: batch.rejected_count,
          error_count: batch.error_count,
          request_hash: batch.request_hash,
          finished_at: batch.finished_at?.toISOString() ?? null,
        })),
      },
    };
  }

  private async buildSyncRunResult(run: typeof schema.objectSyncRuns.$inferSelect) {
    const summary = await this.aggregateSyncRun(this.db, run.id);
    return {
      ocp_version: '1.0',
      kind: 'ObjectSyncRun',
      catalog_id: run.catalogId,
      provider_id: run.providerId,
      registration_version: run.registrationVersion,
      sync_run_id: run.syncRunId,
      run_mode: run.runMode,
      status: run.status,
      stream_batch_id: run.streamBatchId ?? undefined,
      batch_count: summary.batchCount,
      accepted_count: summary.acceptedCount,
      rejected_count: summary.rejectedCount,
      error_count: summary.errorCount,
      checkpoint: summary.checkpoint,
      result_summary: run.resultSummary,
      error: run.error ?? undefined,
      created_at: run.createdAt.toISOString(),
      updated_at: run.updatedAt.toISOString(),
      finished_at: run.finishedAt?.toISOString(),
    };
  }

  private async insertOutboxEvents(
    db: Db,
    result: ObjectSyncResult,
    syncItems: SyncItemResult[],
    options: ObjectSyncOptions,
  ) {
    const events: Array<typeof schema.catalogOutboxEvents.$inferInsert> = [];
    if (options.sideEffects?.searchIndexJobs) {
      for (const item of syncItems) {
        if (
          item.status !== 'accepted'
          || !item.catalog_entry_id
          || !item.commercial_object_id
          || item.warnings.includes(UNCHANGED_OBJECT_WARNING)
        ) continue;
        events.push({
          id: newId('outbox'),
          catalogId: result.catalog_id,
          providerId: result.provider_id,
          eventType: 'search_index.enqueue_job',
          aggregateType: 'object_sync_chunk',
          aggregateId: result.batch_id,
          dedupeKey: `search_index:sync:${result.batch_id}:upsert_document:${item.catalog_entry_id}`,
          payload: {
            job: {
              catalogId: result.catalog_id,
              providerId: result.provider_id,
              catalogEntryId: item.catalog_entry_id,
              commercialObjectId: item.commercial_object_id,
              dedupeKey: `sync:${result.batch_id}:upsert_document:${item.catalog_entry_id}`,
              jobType: 'upsert_document',
              payload: {
                object_id: item.object_id,
                registration_version: result.registration_version,
                ...(item.searchDocumentSnapshot
                  ? { search_document_snapshot: item.searchDocumentSnapshot }
                  : {}),
              },
            },
          },
        });
      }
    }

    const activityEvent = options.sideEffects?.activityEvent;
    if (activityEvent) {
      events.push({
        id: newId('outbox'),
        catalogId: result.catalog_id,
        providerId: result.provider_id,
        eventType: 'activity.ingest',
        aggregateType: 'object_sync_chunk',
        aggregateId: result.batch_id,
        dedupeKey: `activity:object_sync:${result.batch_id}:${activityEvent.pathTemplate}`,
        payload: {
          event: {
            idempotency_key: `object_sync:${result.catalog_id}:${result.provider_id}:${result.batch_id}:${activityEvent.pathTemplate}`,
            event_type: 'catalog.object_synced',
            source_kind: 'catalog_node',
            client_kind: 'http',
            endpoint_role: 'inbound',
            protocol_family: 'catalog',
            protocol_version: '1.0',
            method: activityEvent.method,
            path_template: activityEvent.pathTemplate,
            status_code: activityEvent.statusCode,
            catalog_id: result.catalog_id,
            provider_id: result.provider_id,
            sync_object_count: result.items.length,
            public_visibility: 'public',
            metadata: {
              sync_status: result.status,
              accepted_count: result.accepted_count,
              rejected_count: result.rejected_count,
              ...activityEvent.metadata,
            },
          },
        },
      });
    }

    if (events.length === 0) return;
    await db
      .insert(schema.catalogOutboxEvents)
      .values(events)
      .onConflictDoNothing({
        target: [
          schema.catalogOutboxEvents.catalogId,
          schema.catalogOutboxEvents.dedupeKey,
        ],
      });
  }

  /**
   * Persist a full sync chunk with batched writes instead of one round-trip per
   * object. Returns `SyncItemResult[]` in input order so callers can keep using
   * `itemOrdinal`, build `object_sync_item_results`, and emit outbox events
   * exactly as before. Per-item partial-accept semantics are preserved: objects
   * that fail parse/validation are marked rejected and excluded from DB writes,
   * while valid objects are written in bulk.
   */
  private async syncChunk(db: Db, inputs: unknown[], context: SyncContext): Promise<SyncItemResult[]> {
    // Stage 0: in-memory preprocess (no DB). Reject parse/validation failures
    // up front so the bulk statements only ever carry valid rows.
    const slots: ChunkSlot[] = await Promise.all(inputs.map(async (input) => {
      const parsed = commercialObjectSchema.safeParse(input);
      if (!parsed.success) {
        return {
          kind: 'rejected',
          result: {
            object_id: extractObjectId(input),
            status: 'rejected',
            errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'object'}: ${issue.message}`),
            warnings: [],
          },
        };
      }

      const object = sanitizeCommercialObjectStrings(parsed.data);
      const errors = validateCommercialObject(object, context);
      if (errors.length > 0) {
        return {
          kind: 'rejected',
          result: {
            object_id: object.object_id,
            status: 'rejected',
            errors,
            warnings: [],
          },
        };
      }

      const projection = this.scenario.buildSearchProjection(object);
      const explainProjection = this.scenario.buildExplainProjection?.(object, projection)
        ?? buildDefaultExplainProjection(object, projection);
      const rawObjectHash = await hashJson(object);
      const descriptorHash = await hashJson(toDescriptorHashPayload(object));
      return {
        kind: 'candidate',
        candidate: { object, projection, explainProjection, rawObjectHash, descriptorHash },
      };
    }));

    const candidates = slots
      .filter((slot): slot is Extract<ChunkSlot, { kind: 'candidate' }> => slot.kind === 'candidate')
      .map((slot) => slot.candidate);

    // Stage 1: single prefetch replacing N per-object skip-checks.
    const existingByObjectId = await this.prefetchExistingObjects(
      db,
      context,
      candidates.map((candidate) => candidate.object.object_id),
    );

    // Partition candidates into unchanged (skip all writes) and changed.
    const unchangedResultByObjectId = new Map<string, SyncItemResult>();
    const changed: PreparedObject[] = [];
    for (const candidate of candidates) {
      const existing = existingByObjectId.get(candidate.object.object_id);
      if (
        existing?.rawObjectHash === candidate.rawObjectHash
        && existing.descriptorHash === candidate.descriptorHash
        && existing.entryId
      ) {
        unchangedResultByObjectId.set(candidate.object.object_id, {
          object_id: candidate.object.object_id,
          status: 'accepted',
          commercial_object_id: existing.commercialObjectId,
          catalog_entry_id: existing.entryId,
          errors: [],
          warnings: [UNCHANGED_OBJECT_WARNING],
          changed: false,
        });
        continue;
      }
      changed.push({ ...candidate, existing: existing ?? null });
    }

    // Stage 2: bulk writes for changed objects.
    const changedResultByObjectId = await this.persistChangedObjects(db, context, changed);

    // Stage 3: reassemble results in input order.
    return slots.map((slot) => {
      if (slot.kind === 'rejected') return slot.result;
      const objectId = slot.candidate.object.object_id;
      return unchangedResultByObjectId.get(objectId)
        ?? changedResultByObjectId.get(objectId)
        ?? {
          object_id: objectId,
          status: 'rejected',
          errors: ['Failed to persist commercial object'],
          warnings: [],
        };
    });
  }

  /**
   * Load existing object/entry metadata for the whole chunk in one query. Mirrors
   * the select shape of the former per-object skip-check but uses an IN list.
   */
  private async prefetchExistingObjects(db: Db, context: SyncContext, objectIds: string[]) {
    const result = new Map<string, {
      commercialObjectId: string;
      rawObjectHash: string;
      descriptorHash: string;
      entryId: string | null;
    }>();
    const uniqueIds = [...new Set(objectIds)];
    if (uniqueIds.length === 0) return result;

    for (const idChunk of chunk(uniqueIds, BULK_WRITE_CHUNK_SIZE)) {
      const rows = await db
        .select({
          objectId: schema.commercialObjects.objectId,
          commercialObjectId: schema.commercialObjects.id,
          rawObjectHash: schema.commercialObjects.rawObjectHash,
          descriptorHash: schema.commercialObjects.descriptorHash,
          entryId: schema.catalogEntries.id,
        })
        .from(schema.commercialObjects)
        .leftJoin(schema.catalogEntries, eq(schema.catalogEntries.commercialObjectId, schema.commercialObjects.id))
        .where(and(
          eq(schema.commercialObjects.catalogId, context.catalogId),
          eq(schema.commercialObjects.providerId, context.providerId),
          inArray(schema.commercialObjects.objectId, idChunk),
        ));
      for (const row of rows) {
        result.set(row.objectId, {
          commercialObjectId: row.commercialObjectId,
          rawObjectHash: row.rawObjectHash,
          descriptorHash: row.descriptorHash,
          entryId: row.entryId,
        });
      }
    }

    return result;
  }

  /**
   * Bulk-upsert commercial_objects, conditionally rewrite descriptors (skipping
   * objects whose descriptorHash is unchanged), and bulk-upsert catalog_entries,
   * then build a SyncItemResult per object. Each result mirrors the field-for-field
   * shape the former per-object path produced, including searchDocumentSnapshot.
   */
  private async persistChangedObjects(
    db: Db,
    context: SyncContext,
    changed: PreparedObject[],
  ): Promise<Map<string, SyncItemResult>> {
    const results = new Map<string, SyncItemResult>();
    if (changed.length === 0) return results;

    // 1. Bulk upsert commercial_objects, capturing the authoritative row id and
    //    updatedAt (which differ from our generated id on a conflict update).
    const commercialObjectByObjectId = new Map<string, { id: string; updatedAt: Date }>();
    for (const group of chunk(changed, BULK_WRITE_CHUNK_SIZE)) {
      const rows = await db
        .insert(schema.commercialObjects)
        .values(group.map((prepared) => ({
          id: newId('cobj'),
          catalogId: context.catalogId,
          providerId: context.providerId,
          objectId: prepared.object.object_id,
          objectType: prepared.object.object_type,
          title: prepared.projection.title,
          summary: prepared.projection.summary ?? prepared.object.summary ?? null,
          status: prepared.object.status,
          sourceUrl: prepared.object.source_url ?? stringValue(prepared.projection.source_url) ?? null,
          rawObject: prepared.object as unknown as Record<string, unknown>,
          rawObjectHash: prepared.rawObjectHash,
          descriptorHash: prepared.descriptorHash,
          updatedAt: new Date(),
        })))
        .onConflictDoUpdate({
          target: [
            schema.commercialObjects.catalogId,
            schema.commercialObjects.providerId,
            schema.commercialObjects.objectId,
          ],
          set: {
            objectType: sql`excluded.object_type`,
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            status: sql`excluded.status`,
            sourceUrl: sql`excluded.source_url`,
            rawObject: sql`excluded.raw_object`,
            rawObjectHash: sql`excluded.raw_object_hash`,
            descriptorHash: sql`excluded.descriptor_hash`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({
          id: schema.commercialObjects.id,
          objectId: schema.commercialObjects.objectId,
          updatedAt: schema.commercialObjects.updatedAt,
        });
      for (const row of rows) {
        commercialObjectByObjectId.set(row.objectId, { id: row.id, updatedAt: row.updatedAt });
      }
    }

    // 2. Descriptors: rewrite only objects whose descriptorHash actually changed.
    //    Hash-unchanged objects skip the delete+insert entirely (a new save over
    //    the previous unconditional rewrite).
    const descriptorRewrites = changed.filter((prepared) => (
      prepared.existing?.descriptorHash !== prepared.descriptorHash
    ));
    const rewriteCommercialObjectIds = descriptorRewrites
      .map((prepared) => commercialObjectByObjectId.get(prepared.object.object_id)?.id)
      .filter((id): id is string => Boolean(id));
    if (rewriteCommercialObjectIds.length > 0) {
      for (const idChunk of chunk(rewriteCommercialObjectIds, BULK_WRITE_CHUNK_SIZE)) {
        await db
          .delete(schema.descriptorInstances)
          .where(inArray(schema.descriptorInstances.commercialObjectId, idChunk));
      }
      const descriptorRows = descriptorRewrites.flatMap((prepared) => {
        const commercialObjectId = commercialObjectByObjectId.get(prepared.object.object_id)?.id;
        if (!commercialObjectId) return [];
        return prepared.object.descriptors.map((descriptor) => ({
          id: newId('desc'),
          commercialObjectId,
          packId: descriptor.pack_id,
          schemaUri: descriptor.schema_uri ?? null,
          payload: descriptor.data,
        }));
      });
      for (const group of chunk(descriptorRows, BULK_WRITE_CHUNK_SIZE)) {
        await db.insert(schema.descriptorInstances).values(group);
      }
    }

    // 3. Bulk upsert catalog_entries, capturing the authoritative entry id.
    const entryIdByCommercialObjectId = new Map<string, string>();
    for (const group of chunk(changed, BULK_WRITE_CHUNK_SIZE)) {
      const values = group
        .map((prepared) => {
          const commercialObjectId = commercialObjectByObjectId.get(prepared.object.object_id)?.id;
          if (!commercialObjectId) return null;
          return {
            id: newId('centry'),
            catalogId: context.catalogId,
            commercialObjectId,
            objectType: prepared.object.object_type,
            providerId: context.providerId,
            objectId: prepared.object.object_id,
            entryStatus: prepared.object.status === 'active' ? ('active' as const) : ('inactive' as const),
            contractMatchStatus: 'matched',
            title: prepared.projection.title,
            summary: stringValue(prepared.projection.summary) ?? prepared.object.summary ?? null,
            brand: stringValue(prepared.projection.brand) ?? null,
            category: stringValue(prepared.projection.category) ?? null,
            currency: stringValue(prepared.projection.currency) ?? null,
            availabilityStatus: stringValue(prepared.projection.availability_status) ?? null,
            searchText: buildSearchText(prepared.projection),
            searchProjection: prepared.projection as unknown as Record<string, unknown>,
            explainProjection: prepared.explainProjection,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);
      if (values.length === 0) continue;
      const rows = await db
        .insert(schema.catalogEntries)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.catalogEntries.commercialObjectId],
          set: {
            objectType: sql`excluded.object_type`,
            providerId: sql`excluded.provider_id`,
            objectId: sql`excluded.object_id`,
            entryStatus: sql`excluded.entry_status`,
            contractMatchStatus: sql`excluded.contract_match_status`,
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            brand: sql`excluded.brand`,
            category: sql`excluded.category`,
            currency: sql`excluded.currency`,
            availabilityStatus: sql`excluded.availability_status`,
            searchText: sql`excluded.search_text`,
            searchProjection: sql`excluded.search_projection`,
            explainProjection: sql`excluded.explain_projection`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          id: schema.catalogEntries.id,
          commercialObjectId: schema.catalogEntries.commercialObjectId,
        });
      for (const row of rows) {
        entryIdByCommercialObjectId.set(row.commercialObjectId, row.id);
      }
    }

    // 4. Assemble per-object results (field-for-field equal to the legacy path).
    for (const prepared of changed) {
      const object = prepared.object;
      const commercialObject = commercialObjectByObjectId.get(object.object_id);
      const entryId = commercialObject
        ? entryIdByCommercialObjectId.get(commercialObject.id)
        : undefined;
      if (!commercialObject || !entryId) {
        results.set(object.object_id, {
          object_id: object.object_id,
          status: 'rejected',
          commercial_object_id: commercialObject?.id,
          errors: [commercialObject ? 'Failed to upsert catalog entry' : 'Failed to upsert commercial object'],
          warnings: [],
        });
        continue;
      }

      const projection = prepared.projection;
      results.set(object.object_id, {
        object_id: object.object_id,
        status: 'accepted',
        commercial_object_id: commercialObject.id,
        catalog_entry_id: entryId,
        errors: [],
        warnings: [],
        changed: true,
        searchDocumentSnapshot: {
          entry_id: entryId,
          catalog_id: context.catalogId,
          commercial_object_id: commercialObject.id,
          object_type: object.object_type,
          provider_id: context.providerId,
          object_id: object.object_id,
          entry_status: object.status === 'active' ? 'active' : 'inactive',
          title: projection.title,
          summary: stringValue(projection.summary) ?? object.summary ?? null,
          brand: stringValue(projection.brand) ?? null,
          category: stringValue(projection.category) ?? null,
          currency: stringValue(projection.currency) ?? null,
          availability_status: stringValue(projection.availability_status) ?? null,
          search_text: buildSearchText(projection),
          projection: projection as unknown as Record<string, unknown>,
          explain_projection: prepared.explainProjection,
          object_status: object.status,
          object_updated_at: commercialObject.updatedAt.toISOString(),
        },
      });
    }

    return results;
  }

  private async assertProviderSyncAllowed(providerId: string) {
    if (!this.config.CATALOG_PROVIDER_THROTTLE_ENABLED) return;
    const [control] = await this.db
      .select()
      .from(schema.providerSyncControls)
      .where(and(
        eq(schema.providerSyncControls.catalogId, this.config.CATALOG_ID),
        eq(schema.providerSyncControls.providerId, providerId),
      ))
      .limit(1);

    const now = new Date();
    if (control?.status === 'paused') {
      throw providerThrottled(providerId, 'provider_sync_paused', {
        pause_reason: control.pauseReason,
      });
    }
    if (control?.cooldownUntil && control.cooldownUntil > now) {
      throw providerThrottled(providerId, 'provider_sync_cooldown', {
        cooldown_until: control.cooldownUntil.toISOString(),
        pause_reason: control.pauseReason,
      });
    }

  }
}

type SyncContext = {
  catalogId: string;
  providerId: string;
  registrationVersion: number;
  scenario: CatalogScenarioModule;
};

type SyncItemResult = ObjectSyncItemResult & {
  changed?: boolean;
  searchDocumentSnapshot?: {
    entry_id: string;
    catalog_id: string;
    commercial_object_id: string;
    object_type: string;
    provider_id: string;
    object_id: string;
    entry_status: 'active' | 'inactive';
    title: string;
    summary: string | null;
    brand: string | null;
    category: string | null;
    currency: string | null;
    availability_status: string | null;
    search_text: string;
    projection: Record<string, unknown>;
    explain_projection: Record<string, unknown>;
    object_status: string;
    object_updated_at: string;
  };
};

type PreparedCandidate = {
  object: CommercialObject;
  projection: SearchProjection;
  explainProjection: Record<string, unknown>;
  rawObjectHash: string;
  descriptorHash: string;
};

type PreparedObject = PreparedCandidate & {
  existing: {
    commercialObjectId: string;
    rawObjectHash: string;
    descriptorHash: string;
    entryId: string | null;
  } | null;
};

type ChunkSlot =
  | { kind: 'rejected'; result: SyncItemResult }
  | { kind: 'candidate'; candidate: PreparedCandidate };

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function toPublicItemResult(item: SyncItemResult): ObjectSyncItemResult {
  return {
    object_id: item.object_id,
    status: item.status,
    commercial_object_id: item.commercial_object_id,
    catalog_entry_id: item.catalog_entry_id,
    errors: item.errors,
    warnings: item.warnings,
  };
}

function providerThrottled(providerId: string, reason: string, details: Record<string, unknown>) {
  return new AppError('rate_limited', `Provider ${providerId} sync is throttled: ${reason}`, 429, {
    provider_id: providerId,
    reason,
    action: 'retry_later',
    retry_after_ms: 60_000,
    ...details,
  });
}

function validateCommercialObject(object: CommercialObject, context: SyncContext) {
  const errors: string[] = [];

  if (object.provider_id !== context.providerId) errors.push('provider_id does not match sync request');

  for (const descriptor of object.descriptors) {
    const payloadSize = JSON.stringify(descriptor.data).length;
    if (payloadSize > MAX_DESCRIPTOR_PAYLOAD_BYTES) {
      errors.push(`Descriptor ${descriptor.pack_id} exceeds ${MAX_DESCRIPTOR_PAYLOAD_BYTES} bytes`);
      continue;
    }

    const packResult = context.scenario.validateDescriptorPack(descriptor.pack_id, descriptor.data);
    if (!packResult.ok) errors.push(...packResult.errors);
  }

  const matchingContracts = context.scenario.objectContracts().filter((contract) => (
    contract.required_fields.every((requirement) => (
      typeof requirement === 'string'
        ? isPresent(readDescriptorField(object, requirement))
        : requirement.some((fieldRef) => isPresent(readDescriptorField(object, fieldRef)))
    ))
  ));

  if (matchingContracts.length === 0) {
    errors.push('Object does not satisfy any published object contract.');
  }

  return errors;
}

function buildDefaultExplainProjection(object: CommercialObject, projection: SearchProjection) {
  return {
    indexed_fields: Object.keys(projection).filter((key) => key !== 'text'),
    descriptor_packs: object.descriptors.map((descriptor) => descriptor.pack_id),
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function buildSearchText(projection: SearchProjection) {
  return [
    stringValue(projection.title),
    stringValue(projection.summary),
    stringValue(projection.brand),
    stringValue(projection.category),
    stringValue(projection.currency),
    stringValue(projection.availability_status),
    stringValue(projection.provider_id),
    stringValue(projection.object_id),
    stringValue(projection.text),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function extractObjectId(input: unknown) {
  if (typeof input === 'object' && input !== null && 'object_id' in input) {
    const value = (input as { object_id?: unknown }).object_id;
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function firstDuplicateObjectId(inputs: unknown[]) {
  const seen = new Set<string>();
  for (const input of inputs) {
    const objectId = extractObjectId(input);
    if (!objectId) continue;
    if (seen.has(objectId)) return objectId;
    seen.add(objectId);
  }
  return null;
}

function sanitizeCommercialObjectStrings(object: CommercialObject): CommercialObject {
  return sanitizeJsonStrings(object) as CommercialObject;
}

function sanitizeJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return removeLoneSurrogates(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonStrings);
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      sanitized[key] = sanitizeJsonStrings(child);
    }
    return sanitized;
  }
  return value;
}

function removeLoneSurrogates(value: string) {
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function elapsedMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function logObjectSyncTiming(
  request: ObjectSyncRequest,
  result: ObjectSyncResult,
  timings: Record<string, number>,
  startedAt: number,
  outcome: 'committed' | 'replayed',
) {
  console.info('[object-sync] timing', {
    catalog_id: request.catalog_id,
    provider_id: request.provider_id,
    batch_id: result.batch_id,
    object_count: request.objects.length,
    accepted_count: result.accepted_count,
    rejected_count: result.rejected_count,
    status: result.status,
    outcome,
    ...timings,
    total_ms: elapsedMs(startedAt),
  });
}

async function hashJson(value: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toDescriptorHashPayload(object: CommercialObject) {
  return object.descriptors
    .map((descriptor) => ({
      pack_id: descriptor.pack_id,
      schema_uri: descriptor.schema_uri ?? null,
      data: descriptor.data,
    }))
    .sort((left, right) => (
      left.pack_id.localeCompare(right.pack_id)
      || String(left.schema_uri ?? '').localeCompare(String(right.schema_uri ?? ''))
    ));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function syncRunStatusFromCounts(acceptedCount: number, rejectedCount: number) {
  if (acceptedCount === 0) return 'rejected';
  return rejectedCount > 0 ? 'partial' : 'accepted';
}
