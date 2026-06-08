CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_queue_trend_created_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "created_at", "job_type");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_queue_trend_finished_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "finished_at", "status", "job_type")
  WHERE "finished_at" IS NOT NULL AND "status" IN ('completed', 'failed', 'cancelled');
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_queue_trend_created_idx"
  ON "catalog_outbox_events" ("catalog_id", "created_at", "event_type");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_queue_trend_finished_idx"
  ON "catalog_outbox_events" ("catalog_id", "finished_at", "status", "event_type")
  WHERE "finished_at" IS NOT NULL AND "status" IN ('completed', 'failed');
