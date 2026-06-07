CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_pending_claim_idx"
  ON "catalog_outbox_events" ("catalog_id", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_outbox_events_stale_running_claim_idx"
  ON "catalog_outbox_events" ("catalog_id", "locked_at", "scheduled_at", "created_at", "id")
  WHERE "status" = 'running' AND "locked_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_claim_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_non_embedding_claim_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending' AND "job_type" <> 'refresh_embedding';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_count_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "scheduled_at")
  WHERE "status" = 'pending' AND "job_type" = 'refresh_embedding';
