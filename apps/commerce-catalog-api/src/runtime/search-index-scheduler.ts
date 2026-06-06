import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@ocp-catalog/db';
import type { CommerceCatalogRuntimeContext } from './context';

export function startSearchIndexWorkerScheduler(context: CommerceCatalogRuntimeContext) {
  const { config, searchIndexWorker } = context;
  if (!config.CATALOG_SEARCH_INDEX_WORKER_ENABLED) return null;

  let running = false;

  const runOnce = async (reason: string) => {
    if (running) return;
    running = true;
    const startedAt = performance.now();
    try {
      if (reason === 'startup' && config.CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP) {
        const reconciled = await reconcileSearchIndexQueue(context);
        if (reconciled.upserted_document_count > 0 || reconciled.enqueued_embedding_jobs > 0) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'search_index_reconcile',
            reason,
            ...reconciled,
          }));
        }
      }

      const result = await searchIndexWorker.runBatch({
        catalogId: config.CATALOG_ID,
        limit: config.CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE,
        retryDelayMs: 30_000,
      });
      if (result.claimedCount > 0) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: result.failedCount > 0 ? 'warn' : 'info',
          event: 'search_index_worker_batch',
          reason,
          duration_ms: Number((performance.now() - startedAt).toFixed(2)),
          ...result,
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'search_index_worker_error',
        reason,
        duration_ms: Number((performance.now() - startedAt).toFixed(2)),
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      running = false;
    }
  };

  void runOnce('startup');
  const timer = setInterval(() => {
    void runOnce('interval');
  }, config.CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS * 1000);

  return timer;
}

async function reconcileSearchIndexQueue(context: CommerceCatalogRuntimeContext) {
  const { config, db, searchDocumentService, searchIndexJobs } = context;
  const [entries, documents, embeddings, jobs] = await Promise.all([
    db.select().from(schema.catalogEntries),
    db.select().from(schema.catalogSearchDocuments),
    db.select().from(schema.catalogSearchEmbeddings),
    db.select().from(schema.catalogSearchIndexJobs),
  ]);

  const catalogEntries = entries.filter((row) => row.catalogId === config.CATALOG_ID && row.entryStatus === 'active');
  const activeDocumentByEntryId = new Map(
    documents
      .filter((row) => row.catalogId === config.CATALOG_ID && row.documentStatus === 'active')
      .map((row) => [row.catalogEntryId, row] as const),
  );
  const readyEmbeddingDocumentIds = new Set(
    embeddings
      .filter((row) => row.catalogId === config.CATALOG_ID && row.status === 'ready')
      .map((row) => row.catalogSearchDocumentId),
  );
  const activeJobs = jobs.filter((row) => (
    row.catalogId === config.CATALOG_ID && (row.status === 'pending' || row.status === 'running')
  ));
  const activeEmbeddingJobDocumentIds = new Set(
    activeJobs
      .filter((row) => row.jobType === 'refresh_embedding')
      .map((row) => stringPayload(row.payload, 'search_document_id'))
      .filter((value): value is string => Boolean(value)),
  );

  let upsertedDocuments = 0;
  let enqueuedEmbeddingJobs = 0;
  for (const entry of catalogEntries) {
    const document = activeDocumentByEntryId.get(entry.id);
    if (!document) {
      const upserted = await searchDocumentService.upsertForCatalogEntry(entry.id);
      if (!upserted) continue;
      upsertedDocuments += 1;

      if (upserted.documentStatus === 'active' && !activeEmbeddingJobDocumentIds.has(upserted.documentId)) {
        await searchIndexJobs.enqueueEmbeddingRefresh({
          catalogId: entry.catalogId,
          providerId: entry.providerId,
          catalogEntryId: entry.id,
          commercialObjectId: entry.commercialObjectId,
          payload: {
            reason: 'startup_reconcile_missing_embedding',
            search_document_id: upserted.documentId,
          },
        });
        activeEmbeddingJobDocumentIds.add(upserted.documentId);
        enqueuedEmbeddingJobs += 1;
      }
      continue;
    }

    if (!readyEmbeddingDocumentIds.has(document.id) && !activeEmbeddingJobDocumentIds.has(document.id)) {
      await searchIndexJobs.enqueueEmbeddingRefresh({
        catalogId: document.catalogId,
        providerId: document.providerId,
        catalogEntryId: document.catalogEntryId,
        commercialObjectId: document.commercialObjectId,
        payload: {
          reason: 'startup_reconcile_missing_embedding',
          search_document_id: document.id,
        },
      });
      activeEmbeddingJobDocumentIds.add(document.id);
      enqueuedEmbeddingJobs += 1;
    }
  }

  return {
    active_entry_count: catalogEntries.length,
    active_document_count: activeDocumentByEntryId.size + upsertedDocuments,
    ready_embedding_count: readyEmbeddingDocumentIds.size,
    upserted_document_count: upsertedDocuments,
    enqueued_embedding_jobs: enqueuedEmbeddingJobs,
  };
}

function stringPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
