CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_completed_cleanup_idx"
  ON "catalog_outbox_events" ("catalog_id", "finished_at", "id")
  WHERE "status" = 'completed' AND "finished_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_completed_cleanup_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "finished_at", "id")
  WHERE "status" = 'completed' AND "finished_at" IS NOT NULL;
