ALTER TABLE "catalog_embedding_work_items"
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "submitted_deadline_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_error_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_work_items_submitted_deadline_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "embedding_model", "submitted_deadline_at", "id")
  WHERE "status" = 'submitted';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_work_items_pending_scheduled_claim_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "embedding_model", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_work_items_provider_scheduled_pending_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "provider_id", "embedding_model", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending' AND "provider_id" IS NOT NULL;
