import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Per-shop install records for the Shopify Public App (App Store form).
 *
 * One row per myshopify.com shop that has installed the app. The OAuth
 * access token is stored here so the multi-tenant sync worker can pull
 * products for any installed shop. On app/uninstalled (or shop/redact) the
 * row is deleted.
 */
export const shopifyAppInstallations = pgTable('shopify_app_installations', {
  id: text('id').primaryKey(),
  shopDomain: text('shop_domain').notNull(),
  scope: text('scope').notNull().default(''),
  apiVersion: text('api_version').notNull().default('2026-04'),
  providerId: text('provider_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  status: text('status').notNull().default('active'),
  activeRegistrationVersion: integer('active_registration_version'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastRun: jsonb('last_run').$type<Record<string, unknown>>().notNull().default({}),
  shopProfile: jsonb('shop_profile').$type<Record<string, unknown>>().notNull().default({}),
  syncedObjectIds: jsonb('synced_object_ids').$type<string[]>().notNull().default([]),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  shopDomainUnique: uniqueIndex('shopify_app_installations_shop_domain_unique').on(table.shopDomain),
  statusIdx: index('shopify_app_installations_status_idx').on(table.status),
}));

export const shopifyAppTokens = pgTable('shopify_app_tokens', {
  shopDomain: text('shop_domain').primaryKey(),
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  keyId: text('key_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shopifyAppOAuthStates = pgTable('shopify_app_oauth_states', {
  state: text('state').primaryKey(),
  shopDomain: text('shop_domain').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  shopDomainIdx: index('shopify_app_oauth_states_shop_domain_idx').on(table.shopDomain),
  expiresAtIdx: index('shopify_app_oauth_states_expires_at_idx').on(table.expiresAt),
}));

export const shopifyAppWebhookEvents = pgTable('shopify_app_webhook_events', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  shopDomain: text('shop_domain').notNull(),
  topic: text('topic').notNull(),
  status: text('status').notNull().default('queued'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => ({
  webhookIdUnique: uniqueIndex('shopify_app_webhook_events_webhook_id_unique').on(table.webhookId),
  statusIdx: index('shopify_app_webhook_events_status_idx').on(table.status),
  shopTopicIdx: index('shopify_app_webhook_events_shop_topic_idx').on(table.shopDomain, table.topic),
}));

export const shopifyAppSyncJobs = pgTable('shopify_app_sync_jobs', {
  id: text('id').primaryKey(),
  shopDomain: text('shop_domain').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusRunAfterIdx: index('shopify_app_sync_jobs_status_run_after_idx').on(table.status, table.runAfter),
  shopDomainIdx: index('shopify_app_sync_jobs_shop_domain_idx').on(table.shopDomain),
}));
