CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_entries_reconcile_page_idx"
  ON "catalog_entries" ("catalog_id", "entry_status", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_entries_admin_updated_idx"
  ON "catalog_entries" ("catalog_id", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_entries_provider_admin_updated_idx"
  ON "catalog_entries" ("catalog_id", "provider_id", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_documents_active_updated_idx"
  ON "catalog_search_documents" ("catalog_id", "updated_at", "id")
  WHERE "document_status" = 'active';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_documents_provider_active_updated_idx"
  ON "catalog_search_documents" ("catalog_id", "provider_id", "updated_at", "id")
  WHERE "document_status" = 'active';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_embeddings_ready_document_lookup_idx"
  ON "catalog_search_embeddings" ("catalog_id", "embedding_model", "catalog_search_document_id")
  WHERE "status" = 'ready';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_batch_jobs_pollable_idx"
  ON "catalog_embedding_batch_jobs" ("catalog_id", "created_at", "id")
  WHERE "status" IN ('submitted','validating','in_progress','finalizing');
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_batch_jobs_completed_ingest_idx"
  ON "catalog_embedding_batch_jobs" ("catalog_id", "created_at", "id")
  WHERE "status" = 'completed';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_batch_jobs_stale_ingesting_idx"
  ON "catalog_embedding_batch_jobs" ("catalog_id", "updated_at", "created_at", "id")
  WHERE "status" = 'ingesting';
