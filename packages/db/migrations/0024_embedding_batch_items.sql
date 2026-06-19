CREATE TYPE "catalog_embedding_batch_item_status" AS ENUM ('submitted', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_embedding_batch_items" (
  "id" text PRIMARY KEY,
  "catalog_id" text NOT NULL,
  "embedding_batch_job_id" text NOT NULL REFERENCES "catalog_embedding_batch_jobs" ("id") ON DELETE CASCADE,
  "embedding_work_item_id" text NOT NULL REFERENCES "catalog_embedding_work_items" ("id") ON DELETE CASCADE,
  "catalog_search_document_id" text NOT NULL,
  "input_text" text NOT NULL,
  "input_text_hash" text NOT NULL,
  "input_text_chars" integer NOT NULL,
  "status" "catalog_embedding_batch_item_status" NOT NULL DEFAULT 'submitted',
  "output_line_number" integer,
  "error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_batch_items_batch_status_idx"
  ON "catalog_embedding_batch_items" ("catalog_id", "embedding_batch_job_id", "status", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "catalog_embedding_batch_items_batch_document_unique"
  ON "catalog_embedding_batch_items" ("embedding_batch_job_id", "catalog_search_document_id");
