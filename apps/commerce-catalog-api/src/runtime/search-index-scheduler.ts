import type { CommerceCatalogWorkerRuntimeContext } from './context';
import { reconcileSearchIndexQueue } from '../search/indexing/reconcile-service';

export function startSearchIndexWorkerScheduler(context: CommerceCatalogWorkerRuntimeContext) {
  const { config, searchIndexWorker } = context;
  if (!config.CATALOG_SEARCH_INDEX_WORKER_ENABLED) return null;

  let running = false;

  const runOnce = async (reason: string) => {
    if (running) return;
    running = true;
    const startedAt = performance.now();
    try {
      if (reason === 'startup' && config.CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP) {
        const lockName = `ocp:catalog:${config.CATALOG_ID}:search-index-reconcile`;
        const reconcileResult = await context.coordination.withLock(lockName, () => reconcileSearchIndexQueue(context));
        if (!reconcileResult.acquired) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            event: 'search_index_reconcile_skipped',
            reason,
            lock_name: lockName,
          }));
        } else {
          const reconciled = reconcileResult.value;
          if (reconciled.upserted_document_count > 0 || reconciled.enqueued_embedding_jobs > 0) {
            console.log(JSON.stringify({
              ts: new Date().toISOString(),
              level: 'info',
              event: 'search_index_reconcile',
              reason,
              lock_name: lockName,
              ...reconciled,
            }));
          }
        }
      }

      const outbox = await context.catalogOutbox.drain({
        catalogId: config.CATALOG_ID,
        limit: config.CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE,
        retryDelayMs: config.CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS,
      });
      if (outbox.claimed_count > 0) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: outbox.failed_count > 0 ? 'warn' : 'info',
          event: 'catalog_outbox_drain',
          reason,
          ...outbox,
        }));
      }

      const pendingEmbeddingRefreshCount = await context.searchIndexJobs.countPendingEmbeddingRefresh({
        catalogId: config.CATALOG_ID,
        maxCount: config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT + 1,
      });
      const includeEmbeddingRefresh = !config.CATALOG_EMBEDDING_BATCH_WORKER_ENABLED
        || pendingEmbeddingRefreshCount <= config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT;
      if (!includeEmbeddingRefresh) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'search_index_embedding_refresh_deferred_to_batch',
          reason,
          pending_embedding_refresh_count_at_least: pendingEmbeddingRefreshCount,
          realtime_embedding_backlog_limit: config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT,
        }));
      } else if (!config.CATALOG_EMBEDDING_BATCH_WORKER_ENABLED && pendingEmbeddingRefreshCount > config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT) {
        console.warn(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'search_index_embedding_refresh_backlog_processed_realtime',
          reason,
          pending_embedding_refresh_count_at_least: pendingEmbeddingRefreshCount,
          realtime_embedding_backlog_limit: config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT,
          hint: 'Enable CATALOG_EMBEDDING_BATCH_WORKER_ENABLED for large embedding backlogs.',
        }));
      }

      const result = await searchIndexWorker.runBatch({
        catalogId: config.CATALOG_ID,
        limit: config.CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE,
        includeEmbeddingRefresh,
        retryDelayMs: config.CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS,
        retryMaxDelayMs: config.CATALOG_SEARCH_INDEX_RETRY_MAX_DELAY_MS,
        retryJitterRatio: config.CATALOG_SEARCH_INDEX_RETRY_JITTER_RATIO,
        jobDelayMs: config.CATALOG_SEARCH_INDEX_WORKER_JOB_DELAY_MS,
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

      if (config.CATALOG_EMBEDDING_BATCH_WORKER_ENABLED) {
        await runEmbeddingBatchWorker(context, reason);
      }

      if (config.CATALOG_QUEUE_CLEANUP_ENABLED) {
        await cleanupCompletedQueues(context, reason);
      }
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'search_index_worker_fatal_error',
        reason,
        duration_ms: Number((performance.now() - startedAt).toFixed(2)),
        error: error instanceof Error ? error.message : String(error),
      }));
      setImmediate(() => {
        throw error;
      });
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

async function runEmbeddingBatchWorker(context: CommerceCatalogWorkerRuntimeContext, reason: string) {
  const { config, embeddingBatchBackfill } = context;
  const lockName = `ocp:catalog:${config.CATALOG_ID}:embedding-batch-worker`;
  const result = await context.coordination.withLock(lockName, async () => {
    const polled = await embeddingBatchBackfill.poll();
    const ingested = await embeddingBatchBackfill.ingest({
      limit: config.CATALOG_EMBEDDING_BATCH_WORKER_INGEST_LIMIT,
    });
    const activeCount = await embeddingBatchBackfill.countActiveJobs();
    const submitted = activeCount >= config.CATALOG_EMBEDDING_BATCH_MAX_ACTIVE_JOBS
      ? { status: 'skipped_active_limit' as const, activeCount }
      : await embeddingBatchBackfill.submit({
        limit: config.CATALOG_EMBEDDING_BATCH_WORKER_SUBMIT_LIMIT,
      });
    return { polled, ingested, submitted };
  });

  if (!result.acquired) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'embedding_batch_worker_tick',
    reason,
    lock_name: lockName,
    polled_count: result.value.polled.length,
    ingested_count: result.value.ingested.reduce((sum, item) => sum + item.ingestedCount, 0),
    failed_count: result.value.ingested.reduce((sum, item) => sum + item.failedCount, 0),
    submitted_status: result.value.submitted.status,
  }));
}

async function cleanupCompletedQueues(context: CommerceCatalogWorkerRuntimeContext, reason: string) {
  const { config } = context;
  const olderThan = new Date(Date.now() - config.CATALOG_QUEUE_COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const lockName = `ocp:catalog:${config.CATALOG_ID}:queue-cleanup`;
  const result = await context.coordination.withLock(lockName, async () => {
    const outboxDeleted = await context.catalogOutbox.cleanupCompleted({
      catalogId: config.CATALOG_ID,
      olderThan,
      limit: config.CATALOG_QUEUE_CLEANUP_BATCH_SIZE,
    });
    const searchJobsDeleted = await context.searchIndexJobs.cleanupCompleted({
      catalogId: config.CATALOG_ID,
      olderThan,
      limit: config.CATALOG_QUEUE_CLEANUP_BATCH_SIZE,
    });
    return { outboxDeleted, searchJobsDeleted };
  });

  if (!result.acquired || (result.value.outboxDeleted === 0 && result.value.searchJobsDeleted === 0)) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'catalog_queue_cleanup',
    reason,
    lock_name: lockName,
    completed_retention_days: config.CATALOG_QUEUE_COMPLETED_RETENTION_DAYS,
    outbox_deleted_count: result.value.outboxDeleted,
    search_jobs_deleted_count: result.value.searchJobsDeleted,
  }));
}
