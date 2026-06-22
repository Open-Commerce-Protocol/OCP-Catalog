import { sql } from 'drizzle-orm';
import { boolean, customType, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { catalogEntries, commercialObjects } from './core';

const pgVector = customType<{ data: number[] | null; driverData: string | null }>({
  dataType() {
    return 'vector';
  },
  toDriver(value) {
    if (!value || value.length === 0) return null;
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!normalized) return [];
    return normalized.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
  },
});

const pgTsVector = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'tsvector';
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return typeof value === 'string' ? value : null;
  },
});

export const catalogSearchDocumentStatus = pgEnum('catalog_search_document_status', ['pending', 'active', 'inactive', 'stale', 'failed']);

export const catalogSearchIndexJobStatus = pgEnum('catalog_search_index_job_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const catalogSearchIndexJobType = pgEnum('catalog_search_index_job_type', [
  'upsert_document',
  'rebuild_document',
  'delete_document',
  'refresh_embedding',
  'rebuild_all_for_provider',
]);

export const catalogEmbeddingBatchJobStatus = pgEnum('catalog_embedding_batch_job_status', [
  'created',
  'submitted',
  'validating',
  'in_progress',
  'finalizing',
  'completed',
  'failed',
  'expired',
  'cancelled',
  'ingesting',
  'ingested',
]);

export const catalogEmbeddingWorkItemStatus = pgEnum('catalog_embedding_work_item_status', [
  'pending',
  'submitted',
  'completed',
  'failed',
  'cancelled',
]);

export const catalogEmbeddingBatchItemStatus = pgEnum('catalog_embedding_batch_item_status', [
  'submitted',
  'completed',
  'failed',
]);

export const catalogReconcileStatus = pgEnum('catalog_reconcile_status', ['running', 'completed', 'failed']);

export const catalogSearchDocuments = pgTable('catalog_search_documents', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  catalogEntryId: text('catalog_entry_id')
    .notNull()
    .references(() => catalogEntries.id, { onDelete: 'cascade' }),
  commercialObjectId: text('commercial_object_id')
    .notNull()
    .references(() => commercialObjects.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull().default(''),
  objectId: text('object_id').notNull().default(''),
  objectType: text('object_type').notNull(),
  documentStatus: catalogSearchDocumentStatus('document_status').notNull().default('pending'),
  title: text('title').notNull().default(''),
  normalizedTitle: text('normalized_title').notNull().default(''),
  summary: text('summary'),
  brand: text('brand'),
  normalizedBrand: text('normalized_brand').notNull().default(''),
  category: text('category'),
  normalizedCategory: text('normalized_category').notNull().default(''),
  sku: text('sku'),
  normalizedSku: text('normalized_sku').notNull().default(''),
  currency: text('currency'),
  availabilityStatus: text('availability_status'),
  amount: doublePrecision('amount'),
  listAmount: doublePrecision('list_amount'),
  hasImage: boolean('has_image').notNull().default(false),
  hasProductUrl: boolean('has_product_url').notNull().default(false),
  discountPresent: boolean('discount_present').notNull().default(false),
  qualityTier: text('quality_tier'),
  availabilityRank: integer('availability_rank').notNull().default(0),
  qualityRank: integer('quality_rank').notNull().default(0),
  searchText: text('search_text').notNull().default(''),
  searchVector: pgTsVector('search_vector'),
  facetPayload: jsonb('facet_payload').$type<Record<string, unknown>>().notNull().default({}),
  rankingFeatures: jsonb('ranking_features').$type<Record<string, unknown>>().notNull().default({}),
  visibleAttributesPayload: jsonb('visible_attributes_payload').$type<Record<string, unknown>>().notNull().default({}),
  explainPayload: jsonb('explain_payload').$type<Record<string, unknown>>().notNull().default({}),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogEntryUnique: uniqueIndex('catalog_search_documents_catalog_entry_unique').on(table.catalogEntryId),
  catalogStatusIdx: index('catalog_search_documents_catalog_status_idx').on(table.catalogId, table.documentStatus),
  providerStatusIdx: index('catalog_search_documents_catalog_provider_status_idx').on(table.catalogId, table.providerId, table.documentStatus),
  categoryStatusIdx: index('catalog_search_documents_catalog_category_status_idx').on(table.catalogId, table.category, table.documentStatus),
  brandStatusIdx: index('catalog_search_documents_catalog_brand_status_idx').on(table.catalogId, table.brand, table.documentStatus),
  availabilityStatusIdx: index('catalog_search_documents_catalog_availability_status_idx').on(table.catalogId, table.availabilityStatus, table.documentStatus),
  skuStatusIdx: index('catalog_search_documents_catalog_sku_status_idx').on(table.catalogId, table.sku, table.documentStatus),
  currencyStatusIdx: index('catalog_search_documents_catalog_currency_status_idx').on(table.catalogId, table.currency, table.documentStatus),
  amountStatusIdx: index('catalog_search_documents_catalog_amount_status_idx').on(table.catalogId, table.amount, table.documentStatus),
  qualityStatusIdx: index('catalog_search_documents_catalog_quality_status_idx').on(table.catalogId, table.qualityTier, table.documentStatus),
  updatedAtIdx: index('catalog_search_documents_catalog_updated_idx').on(table.catalogId, table.documentStatus, table.updatedAt),
  activeUpdatedIdx: index('catalog_search_documents_active_updated_idx')
    .on(table.catalogId, table.updatedAt, table.id)
    .where(sql`${table.documentStatus} = 'active'`),
  providerActiveUpdatedIdx: index('catalog_search_documents_provider_active_updated_idx')
    .on(table.catalogId, table.providerId, table.updatedAt, table.id)
    .where(sql`${table.documentStatus} = 'active'`),
}));

