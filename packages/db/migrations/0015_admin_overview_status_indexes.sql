CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_catalog_status_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "status");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_catalog_status_idx"
  ON "catalog_outbox_events" ("catalog_id", "status");
