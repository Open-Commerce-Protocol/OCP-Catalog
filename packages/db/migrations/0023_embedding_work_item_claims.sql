ALTER TYPE "catalog_embedding_work_item_status"
  ADD VALUE IF NOT EXISTS 'submitted';
--> statement-breakpoint
ALTER TABLE "catalog_embedding_work_items"
  ADD COLUMN IF NOT EXISTS "embedding_batch_job_id" text,
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_work_items_batch_job_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "embedding_model", "embedding_batch_job_id", "status");