export const catalogSearchEmbeddings = pgTable('catalog_search_embeddings', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  catalogSearchDocumentId: text('catalog_search_document_id')
    .notNull()
    .references(() => catalogSearchDocuments.id, { onDelete: 'cascade' }),
  embeddingProvider: text('embedding_provider').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDimension: integer('embedding_dimension').notNull(),
  embeddingText: text('embedding_text').notNull(),
  embeddingTextHash: text('embedding_text_hash').notNull(),
  embeddingVector: jsonb('embedding_vector').$type<number[]>().notNull().default([]),
  embeddingVectorPg: pgVector('embedding_vector_pg'),
  status: text('status').notNull().default('ready'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentModelUnique: uniqueIndex('catalog_search_embeddings_document_model_unique').on(table.catalogSearchDocumentId, table.embeddingModel),
  catalogModelStatusIdx: index('catalog_search_embeddings_catalog_model_status_idx').on(table.catalogId, table.embeddingModel, table.status),
  readyDocumentLookupIdx: index('catalog_search_embeddings_ready_document_lookup_idx')
    .on(table.catalogId, table.embeddingModel, table.catalogSearchDocumentId)
    .where(sql`${table.status} = 'ready'`),
}));

export const catalogEmbeddingBatchJobs = pgTable('catalog_embedding_batch_jobs', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  status: catalogEmbeddingBatchJobStatus('status').notNull().default('created'),
  openaiBatchId: text('openai_batch_id'),
  inputFileId: text('input_file_id'),
  outputFileId: text('output_file_id'),
  errorFileId: text('error_file_id'),
  embeddingProvider: text('embedding_provider').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDimension: integer('embedding_dimension').notNull(),
  requestedCount: integer('requested_count').notNull().default(0),
  completedCount: integer('completed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  ingestedCount: integer('ingested_count').notNull().default(0),
  ingestedOutputLineCount: integer('ingested_output_line_count').notNull().default(0),
  inputTextChars: integer('input_text_chars').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogStatusCreatedIdx: index('catalog_embedding_batch_jobs_catalog_status_created_idx').on(table.catalogId, table.status, table.createdAt),
  pollableIdx: index('catalog_embedding_batch_jobs_pollable_idx')
    .on(table.catalogId, table.createdAt, table.id)
    .where(sql`${table.status} in ('submitted','validating','in_progress','finalizing')`),
  completedIngestIdx: index('catalog_embedding_batch_jobs_completed_ingest_idx')
    .on(table.catalogId, table.createdAt, table.id)
    .where(sql`${table.status} = 'completed'`),
  staleIngestingIdx: index('catalog_embedding_batch_jobs_stale_ingesting_idx')
    .on(table.catalogId, table.updatedAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'ingesting'`),
  openaiBatchUnique: uniqueIndex('catalog_embedding_batch_jobs_openai_batch_unique').on(table.openaiBatchId),
}));

export const catalogEmbeddingWorkItems = pgTable('catalog_embedding_work_items', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id'),
  catalogSearchDocumentId: text('catalog_search_document_id').notNull(),
  embeddingProvider: text('embedding_provider').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDimension: integer('embedding_dimension').notNull(),
  status: catalogEmbeddingWorkItemStatus('status').notNull().default('pending'),
  reason: text('reason').notNull(),
  embeddingBatchJobId: text('embedding_batch_job_id'),
  sourceSearchIndexJobId: text('source_search_index_job_id'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  error: text('error'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedDeadlineAt: timestamp('submitted_deadline_at', { withTimezone: true }),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentModelUnique: uniqueIndex('catalog_embedding_work_items_document_model_unique')
    .on(table.catalogId, table.catalogSearchDocumentId, table.embeddingModel),
  pendingScheduledClaimIdx: index('catalog_embedding_work_items_pending_scheduled_claim_idx')
    .on(table.catalogId, table.embeddingModel, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  providerScheduledPendingIdx: index('catalog_embedding_work_items_provider_scheduled_pending_idx')
    .on(table.catalogId, table.providerId, table.embeddingModel, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending' and ${table.providerId} is not null`),
  submittedDeadlineIdx: index('catalog_embedding_work_items_submitted_deadline_idx')
    .on(table.catalogId, table.embeddingModel, table.submittedDeadlineAt, table.id)
    .where(sql`${table.status} = 'submitted'`),
  batchJobIdx: index('catalog_embedding_work_items_batch_job_idx')
    .on(table.catalogId, table.embeddingModel, table.embeddingBatchJobId, table.status),
}));

