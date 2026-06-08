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
import { and, asc, eq, sql } from 'drizzle-orm';
import { isPresent, readDescriptorField } from './field-ref';
import type { CatalogScenarioModule, SearchProjection } from './scenario';
import type { RegistrationService } from './registration-service';

const MAX_DESCRIPTOR_PAYLOAD_BYTES = 64 * 1024;
const MAX_OBJECT_SYNC_BATCH_SIZE = 1_000;
const UNCHANGED_OBJECT_WARNING = 'unchanged_object_hash';

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
    const request = objectSyncRequestSchema.parse(input);
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

    const providerState = await this.registrations.findProviderState(request.provider_id);
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
    const existingResult = await this.findExistingBatchResult({
      catalogId: request.catalog_id,
      providerId: request.provider_id,
      registrationVersion: request.registration_version,
      batchId,
      requestHash,
    });
    if (existingResult) return existingResult;

    await this.assertProviderSyncAllowed(request.provider_id);

    const batchRowId = newId('syncbatch');
    return this.db.transaction(async (tx) => {
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

      const items: SyncItemResult[] = [];
      for (const item of request.objects) {
        const result = await this.syncOne(syncDb, item, {
          catalogId: request.catalog_id,
          providerId: request.provider_id,
          registrationVersion: request.registration_version,
          scenario: this.scenario,
        });
        items.push(result);
      }

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

      await this.insertOutboxEvents(syncDb, result, options);

      return result;
    });
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

  private async insertOutboxEvents(db: Db, result: ObjectSyncResult, options: ObjectSyncOptions) {
    const events: Array<typeof schema.catalogOutboxEvents.$inferInsert> = [];
    if (options.sideEffects?.searchIndexJobs) {
      for (const item of result.items) {
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

  private async syncOne(db: Db, input: unknown, context: SyncContext): Promise<SyncItemResult> {
    const parsed = commercialObjectSchema.safeParse(input);
    if (!parsed.success) {
      return {
        object_id: extractObjectId(input),
        status: 'rejected',
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'object'}: ${issue.message}`),
        warnings: [],
      };
    }

    const object = sanitizeCommercialObjectStrings(parsed.data);
    const errors = validateCommercialObject(object, context);
    if (errors.length > 0) {
      return {
        object_id: object.object_id,
        status: 'rejected',
        errors,
        warnings: [],
      };
    }

    const projection = this.scenario.buildSearchProjection(object);
    const explainProjection = this.scenario.buildExplainProjection?.(object, projection) ?? buildDefaultExplainProjection(object, projection);
    const rawObjectHash = await hashJson(object);
    const descriptorHash = await hashJson(toDescriptorHashPayload(object));
    try {
      const existing = await this.findExistingObjectForSkip(db, context, object.object_id);
      if (
        existing?.rawObjectHash === rawObjectHash
        && existing.descriptorHash === descriptorHash
        && existing.entryId
      ) {
        return {
          object_id: object.object_id,
          status: 'accepted',
          commercial_object_id: existing.commercialObjectId,
          catalog_entry_id: existing.entryId,
          errors: [],
          warnings: [UNCHANGED_OBJECT_WARNING],
          changed: false,
        };
      }

      const [commercialObject] = await db
        .insert(schema.commercialObjects)
        .values({
          id: newId('cobj'),
          catalogId: context.catalogId,
          providerId: context.providerId,
          objectId: object.object_id,
          objectType: object.object_type,
          title: projection.title,
          summary: projection.summary ?? object.summary ?? null,
          status: object.status,
          sourceUrl: object.source_url ?? stringValue(projection.source_url) ?? null,
          rawObject: object as unknown as Record<string, unknown>,
          rawObjectHash,
          descriptorHash,
        })
        .onConflictDoUpdate({
          target: [
            schema.commercialObjects.catalogId,
            schema.commercialObjects.providerId,
            schema.commercialObjects.objectId,
          ],
          set: {
            objectType: object.object_type,
            title: projection.title,
            summary: projection.summary ?? object.summary ?? null,
            status: object.status,
            sourceUrl: object.source_url ?? stringValue(projection.source_url) ?? null,
            rawObject: object as unknown as Record<string, unknown>,
            rawObjectHash,
            descriptorHash,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!commercialObject) {
        return {
          object_id: object.object_id,
          status: 'rejected',
          errors: ['Failed to upsert commercial object'],
          warnings: [],
        };
      }

      await db
        .delete(schema.descriptorInstances)
        .where(eq(schema.descriptorInstances.commercialObjectId, commercialObject.id));

      if (object.descriptors.length > 0) {
        await db.insert(schema.descriptorInstances).values(object.descriptors.map((descriptor) => ({
          id: newId('desc'),
          commercialObjectId: commercialObject.id,
          packId: descriptor.pack_id,
          schemaUri: descriptor.schema_uri ?? null,
          payload: descriptor.data,
        })));
      }

      const [entry] = await db
        .insert(schema.catalogEntries)
        .values({
          id: newId('centry'),
          catalogId: context.catalogId,
          commercialObjectId: commercialObject.id,
          objectType: object.object_type,
          providerId: context.providerId,
          objectId: object.object_id,
          entryStatus: object.status === 'active' ? 'active' : 'inactive',
          contractMatchStatus: 'matched',
          title: projection.title,
          summary: stringValue(projection.summary) ?? object.summary ?? null,
          brand: stringValue(projection.brand) ?? null,
          category: stringValue(projection.category) ?? null,
          currency: stringValue(projection.currency) ?? null,
          availabilityStatus: stringValue(projection.availability_status) ?? null,
          searchText: buildSearchText(projection),
          searchProjection: projection as unknown as Record<string, unknown>,
          explainProjection,
        })
        .onConflictDoUpdate({
          target: [schema.catalogEntries.commercialObjectId],
          set: {
            objectType: object.object_type,
            providerId: context.providerId,
            objectId: object.object_id,
            entryStatus: object.status === 'active' ? 'active' : 'inactive',
            contractMatchStatus: 'matched',
            title: projection.title,
            summary: stringValue(projection.summary) ?? object.summary ?? null,
            brand: stringValue(projection.brand) ?? null,
            category: stringValue(projection.category) ?? null,
            currency: stringValue(projection.currency) ?? null,
            availabilityStatus: stringValue(projection.availability_status) ?? null,
            searchText: buildSearchText(projection),
            searchProjection: projection as unknown as Record<string, unknown>,
            explainProjection,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!entry) {
        return {
          object_id: object.object_id,
          status: 'rejected',
          commercial_object_id: commercialObject.id,
          errors: ['Failed to upsert catalog entry'],
          warnings: [],
        };
      }

      return {
        object_id: object.object_id,
        status: 'accepted',
        commercial_object_id: commercialObject.id,
        catalog_entry_id: entry.id,
        errors: [],
        warnings: [],
        changed: true,
      };
    } catch (error) {
      return {
        object_id: object.object_id,
        status: 'rejected',
        errors: [`Failed to persist commercial object: ${publicErrorMessage(error)}`],
        warnings: [],
      };
    }
  }

  private async findExistingObjectForSkip(db: Db, context: SyncContext, objectId: string) {
    const [row] = await db
      .select({
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
        eq(schema.commercialObjects.objectId, objectId),
      ))
      .limit(1);

    return row ?? null;
  }

  private async assertProviderSyncAllowed(providerId: string) {
    if (!this.config.CATALOG_PROVIDER_THROTTLE_ENABLED) return;
    const [control, backlog] = await Promise.all([
      this.db
        .select()
        .from(schema.providerSyncControls)
        .where(and(
          eq(schema.providerSyncControls.catalogId, this.config.CATALOG_ID),
          eq(schema.providerSyncControls.providerId, providerId),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select({
          pendingCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'pending')::int`,
          runningCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'running')::int`,
          failedCount: sql<number>`count(*) filter (where ${schema.catalogSearchIndexJobs.status} = 'failed')::int`,
        })
        .from(schema.catalogSearchIndexJobs)
        .where(and(
          eq(schema.catalogSearchIndexJobs.catalogId, this.config.CATALOG_ID),
          eq(schema.catalogSearchIndexJobs.providerId, providerId),
        ))
        .then((rows) => rows[0] ?? { pendingCount: 0, runningCount: 0, failedCount: 0 }),
    ]);

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

    const pendingLimit = control?.maxPendingIndexJobs ?? this.config.CATALOG_PROVIDER_THROTTLE_PENDING_JOB_LIMIT;
    const runningLimit = control?.maxRunningIndexJobs ?? this.config.CATALOG_PROVIDER_THROTTLE_RUNNING_JOB_LIMIT;
    const failedLimit = control?.maxFailedIndexJobs ?? this.config.CATALOG_PROVIDER_THROTTLE_FAILED_JOB_LIMIT;
    if (pendingLimit > 0 && backlog.pendingCount >= pendingLimit) {
      throw providerThrottled(providerId, 'provider_pending_index_backlog_limit', {
        pending_index_job_count: backlog.pendingCount,
        pending_index_job_limit: pendingLimit,
      });
    }
    if (runningLimit > 0 && backlog.runningCount >= runningLimit) {
      throw providerThrottled(providerId, 'provider_running_index_backlog_limit', {
        running_index_job_count: backlog.runningCount,
        running_index_job_limit: runningLimit,
      });
    }
    if (failedLimit > 0 && backlog.failedCount >= failedLimit) {
      throw providerThrottled(providerId, 'provider_failed_index_backlog_limit', {
        failed_index_job_count: backlog.failedCount,
        failed_index_job_limit: failedLimit,
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
};

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

function publicErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'unknown persistence error';
  const message = error.message.replace(/\s+/g, ' ').trim();
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
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
