CREATE TYPE "catalog_embedding_work_item_status" AS ENUM ('pending', 'completed', 'failed', 'cancelled');

CREATE TABLE IF NOT EXISTS "catalog_embedding_work_items" (
  "id" text PRIMARY KEY,
  "catalog_id" text NOT NULL,
  "provider_id" text,
  "catalog_search_document_id" text NOT NULL REFERENCES "catalog_search_documents" ("id") ON DELETE CASCADE,
  "embedding_provider" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimension" integer NOT NULL,
  "status" "catalog_embedding_work_item_status" NOT NULL DEFAULT 'pending',
  "reason" text NOT NULL,
  "source_search_index_job_id" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_embedding_work_items_document_model_unique"
  ON "catalog_embedding_work_items" ("catalog_id", "catalog_search_document_id", "embedding_model");

CREATE INDEX IF NOT EXISTS "catalog_embedding_work_items_pending_claim_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "embedding_model", "status", "created_at", "id");

CREATE INDEX IF NOT EXISTS "catalog_embedding_work_items_provider_pending_idx"
  ON "catalog_embedding_work_items" ("catalog_id", "provider_id", "embedding_model", "status");
