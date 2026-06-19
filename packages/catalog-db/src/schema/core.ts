import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const registrationStatus = pgEnum('registration_status', [
  'accepted_full',
  'accepted_limited',
  'rejected',
  'pending_verification',
]);

export const entryStatus = pgEnum('entry_status', ['active', 'inactive', 'rejected', 'pending_verification']);

export const providerContractStateStatus = pgEnum('provider_contract_state_status', ['active', 'inactive', 'rejected']);

export const objectSyncChunkStatus = pgEnum('object_sync_chunk_status', ['accepted', 'partial', 'rejected']);

export const objectSyncItemStatus = pgEnum('object_sync_item_status', ['accepted', 'rejected']);

export const objectSyncRunMode = pgEnum('object_sync_run_mode', ['batch', 'stream']);

export const objectSyncRunStatus = pgEnum('object_sync_run_status', ['running', 'accepted', 'partial', 'rejected', 'failed']);

export const catalogOutboxStatus = pgEnum('catalog_outbox_status', ['pending', 'running', 'completed', 'failed']);

export const catalogProfiles = pgTable('catalog_profiles', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  catalogName: text('catalog_name').notNull(),
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogIdUnique: uniqueIndex('catalog_profiles_catalog_id_unique').on(table.catalogId),
}));

export const objectContracts = pgTable('object_contracts', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  contractId: text('contract_id').notNull(),
  objectType: text('object_type').notNull(),
  contract: jsonb('contract').$type<Record<string, unknown>>().notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  contractUnique: uniqueIndex('object_contracts_catalog_contract_unique').on(table.catalogId, table.contractId),
  objectTypeIdx: index('object_contracts_catalog_object_type_idx').on(table.catalogId, table.objectType),
}));

export const providerRegistrations = pgTable('provider_registrations', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  registrationVersion: integer('registration_version').notNull(),
  status: registrationStatus('status').notNull().default('pending_verification'),
  registration: jsonb('registration').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  sourceIp: text('source_ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerVersionUnique: uniqueIndex('provider_registrations_provider_version_unique').on(
    table.catalogId,
    table.providerId,
    table.registrationVersion,
  ),
  providerIdx: index('provider_registrations_provider_idx').on(table.catalogId, table.providerId),
}));

export const providerContractStates = pgTable('provider_contract_states', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  activeRegistrationId: text('active_registration_id')
    .notNull()
    .references(() => providerRegistrations.id, { onDelete: 'restrict' }),
  activeRegistrationVersion: integer('active_registration_version').notNull(),
  status: providerContractStateStatus('status').notNull().default('active'),
  declaredObjectTypes: jsonb('declared_object_types').$type<string[]>().notNull().default([]),
  declaredPacks: jsonb('declared_packs').$type<string[]>().notNull().default([]),
  guaranteedFields: jsonb('guaranteed_fields').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerStateUnique: uniqueIndex('provider_contract_states_provider_unique').on(table.catalogId, table.providerId),
  activeRegistrationIdx: index('provider_contract_states_active_registration_idx').on(table.activeRegistrationId),
}));

export const providerApiKeys = pgTable('provider_api_keys', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  keyHash: text('key_hash').notNull(),
  status: text('status').notNull().default('active'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerUnique: uniqueIndex('provider_api_keys_provider_unique').on(table.catalogId, table.providerId),
  keyHashUnique: uniqueIndex('provider_api_keys_key_hash_unique').on(table.keyHash),
  providerStatusIdx: index('provider_api_keys_provider_status_idx').on(table.catalogId, table.providerId, table.status),
}));

export const commercialObjects = pgTable('commercial_objects', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  objectId: text('object_id').notNull(),
  objectType: text('object_type').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  status: text('status').notNull().default('active'),
  sourceUrl: text('source_url'),
  rawObject: jsonb('raw_object').$type<Record<string, unknown>>().notNull(),
  rawObjectHash: text('raw_object_hash').notNull().default(''),
  descriptorHash: text('descriptor_hash').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectUnique: uniqueIndex('commercial_objects_provider_object_unique').on(table.catalogId, table.providerId, table.objectId),
  typeIdx: index('commercial_objects_catalog_type_idx').on(table.catalogId, table.objectType),
}));

