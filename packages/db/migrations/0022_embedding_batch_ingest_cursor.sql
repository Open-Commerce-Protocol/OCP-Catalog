ALTER TABLE "catalog_embedding_batch_jobs"
  ADD COLUMN IF NOT EXISTS "ingested_output_line_count" integer NOT NULL DEFAULT 0;

UPDATE "catalog_embedding_batch_jobs"
SET "ingested_output_line_count" = "requested_count"
WHERE "status" = 'ingested'
  AND "ingested_output_line_count" = 0;

UPDATE "catalog_embedding_batch_jobs"
SET "ingested_output_line_count" = LEAST("requested_count", "ingested_count" + "failed_count")
WHERE "status" IN ('completed', 'ingesting')
  AND "ingested_output_line_count" = 0
  AND ("ingested_count" + "failed_count") > 0;
