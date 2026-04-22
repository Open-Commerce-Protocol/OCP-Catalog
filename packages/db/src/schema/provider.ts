import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const providerProducts = pgTable('provider_products', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  sku: text('sku').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  brand: text('brand').notNull(),
  category: text('category').notNull(),
  productUrl: text('product_url').notNull(),
  imageUrls: jsonb('image_urls').$type<string[]>().notNull().default([]),
  currency: text('currency').notNull(),
  amount: integer('amount_cents').notNull(),
  listAmount: integer('list_amount_cents'),
  priceType: text('price_type').notNull().default('fixed'),
  availabilityStatus: text('availability_status').notNull(),
  quantity: integer('quantity').notNull().default(0),
  status: text('status').notNull().default('active'),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerSkuUnique: uniqueIndex('provider_products_provider_sku_unique').on(table.providerId, table.sku),
  providerStatusIdx: index('provider_products_provider_status_idx').on(table.providerId, table.status),
}));

export const providerSyncRuns = pgTable('provider_sync_runs', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  runType: text('run_type').notNull(),
  targetProductId: text('target_product_id'),
  registrationVersion: integer('registration_version'),
  status: text('status').notNull(),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>(),
  resultPayload: jsonb('result_payload').$type<Record<string, unknown>>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  providerSyncRunsProviderCreatedIdx: index('provider_sync_runs_provider_created_idx').on(table.providerId, table.createdAt),
}));