export const providerSyncControls = pgTable('provider_sync_controls', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  status: text('status').notNull().default('active'),
  maxPendingIndexJobs: integer('max_pending_index_jobs'),
  maxRunningIndexJobs: integer('max_running_index_jobs'),
  maxFailedIndexJobs: integer('max_failed_index_jobs'),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  pauseReason: text('pause_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerUnique: uniqueIndex('provider_sync_controls_provider_unique').on(table.catalogId, table.providerId),
  statusCooldownIdx: index('provider_sync_controls_status_cooldown_idx').on(table.catalogId, table.status, table.cooldownUntil),
}));

export const descriptorInstances = pgTable('descriptor_instances', {
  id: text('id').primaryKey(),
  commercialObjectId: text('commercial_object_id')
    .notNull()
    .references(() => commercialObjects.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull(),
  schemaUri: text('schema_uri'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectPackIdx: index('descriptor_instances_object_pack_idx').on(table.commercialObjectId, table.packId),
}));

export const catalogEntries = pgTable('catalog_entries', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  commercialObjectId: text('commercial_object_id')
    .notNull()
    .references(() => commercialObjects.id, { onDelete: 'cascade' }),
  objectType: text('object_type').notNull(),
  providerId: text('provider_id').notNull().default(''),
  objectId: text('object_id').notNull().default(''),
  entryStatus: entryStatus('entry_status').notNull().default('pending_verification'),
  contractMatchStatus: text('contract_match_status').notNull().default('unchecked'),
  title: text('title').notNull().default(''),
  summary: text('summary'),
  brand: text('brand'),
  category: text('category'),
  currency: text('currency'),
  availabilityStatus: text('availability_status'),
  searchText: text('search_text').notNull().default(''),
  searchProjection: jsonb('search_projection').$type<Record<string, unknown>>().notNull().default({}),
  explainProjection: jsonb('explain_projection').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogTypeStatusIdx: index('catalog_entries_catalog_type_status_idx').on(table.catalogId, table.objectType, table.entryStatus),
  providerStatusIdx: index('catalog_entries_catalog_provider_status_idx').on(table.catalogId, table.providerId, table.entryStatus),
  categoryStatusIdx: index('catalog_entries_catalog_category_status_idx').on(table.catalogId, table.category, table.entryStatus),
  brandStatusIdx: index('catalog_entries_catalog_brand_status_idx').on(table.catalogId, table.brand, table.entryStatus),
  availabilityStatusIdx: index('catalog_entries_catalog_availability_status_idx').on(table.catalogId, table.availabilityStatus, table.entryStatus),
  reconcilePageIdx: index('catalog_entries_reconcile_page_idx').on(table.catalogId, table.entryStatus, table.updatedAt, table.id),
  adminUpdatedIdx: index('catalog_entries_admin_updated_idx').on(table.catalogId, table.updatedAt, table.id),
  providerAdminUpdatedIdx: index('catalog_entries_provider_admin_updated_idx').on(table.catalogId, table.providerId, table.updatedAt, table.id),
  commercialObjectUnique: uniqueIndex('catalog_entries_commercial_object_unique').on(table.commercialObjectId),
}));

export const resolvableReferences = pgTable('resolvable_references', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  commercialObjectId: text('commercial_object_id')
    .notNull()
    .references(() => commercialObjects.id, { onDelete: 'cascade' }),
  catalogEntryId: text('catalog_entry_id').references(() => catalogEntries.id, { onDelete: 'set null' }),
  referenceType: text('reference_type').notNull().default('commercial_object'),
  resolvedTitle: text('resolved_title').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const objectSyncRuns = pgTable('object_sync_runs', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  registrationVersion: integer('registration_version').notNull(),
  syncRunId: text('sync_run_id').notNull(),
  runMode: objectSyncRunMode('run_mode').notNull(),
  status: objectSyncRunStatus('status').notNull().default('running'),
  streamBatchId: text('stream_batch_id'),
  batchCount: integer('batch_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  lastBatchId: text('last_batch_id'),
  lastChunkOrdinal: integer('last_chunk_ordinal'),
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>().notNull().default({}),
  requestMetadata: jsonb('request_metadata').$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb('result_summary').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  runUnique: uniqueIndex('object_sync_runs_provider_run_unique').on(table.catalogId, table.providerId, table.syncRunId),
  providerCreatedIdx: index('object_sync_runs_provider_created_idx').on(table.catalogId, table.providerId, table.createdAt),
  statusScheduledIdx: index('object_sync_runs_catalog_status_updated_idx').on(table.catalogId, table.status, table.updatedAt),
}));

