CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_catalog_provider_status_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "provider_id", "status");
