import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { catalogSchema as schema } from '@ocp-catalog/catalog-db';
import { newId } from '@ocp-catalog/shared';
import type { CommerceCatalogWorkerRuntimeContext } from '../../runtime/context';

type ReconcileCursor = {
  updatedAt: string;
  id: string;
};

type ReconcileTotals = {
  active_entry_count: number;
  active_document_count: number;
  ready_embedding_count: number;
  scanned_entry_count: number;
  upserted_document_count: number;
  enqueued_embedding_jobs: number;
};

const RECONCILE_KIND = 'catalog_search_index';

export async function reconcileSearchIndexQueue(
  context: CommerceCatalogWorkerRuntimeContext,
  input: {
    pageSize?: number;
  } = {},
) {
  const pageSize = Math.max(1, Math.min(Math.trunc(input.pageSize ?? 500), 1_000));
  await startCheckpoint(context);

  const totals: ReconcileTotals = {
    active_entry_count: 0,
    active_document_count: 0,
    ready_embedding_count: 0,
    scanned_entry_count: 0,
    upserted_document_count: 0,
    enqueued_embedding_jobs: 0,
  };

  let cursor: ReconcileCursor | null = null;
  try {
    while (true) {
      const page = await reconcilePage(context, { cursor, pageSize });
      totals.active_entry_count += page.active_entry_count;
      totals.active_document_count += page.active_document_count;
      totals.ready_embedding_count += page.ready_embedding_count;
      totals.scanned_entry_count += page.scanned_entry_count;
      totals.upserted_document_count += page.upserted_document_count;
      totals.enqueued_embedding_jobs += page.enqueued_embedding_jobs;

      await updateCheckpoint(context, {
        status: page.next_cursor ? 'running' : 'completed',
        cursor: page.next_cursor,
        totals,
      });

      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return totals;
  } catch (error) {
    await failCheckpoint(context, error instanceof Error ? error.message : String(error), totals, cursor);
    throw error;
  }
}

async function reconcilePage(
  context: CommerceCatalogWorkerRuntimeContext,
  input: {
    cursor: ReconcileCursor | null;
    pageSize: number;
  },
) {
  const { config, db, searchDocumentService, embeddingWorkItems } = context;
  const conditions = [
    eq(schema.catalogEntries.catalogId, config.CATALOG_ID),
    eq(schema.catalogEntries.entryStatus, 'active'),
  ];
  if (input.cursor) {
    conditions.push(or(
      gt(schema.catalogEntries.updatedAt, new Date(input.cursor.updatedAt)),
      and(
        eq(schema.catalogEntries.updatedAt, new Date(input.cursor.updatedAt)),
        gt(schema.catalogEntries.id, input.cursor.id),
      ),
    )!);
  }

  const rows = await db
    .select({
      id: schema.catalogEntries.id,
      catalogId: schema.catalogEntries.catalogId,
      providerId: schema.catalogEntries.providerId,
      updatedAt: schema.catalogEntries.updatedAt,
    })
    .from(schema.catalogEntries)
    .where(and(...conditions))
    .orderBy(asc(schema.catalogEntries.updatedAt), asc(schema.catalogEntries.id))
    .limit(input.pageSize + 1);
  const entries = rows.slice(0, input.pageSize);
  const nextEntry = rows[input.pageSize];
  if (entries.length === 0) {
    return emptyPage(null);
  }

  const entryIds = entries.map((entry) => entry.id);
  const documents = await db
    .select({
      id: schema.catalogSearchDocuments.id,
      catalogId: schema.catalogSearchDocuments.catalogId,
      catalogEntryId: schema.catalogSearchDocuments.catalogEntryId,
      providerId: schema.catalogSearchDocuments.providerId,
      documentStatus: schema.catalogSearchDocuments.documentStatus,
    })
    .from(schema.catalogSearchDocuments)
    .where(and(
      eq(schema.catalogSearchDocuments.catalogId, config.CATALOG_ID),
      inArray(schema.catalogSearchDocuments.catalogEntryId, entryIds),
    ));

  const activeDocumentByEntryId = new Map(
    documents
      .filter((row) => row.documentStatus === 'active')
      .map((row) => [row.catalogEntryId, row] as const),
  );
  const documentIds = [...activeDocumentByEntryId.values()].map((row) => row.id);
  const [embeddings, activeEmbeddingWorkItems] = documentIds.length === 0
    ? [[], []]
    : await Promise.all([
        db
          .select({
            catalogSearchDocumentId: schema.catalogSearchEmbeddings.catalogSearchDocumentId,
          })
          .from(schema.catalogSearchEmbeddings)
          .where(and(
            eq(schema.catalogSearchEmbeddings.catalogId, config.CATALOG_ID),
            eq(schema.catalogSearchEmbeddings.status, 'ready'),
            inArray(schema.catalogSearchEmbeddings.catalogSearchDocumentId, documentIds),
          )),
        db
          .select({
            searchDocumentId: schema.catalogEmbeddingWorkItems.catalogSearchDocumentId,
          })
          .from(schema.catalogEmbeddingWorkItems)
          .where(and(
            eq(schema.catalogEmbeddingWorkItems.catalogId, config.CATALOG_ID),
            eq(schema.catalogEmbeddingWorkItems.embeddingModel, config.EMBEDDING_MODEL),
            inArray(schema.catalogEmbeddingWorkItems.status, ['pending', 'submitted'] as const),
            inArray(schema.catalogEmbeddingWorkItems.catalogSearchDocumentId, documentIds),
          )),
      ]);
  const readyEmbeddingDocumentIds = new Set(embeddings.map((row) => row.catalogSearchDocumentId));
  const activeEmbeddingJobDocumentIds = new Set(activeEmbeddingWorkItems.map((row) => row.searchDocumentId).filter(Boolean));

  let upsertedDocuments = 0;
  let enqueuedEmbeddingJobs = 0;
  for (const entry of entries) {
    const document = activeDocumentByEntryId.get(entry.id);
    if (!document) {
      const upserted = await searchDocumentService.upsertForCatalogEntry(entry.id);
      if (!upserted) continue;
      upsertedDocuments += 1;

      if (upserted.documentStatus === 'active' && !activeEmbeddingJobDocumentIds.has(upserted.documentId)) {
        await embeddingWorkItems.enqueuePending({
          catalogId: entry.catalogId,
          providerId: entry.providerId,
          searchDocumentId: upserted.documentId,
          reason: 'reconcile_missing_embedding',
        });
        activeEmbeddingJobDocumentIds.add(upserted.documentId);
        enqueuedEmbeddingJobs += 1;
      }
      continue;
    }

    if (!readyEmbeddingDocumentIds.has(document.id) && !activeEmbeddingJobDocumentIds.has(document.id)) {
      await embeddingWorkItems.enqueuePending({
        catalogId: document.catalogId,
        providerId: document.providerId,
        searchDocumentId: document.id,
        reason: 'reconcile_missing_embedding',
      });
      activeEmbeddingJobDocumentIds.add(document.id);
      enqueuedEmbeddingJobs += 1;
    }
  }

  return {
    active_entry_count: entries.length,
    active_document_count: activeDocumentByEntryId.size + upsertedDocuments,
    ready_embedding_count: readyEmbeddingDocumentIds.size,
    scanned_entry_count: entries.length,
    upserted_document_count: upsertedDocuments,
    enqueued_embedding_jobs: enqueuedEmbeddingJobs,
    next_cursor: nextEntry
      ? {
          updatedAt: entries[entries.length - 1]!.updatedAt.toISOString(),
          id: entries[entries.length - 1]!.id,
        }
      : null,
  };
}

async function startCheckpoint(context: CommerceCatalogWorkerRuntimeContext) {
  const now = new Date();
  await context.db
    .insert(schema.catalogSearchReconcileCheckpoints)
    .values({
      id: newId('reconcile'),
      catalogId: context.config.CATALOG_ID,
      reconcileKind: RECONCILE_KIND,
      status: 'running',
      cursorPayload: {},
      scannedEntryCount: 0,
      upsertedDocumentCount: 0,
      enqueuedEmbeddingJobs: 0,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.catalogSearchReconcileCheckpoints.catalogId,
        schema.catalogSearchReconcileCheckpoints.reconcileKind,
      ],
      set: {
        status: 'running',
        cursorPayload: {},
        scannedEntryCount: 0,
        upsertedDocumentCount: 0,
        enqueuedEmbeddingJobs: 0,
        error: null,
        startedAt: now,
        finishedAt: null,
        updatedAt: now,
      },
    });
}

