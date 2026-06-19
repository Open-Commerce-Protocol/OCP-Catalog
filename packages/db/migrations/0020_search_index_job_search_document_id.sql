ALTER TABLE "catalog_search_index_jobs"
  ADD COLUMN IF NOT EXISTS "search_document_id" text;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_document_id_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "search_document_id")
  WHERE "status" IN ('pending', 'running')
    AND "job_type" = 'refresh_embedding'
    AND "search_document_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_claim_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending'
    AND "job_type" = 'refresh_embedding'
    AND "search_document_id" IS NOT NULL;
