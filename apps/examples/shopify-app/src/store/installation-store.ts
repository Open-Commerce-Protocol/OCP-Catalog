/**
 * Postgres-backed per-shop installation store (drizzle). One row per installed
 * myshopify shop, holding the OAuth access token + sync cursor + last run.
 */
import { schema, type Db } from '@ocp-catalog/db';
import { eq } from 'drizzle-orm';
import { providerIdForShop } from '../mapper/product-to-commercial-object';

export type InstallationRow = typeof schema.shopifyAppInstallations.$inferSelect;

export interface LastRun {
  type: 'install' | 'register' | 'sync_full' | 'sync_delta' | 'sync_one' | 'webhook' | 'uninstall' | null;
  status: 'succeeded' | 'failed' | 'partial' | null;
  at: string | null;
  objects_synced: number;
  error?: string | null;
}

function newId(): string {
  return `inst_${crypto.randomUUID().replace(/-/g, '')}`;
}

export class InstallationStore {
  constructor(
    private readonly db: Db,
    private readonly catalogId: string,
    private readonly defaultApiVersion: string,
  ) {}

  async get(shopDomain: string): Promise<InstallationRow | null> {
    const rows = await this.db
      .select()
      .from(schema.shopifyAppInstallations)
      .where(eq(schema.shopifyAppInstallations.shopDomain, shopDomain))
      .limit(1);
    return rows[0] ?? null;
  }

  async listActive(): Promise<InstallationRow[]> {
    return this.db
      .select()
      .from(schema.shopifyAppInstallations)
      .where(eq(schema.shopifyAppInstallations.status, 'active'));
  }

  /** Upsert on install/re-install: stores token, marks active, clears uninstall. */
  async upsertInstall(input: {
    shopDomain: string;
    accessToken: string;
    scope: string;
    apiVersion?: string;
    shopProfile?: Record<string, unknown>;
  }): Promise<InstallationRow> {
    const existing = await this.get(input.shopDomain);
    const providerId = providerIdForShop(input.shopDomain);
    const now = new Date();
    if (existing) {
      const [row] = await this.db
        .update(schema.shopifyAppInstallations)
        .set({
          accessToken: input.accessToken,
          scope: input.scope,
          apiVersion: input.apiVersion ?? existing.apiVersion,
          status: 'active',
          uninstalledAt: null,
          shopProfile: input.shopProfile ?? existing.shopProfile,
          installedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.shopifyAppInstallations.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(schema.shopifyAppInstallations)
      .values({
        id: newId(),
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        scope: input.scope,
        apiVersion: input.apiVersion ?? this.defaultApiVersion,
        providerId,
        catalogId: this.catalogId,
        status: 'active',
        shopProfile: input.shopProfile ?? {},
      })
      .returning();
    return row;
  }

  async setRegistrationVersion(shopDomain: string, version: number): Promise<void> {
    await this.db
      .update(schema.shopifyAppInstallations)
      .set({ activeRegistrationVersion: version, updatedAt: new Date() })
      .where(eq(schema.shopifyAppInstallations.shopDomain, shopDomain));
  }

  async recordRun(shopDomain: string, run: LastRun, opts: { advanceCursorTo?: string | null } = {}): Promise<void> {
    const set: Partial<InstallationRow> = { lastRun: { ...run } as Record<string, unknown>, updatedAt: new Date() };
    if (opts.advanceCursorTo) set.lastSyncedAt = new Date(opts.advanceCursorTo);
    await this.db
      .update(schema.shopifyAppInstallations)
      .set(set)
      .where(eq(schema.shopifyAppInstallations.shopDomain, shopDomain));
  }

  /** On app/uninstalled or shop/redact: wipe the token, mark uninstalled. */
  async markUninstalled(shopDomain: string): Promise<void> {
    await this.db
      .update(schema.shopifyAppInstallations)
      .set({ status: 'uninstalled', accessToken: '', uninstalledAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.shopifyAppInstallations.shopDomain, shopDomain));
  }

  /** Hard-delete (shop/redact GDPR erase). */
  async hardDelete(shopDomain: string): Promise<void> {
    await this.db
      .delete(schema.shopifyAppInstallations)
      .where(eq(schema.shopifyAppInstallations.shopDomain, shopDomain));
  }
}
