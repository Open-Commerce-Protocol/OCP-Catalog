import type { AppConfig } from '@ocp-catalog/config';
import { schema, type Db } from '@ocp-catalog/db';
import { AppError } from '@ocp-catalog/shared';
import { and, eq, inArray } from 'drizzle-orm';

export class ProviderLifecycleService {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  async deactivateProvider(providerId: string) {
    const providerWhere = and(
      eq(schema.providerContractStates.catalogId, this.config.CATALOG_ID),
      eq(schema.providerContractStates.providerId, providerId),
    );
    const [state] = await this.db.select().from(schema.providerContractStates).where(providerWhere).limit(1);
    if (!state) throw new AppError('not_found', `Provider ${providerId} is not registered`, 404);

    const now = new Date();
    const [stateRow, objects, entries, documents, jobs] = await Promise.all([
      this.db
        .update(schema.providerContractStates)
        .set({ status: 'inactive', updatedAt: now })
        .where(providerWhere)
        .returning({ id: schema.providerContractStates.id }),
      this.db
        .update(schema.commercialObjects)
        .set({ status: 'inactive', updatedAt: now })
        .where(and(eq(schema.commercialObjects.catalogId, this.config.CATALOG_ID), eq(schema.commercialObjects.providerId, providerId)))
        .returning({ id: schema.commercialObjects.id }),
      this.db
        .update(schema.catalogEntries)
        .set({ entryStatus: 'inactive', updatedAt: now })
        .where(and(eq(schema.catalogEntries.catalogId, this.config.CATALOG_ID), eq(schema.catalogEntries.providerId, providerId)))
        .returning({ id: schema.catalogEntries.id }),
      this.db
        .update(schema.catalogSearchDocuments)
        .set({ documentStatus: 'inactive', updatedAt: now })
        .where(and(eq(schema.catalogSearchDocuments.catalogId, this.config.CATALOG_ID), eq(schema.catalogSearchDocuments.providerId, providerId)))
        .returning({ id: schema.catalogSearchDocuments.id }),
      this.db
        .update(schema.catalogSearchIndexJobs)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(
          eq(schema.catalogSearchIndexJobs.catalogId, this.config.CATALOG_ID),
          eq(schema.catalogSearchIndexJobs.providerId, providerId),
          inArray(schema.catalogSearchIndexJobs.status, ['pending', 'running']),
        ))
        .returning({ id: schema.catalogSearchIndexJobs.id }),
    ]);

    return {
      provider_id: providerId,
      catalog_id: this.config.CATALOG_ID,
      action: 'deactivated',
      provider_state_count: stateRow.length,
      object_count: objects.length,
      entry_count: entries.length,
      search_document_count: documents.length,
      cancelled_search_job_count: jobs.length,
    };
  }

  async eraseProvider(providerId: string) {
    const providerWhere = and(
      eq(schema.providerContractStates.catalogId, this.config.CATALOG_ID),
      eq(schema.providerContractStates.providerId, providerId),
    );
    const [state] = await this.db.select().from(schema.providerContractStates).where(providerWhere).limit(1);
    if (!state) throw new AppError('not_found', `Provider ${providerId} is not registered`, 404);

    const chunks = await this.db
      .delete(schema.objectSyncChunks)
      .where(and(eq(schema.objectSyncChunks.catalogId, this.config.CATALOG_ID), eq(schema.objectSyncChunks.providerId, providerId)))
      .returning({ id: schema.objectSyncChunks.id });
    const jobs = await this.db
      .delete(schema.catalogSearchIndexJobs)
      .where(and(eq(schema.catalogSearchIndexJobs.catalogId, this.config.CATALOG_ID), eq(schema.catalogSearchIndexJobs.providerId, providerId)))
      .returning({ id: schema.catalogSearchIndexJobs.id });
    const objects = await this.db
      .delete(schema.commercialObjects)
      .where(and(eq(schema.commercialObjects.catalogId, this.config.CATALOG_ID), eq(schema.commercialObjects.providerId, providerId)))
      .returning({ id: schema.commercialObjects.id });
    const states = await this.db
      .delete(schema.providerContractStates)
      .where(providerWhere)
      .returning({ id: schema.providerContractStates.id });
    const registrations = await this.db
      .delete(schema.providerRegistrations)
      .where(and(eq(schema.providerRegistrations.catalogId, this.config.CATALOG_ID), eq(schema.providerRegistrations.providerId, providerId)))
      .returning({ id: schema.providerRegistrations.id });

    return {
      provider_id: providerId,
      catalog_id: this.config.CATALOG_ID,
      action: 'erased',
      object_count: objects.length,
      provider_state_count: states.length,
      registration_count: registrations.length,
      sync_chunk_count: chunks.length,
      search_job_count: jobs.length,
    };
  }
}
