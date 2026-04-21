import { customType, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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

export const registrationStatus = pgEnum('registration_status', [
  'accepted_full',
  'accepted_limited',
  'rejected',
  'pending_verification',
]);

export const entryStatus = pgEnum('entry_status', ['active', 'inactive', 'rejected', 'pending_verification']);

export const providerContractStateStatus = pgEnum('provider_contract_state_status', ['active', 'inactive', 'rejected']);

export const objectSyncBatchStatus = pgEnum('object_sync_batch_status', ['accepted', 'partial', 'rejected']);

export const objectSyncItemStatus = pgEnum('object_sync_item_status', ['accepted', 'rejected']);

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectUnique: uniqueIndex('commercial_objects_provider_object_unique').on(table.catalogId, table.providerId, table.objectId),
  typeIdx: index('commercial_objects_catalog_type_idx').on(table.catalogId, table.objectType),
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
  commercialObjectUnique: uniqueIndex('catalog_entries_commercial_object_unique').on(table.commercialObjectId),
}));

export const catalogEntryEmbeddings = pgTable('catalog_entry_embeddings', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  catalogEntryId: text('catalog_entry_id')
    .notNull()
    .references(() => catalogEntries.id, { onDelete: 'cascade' }),
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
  entryModelUnique: uniqueIndex('catalog_entry_embeddings_entry_model_unique').on(table.catalogEntryId, table.embeddingModel),
  catalogModelStatusIdx: index('catalog_entry_embeddings_catalog_model_status_idx').on(table.catalogId, table.embeddingModel, table.status),
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

export const objectSyncBatches = pgTable('object_sync_batches', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull(),
  providerId: text('provider_id').notNull(),
  registrationVersion: integer('registration_version').notNull(),
  batchId: text('batch_id').notNull(),
  status: objectSyncBatchStatus('status').notNull().default('rejected'),
  acceptedCount: integer('accepted_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>().notNull(),
  resultPayload: jsonb('result_payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  providerBatchUnique: uniqueIndex('object_sync_batches_provider_batch_unique').on(table.catalogId, table.providerId, table.batchId),
  providerCreatedIdx: index('object_sync_batches_provider_created_idx').on(table.catalogId, table.providerId, table.createdAt),
}));

export const objectSyncItemResults = pgTable('object_sync_item_results', {
  id: text('id').primaryKey(),
  syncBatchId: text('sync_batch_id')
    .notNull()
    .references(() => objectSyncBatches.id, { onDelete: 'cascade' }),
  objectId: text('object_id'),
  status: objectSyncItemStatus('status').notNull(),
  commercialObjectId: text('commercial_object_id').references(() => commercialObjects.id, { onDelete: 'set null' }),
  catalogEntryId: text('catalog_entry_id').references(() => catalogEntries.id, { onDelete: 'set null' }),
  errors: jsonb('errors').$type<string[]>().notNull().default([]),
  warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  syncBatchIdx: index('object_sync_item_results_batch_idx').on(table.syncBatchId),
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