export const objectSyncChunks = pgTable('object_sync_chunks', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  registrationVersion: integer('registration_version').notNull(),
  syncRunRowId: text('sync_run_row_id').references(() => objectSyncRuns.id, { onDelete: 'set null' }),
  chunkOrdinal: integer('chunk_ordinal'),
  batchId: text('batch_id').notNull(),
  status: objectSyncChunkStatus('status').notNull().default('rejected'),
  acceptedCount: integer('accepted_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  requestHash: text('request_hash').notNull(),
  requestMetadata: jsonb('request_metadata').$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb('result_summary').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  providerBatchUnique: uniqueIndex('object_sync_chunks_provider_batch_unique').on(table.catalogId, table.providerId, table.batchId),
  providerCreatedIdx: index('object_sync_chunks_provider_created_idx').on(table.catalogId, table.providerId, table.createdAt),
  runChunkUnique: uniqueIndex('object_sync_chunks_run_chunk_unique').on(table.syncRunRowId, table.chunkOrdinal),
  runIdx: index('object_sync_chunks_run_idx').on(table.syncRunRowId),
}));

export const objectSyncItemResults = pgTable('object_sync_item_results', {
  id: text('id').primaryKey(),
  syncChunkId: text('sync_chunk_id')
    .notNull()
    .references(() => objectSyncChunks.id, { onDelete: 'cascade' }),
  itemOrdinal: integer('item_ordinal').notNull().default(0),
  objectId: text('object_id'),
  status: objectSyncItemStatus('status').notNull(),
  commercialObjectId: text('commercial_object_id').references(() => commercialObjects.id, { onDelete: 'set null' }),
  catalogEntryId: text('catalog_entry_id').references(() => catalogEntries.id, { onDelete: 'set null' }),
  errors: jsonb('errors').$type<string[]>().notNull().default([]),
  warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  syncChunkIdx: index('object_sync_item_results_chunk_idx').on(table.syncChunkId),
  syncChunkObjectUnique: uniqueIndex('object_sync_item_results_chunk_object_unique').on(table.syncChunkId, table.objectId),
}));

export const queryAuditRecords = pgTable('query_audit_records', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  queryKind: text('query_kind').notNull(),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>().notNull(),
  resultCount: integer('result_count').notNull().default(0),
  requesterKeyHash: text('requester_key_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogQueryCreatedIdx: index('query_audit_records_catalog_created_idx').on(table.catalogId, table.createdAt),
}));

export const catalogOutboxEvents = pgTable('catalog_outbox_events', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id'),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  status: catalogOutboxStatus('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(10),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupeUnique: uniqueIndex('catalog_outbox_events_catalog_dedupe_unique').on(table.catalogId, table.dedupeKey),
  statusScheduledIdx: index('catalog_outbox_events_catalog_status_scheduled_idx').on(table.catalogId, table.status, table.scheduledAt),
  catalogStatusIdx: index('catalog_outbox_events_catalog_status_idx').on(table.catalogId, table.status),
  pendingClaimIdx: index('catalog_outbox_events_pending_claim_idx')
    .on(table.catalogId, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  staleRunningClaimIdx: index('catalog_outbox_events_stale_running_claim_idx')
    .on(table.catalogId, table.lockedAt, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'running' and ${table.lockedAt} is not null`),
  aggregateIdx: index('catalog_outbox_events_catalog_aggregate_idx').on(table.catalogId, table.aggregateType, table.aggregateId),
  queueTrendCreatedIdx: index('catalog_outbox_events_queue_trend_created_idx')
    .on(table.catalogId, table.createdAt, table.eventType),
  queueTrendFinishedIdx: index('catalog_outbox_events_queue_trend_finished_idx')
    .on(table.catalogId, table.finishedAt, table.status, table.eventType)
    .where(sql`${table.finishedAt} is not null and ${table.status} in ('completed', 'failed')`),
  completedCleanupIdx: index('catalog_outbox_events_completed_cleanup_idx')
    .on(table.catalogId, table.finishedAt, table.id)
    .where(sql`${table.status} = 'completed' and ${table.finishedAt} is not null`),
}));