export const catalogEmbeddingBatchItems = pgTable('catalog_embedding_batch_items', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  embeddingBatchJobId: text('embedding_batch_job_id')
    .notNull()
    .references(() => catalogEmbeddingBatchJobs.id, { onDelete: 'cascade' }),
  embeddingWorkItemId: text('embedding_work_item_id')
    .notNull()
    .references(() => catalogEmbeddingWorkItems.id, { onDelete: 'cascade' }),
  catalogSearchDocumentId: text('catalog_search_document_id').notNull(),
  inputText: text('input_text').notNull(),
  inputTextHash: text('input_text_hash').notNull(),
  inputTextChars: integer('input_text_chars').notNull(),
  status: catalogEmbeddingBatchItemStatus('status').notNull().default('submitted'),
  outputLineNumber: integer('output_line_number'),
  error: text('error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  batchStatusIdx: index('catalog_embedding_batch_items_batch_status_idx')
    .on(table.catalogId, table.embeddingBatchJobId, table.status, table.id),
  batchDocumentUnique: uniqueIndex('catalog_embedding_batch_items_batch_document_unique')
    .on(table.embeddingBatchJobId, table.catalogSearchDocumentId),
}));

export const catalogSearchIndexJobs = pgTable('catalog_search_index_jobs', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id'),
  catalogEntryId: text('catalog_entry_id').references(() => catalogEntries.id, { onDelete: 'set null' }),
  commercialObjectId: text('commercial_object_id').references(() => commercialObjects.id, { onDelete: 'set null' }),
  searchDocumentId: text('search_document_id'),
  dedupeKey: text('dedupe_key'),
  jobType: catalogSearchIndexJobType('job_type').notNull(),
  status: catalogSearchIndexJobStatus('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogStatusScheduledIdx: index('catalog_search_index_jobs_catalog_status_scheduled_idx').on(table.catalogId, table.status, table.scheduledAt),
  catalogTypeStatusIdx: index('catalog_search_index_jobs_catalog_type_status_idx').on(table.catalogId, table.jobType, table.status),
  catalogStatusIdx: index('catalog_search_index_jobs_catalog_status_idx').on(table.catalogId, table.status),
  catalogProviderStatusIdx: index('catalog_search_index_jobs_catalog_provider_status_idx').on(table.catalogId, table.providerId, table.status),
  providerCreatedIdx: index('catalog_search_index_jobs_catalog_provider_created_idx').on(table.catalogId, table.providerId, table.createdAt),
  pendingClaimIdx: index('catalog_search_index_jobs_pending_claim_idx')
    .on(table.catalogId, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  pendingNonEmbeddingClaimIdx: index('catalog_search_index_jobs_pending_non_embedding_claim_idx')
    .on(table.catalogId, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending' and ${table.jobType} <> 'refresh_embedding'`),
  pendingEmbeddingCountIdx: index('catalog_search_index_jobs_pending_embedding_count_idx')
    .on(table.catalogId, table.scheduledAt)
    .where(sql`${table.status} = 'pending' and ${table.jobType} = 'refresh_embedding'`),
  pendingEmbeddingDocumentIdIdx: index('catalog_search_index_jobs_pending_embedding_document_id_idx')
    .on(table.catalogId, table.searchDocumentId)
    .where(sql`${table.status} in ('pending', 'running') and ${table.jobType} = 'refresh_embedding' and ${table.searchDocumentId} is not null`),
  pendingEmbeddingClaimIdx: index('catalog_search_index_jobs_pending_embedding_claim_idx')
    .on(table.catalogId, table.scheduledAt, table.createdAt, table.id)
    .where(sql`${table.status} = 'pending' and ${table.jobType} = 'refresh_embedding' and ${table.searchDocumentId} is not null`),
  dedupeUnique: uniqueIndex('catalog_search_index_jobs_catalog_dedupe_unique').on(table.catalogId, table.dedupeKey),
  queueTrendCreatedIdx: index('catalog_search_index_jobs_queue_trend_created_idx')
    .on(table.catalogId, table.createdAt, table.jobType),
  queueTrendFinishedIdx: index('catalog_search_index_jobs_queue_trend_finished_idx')
    .on(table.catalogId, table.finishedAt, table.status, table.jobType)
    .where(sql`${table.finishedAt} is not null and ${table.status} in ('completed', 'failed', 'cancelled')`),
  completedCleanupIdx: index('catalog_search_index_jobs_completed_cleanup_idx')
    .on(table.catalogId, table.finishedAt, table.id)
    .where(sql`${table.status} = 'completed' and ${table.finishedAt} is not null`),
}));

export const catalogSearchReconcileCheckpoints = pgTable('catalog_search_reconcile_checkpoints', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  reconcileKind: text('reconcile_kind').notNull(),
  status: catalogReconcileStatus('status').notNull().default('running'),
  cursorPayload: jsonb('cursor_payload').$type<Record<string, unknown>>().notNull().default({}),
  scannedEntryCount: integer('scanned_entry_count').notNull().default(0),
  upsertedDocumentCount: integer('upserted_document_count').notNull().default(0),
  enqueuedEmbeddingJobs: integer('enqueued_embedding_jobs').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogKindUnique: uniqueIndex('catalog_search_reconcile_checkpoints_catalog_kind_unique').on(table.catalogId, table.reconcileKind),
  statusUpdatedIdx: index('catalog_search_reconcile_checkpoints_status_updated_idx').on(table.catalogId, table.status, table.updatedAt),
}));