async function updateCheckpoint(
  context: CommerceCatalogWorkerRuntimeContext,
  input: {
    status: 'running' | 'completed';
    cursor: ReconcileCursor | null;
    totals: ReconcileTotals;
  },
) {
  await context.db
    .update(schema.catalogSearchReconcileCheckpoints)
    .set({
      status: input.status,
      cursorPayload: input.cursor ? { cursor: input.cursor } : {},
      scannedEntryCount: input.totals.scanned_entry_count,
      upsertedDocumentCount: input.totals.upserted_document_count,
      enqueuedEmbeddingJobs: input.totals.enqueued_embedding_jobs,
      finishedAt: input.status === 'completed' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.catalogSearchReconcileCheckpoints.catalogId, context.config.CATALOG_ID),
      eq(schema.catalogSearchReconcileCheckpoints.reconcileKind, RECONCILE_KIND),
    ));
}

async function failCheckpoint(
  context: CommerceCatalogWorkerRuntimeContext,
  error: string,
  totals: ReconcileTotals,
  cursor: ReconcileCursor | null,
) {
  await context.db
    .update(schema.catalogSearchReconcileCheckpoints)
    .set({
      status: 'failed',
      cursorPayload: cursor ? { cursor } : {},
      scannedEntryCount: totals.scanned_entry_count,
      upsertedDocumentCount: totals.upserted_document_count,
      enqueuedEmbeddingJobs: totals.enqueued_embedding_jobs,
      error,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.catalogSearchReconcileCheckpoints.catalogId, context.config.CATALOG_ID),
      eq(schema.catalogSearchReconcileCheckpoints.reconcileKind, RECONCILE_KIND),
    ));
}

function emptyPage(nextCursor: ReconcileCursor | null) {
  return {
    active_entry_count: 0,
    active_document_count: 0,
    ready_embedding_count: 0,
    scanned_entry_count: 0,
    upserted_document_count: 0,
    enqueued_embedding_jobs: 0,
    next_cursor: nextCursor,
  };
}
