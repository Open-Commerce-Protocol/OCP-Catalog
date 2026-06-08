CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_document_idx"
  ON "catalog_search_index_jobs" ("catalog_id", (payload->>'search_document_id'))
  WHERE "status" IN ('pending', 'running') AND "job_type" = 'refresh_embedding';
