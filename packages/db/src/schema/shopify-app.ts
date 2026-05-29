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
  accessToken: text('access_token').notNull(),
  scope: text('scope').notNull().default(''),
  apiVersion: text('api_version').notNull().default('2026-04'),
  providerId: text('provider_id').notNull(),
  catalogId: text('catalog_id').notNull(),
  status: text('status').notNull().default('active'),
  activeRegistrationVersion: integer('active_registration_version'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastRun: jsonb('last_run').$type<Record<string, unknown>>().notNull().default({}),
  shopProfile: jsonb('shop_profile').$type<Record<string, unknown>>().notNull().default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  shopDomainUnique: uniqueIndex('shopify_app_installations_shop_domain_unique').on(table.shopDomain),
  statusIdx: index('shopify_app_installations_status_idx').on(table.status),
}));
