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
      });
      const includeEmbeddingRefresh = pendingEmbeddingRefreshCount <= config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT;
      if (!includeEmbeddingRefresh) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'search_index_embedding_refresh_deferred_to_batch',
          reason,
          pending_embedding_refresh_count: pendingEmbeddingRefreshCount,
          realtime_embedding_backlog_limit: config.CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT,
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
