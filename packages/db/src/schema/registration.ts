import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const registeredCatalogs = pgTable('registered_catalogs', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  activeRegistrationId: text('active_registration_id'),
  activeRegistrationVersion: integer('active_registration_version'),
  activeSnapshotId: text('active_snapshot_id'),
  status: text('status').notNull().default('pending_verification'),
  verificationStatus: text('verification_status').notNull().default('challenge_required'),
  healthStatus: text('health_status').notNull().default('unknown'),
  trustTier: text('trust_tier').notNull().default('unverified'),
  catalogAccessTokenHash: text('catalog_access_token_hash'),
  tokenIssuedAt: timestamp('token_issued_at', { withTimezone: true }),
  homepage: text('homepage').notNull(),
  wellKnownUrl: text('well_known_url').notNull(),
  claimedDomains: jsonb('claimed_domains').$type<string[]>().notNull().default([]),
  operator: jsonb('operator').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  registrationCatalogUnique: uniqueIndex('registered_catalogs_registration_catalog_unique').on(table.registrationId, table.catalogId),
  statusIdx: index('registered_catalogs_status_idx').on(table.registrationId, table.status, table.verificationStatus),
}));

export const catalogRegistrationRecords = pgTable('catalog_registration_records', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  registrationVersion: integer('registration_version').notNull(),
  status: text('status').notNull(),
  registrationPayload: jsonb('registration_payload').$type<Record<string, unknown>>().notNull(),
  resultPayload: jsonb('result_payload').$type<Record<string, unknown>>(),
  sourceIp: text('source_ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogRegistrationVersionUnique: uniqueIndex('catalog_registration_records_version_unique').on(
    table.registrationId,
    table.catalogId,
    table.registrationVersion,
  ),
  catalogRegistrationIdx: index('catalog_registration_records_catalog_idx').on(table.registrationId, table.catalogId),
}));

export const catalogManifestSnapshots = pgTable('catalog_manifest_snapshots', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  catalogRegistrationId: text('catalog_registration_id').notNull(),
  manifestUrl: text('manifest_url').notNull(),
  discoveryPayload: jsonb('discovery_payload').$type<Record<string, unknown>>().notNull(),
  manifestPayload: jsonb('manifest_payload').$type<Record<string, unknown>>().notNull(),
  manifestHash: text('manifest_hash').notNull(),
  supportedObjectTypes: jsonb('supported_object_types').$type<string[]>().notNull().default([]),
  queryCapabilities: jsonb('query_capabilities').$type<Record<string, unknown>[]>().notNull().default([]),
  objectContractSummaries: jsonb('object_contract_summaries').$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogSnapshotIdx: index('catalog_manifest_snapshots_catalog_idx').on(table.registrationId, table.catalogId, table.createdAt),
}));

export const catalogIndexEntries = pgTable('catalog_index_entries', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  activeSnapshotId: text('active_snapshot_id').notNull(),
  entryStatus: text('entry_status').notNull().default('active'),
  catalogName: text('catalog_name').notNull(),
  description: text('description'),
  homepage: text('homepage').notNull(),
  manifestUrl: text('manifest_url').notNull(),
  wellKnownUrl: text('well_known_url').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  domains: jsonb('domains').$type<string[]>().notNull().default([]),
  supportedObjectTypes: jsonb('supported_object_types').$type<string[]>().notNull().default([]),
  supportedQueryModes: jsonb('supported_query_modes').$type<string[]>().notNull().default([]),
  supportedQueryPacks: jsonb('supported_query_packs').$type<string[]>().notNull().default([]),
  supportedQueryLanguages: jsonb('supported_query_languages').$type<string[]>().notNull().default([]),
  contentLanguages: jsonb('content_languages').$type<string[]>().notNull().default([]),
  supportsResolve: integer('supports_resolve').notNull().default(0),
  verificationStatus: text('verification_status').notNull(),
  trustTier: text('trust_tier').notNull(),
  healthStatus: text('health_status').notNull(),
  searchProjection: jsonb('search_projection').$type<Record<string, unknown>>().notNull().default({}),
  explainProjection: jsonb('explain_projection').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  registrationCatalogIndexUnique: uniqueIndex('catalog_index_entries_registration_catalog_unique').on(table.registrationId, table.catalogId),
  catalogIndexStatusIdx: index('catalog_index_entries_status_idx').on(table.registrationId, table.entryStatus, table.verificationStatus),
}));

export const catalogVerificationRecords = pgTable('catalog_verification_records', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  challengeType: text('challenge_type').notNull(),
  challengePayload: jsonb('challenge_payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull(),
  verifiedDomain: text('verified_domain'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogVerificationIdx: index('catalog_verification_records_catalog_idx').on(table.registrationId, table.catalogId),
}));

export const catalogHealthChecks = pgTable('catalog_health_checks', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  checkedUrl: text('checked_url').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  catalogHealthIdx: index('catalog_health_checks_catalog_idx').on(table.registrationId, table.catalogId, table.checkedAt),
}));

export const catalogSearchAuditRecords = pgTable('catalog_search_audit_records', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').notNull(),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>().notNull(),
  resultCount: integer('result_count').notNull().default(0),
  requesterKeyHash: text('requester_key_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  registrationSearchAuditIdx: index('catalog_search_audit_records_registration_created_idx').on(table.registrationId, table.createdAt),
}));
