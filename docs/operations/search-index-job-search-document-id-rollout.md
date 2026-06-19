# Search Index Job `search_document_id` Rollout

This rollout removes hot-path reads of `catalog_search_index_jobs.payload->>'search_document_id'`.

## Production Database

Use the RDS connection supplied by operations:

```bash
PGPASSWORD='<set-from-secure-env>' psql "host=ocp-prod.c7wugsq6szm7.us-east-2.rds.amazonaws.com user=ocp dbname=postgres sslmode=require"
```

Do not paste this password into logs, tickets, or committed files.

## Deployment Order

1. Pull the new code on the server.

```bash
cd ~/workspace/OCP-Catalog
git pull --ff-only
```

2. Apply the schema migration.

```bash
bun run db:migrate
```

3. Backfill `search_document_id` in small batches.

```bash
bun scripts/backfill-search-index-job-search-document-id.ts --batch-size=5000 --max-batches=200
```

4. Restart catalog workers after the column is present and the new code is deployed.

5. Watch queue and database activity.

## Verification

Check malformed/missing column debt with a capped sample:

```sql
SELECT count(*) AS missing_search_document_id_capped_10000
FROM (
  SELECT 1
  FROM catalog_search_index_jobs
  WHERE job_type = 'refresh_embedding'
    AND status IN ('pending', 'running')
    AND payload->>'search_document_id' IS NOT NULL
    AND search_document_id IS NULL
  ORDER BY id
  LIMIT 10000
) s;
```

Check that workers use the new index:

```sql
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname IN (
  'catalog_search_index_jobs_pending_embedding_document_id_idx',
  'catalog_search_index_jobs_pending_embedding_claim_idx'
);
```

Check that no active query still scans the JSON payload hot path:

```sql
SELECT pid, now() - query_start AS age, state, wait_event_type, wait_event, left(query, 500) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
  AND query ILIKE '%payload%search_document_id%'
ORDER BY query_start;
```

Check embedding progress with statistics and newest indexed row. Do not run exact table-wide embedding counts on the hot path.

```sql
SELECT now() AS sampled_at,
       reltuples::bigint AS estimated_embeddings
FROM pg_class
WHERE oid = 'public.catalog_search_embeddings'::regclass;

SELECT updated_at AS newest_embedding_update
FROM catalog_search_embeddings
ORDER BY updated_at DESC
LIMIT 1;
```

## Rollback

Code rollback is safe while `payload.search_document_id` is still written. Do not drop `search_document_id` during rollback. The old expression index is intentionally retained in this phase so old code can still run during a deployment window. The added column and indexes can remain in place until the next deployment.

If the backfill script fails, stop and inspect the emitted error. Do not mark the rollout complete while missing column debt remains.
