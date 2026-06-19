# Embedding Work Items Rollout

## Goal

Move embedding backlog ownership from `catalog_search_index_jobs` to `catalog_embedding_work_items`.

The invariant is: every active `catalog_search_documents` row without a ready embedding for the configured model must be discoverable by the embedding batch submitter.

## Production State

Long-running migration service:

```bash
systemctl status ocp-refresh-embedding-job-migration.service
sudo journalctl -u ocp-refresh-embedding-job-migration.service -f
```

The first migration mode handles old jobs where `search_document_id` is still null and the document id is only in JSON payload:

```bash
cd ~/workspace/OCP-Catalog
bun scripts/migrate-refresh-embedding-jobs-to-work-items.ts \
  --max-batches=50000 \
  --batch-size=500 \
  --statement-timeout=30s \
  --lock-timeout=500ms \
  --mode=payload-null-column \
  --batch-delay-ms=2000
```

## Verification

```sql
select status, count(*)::bigint
from catalog_embedding_work_items
where catalog_id = 'cat_ocp_commerce_prod'
group by status
order by status;

select id, status, requested_count, completed_count, failed_count, ingested_count, submitted_at, updated_at
from catalog_embedding_batch_jobs
where catalog_id = 'cat_ocp_commerce_prod'
  and status in ('submitted','validating','in_progress','finalizing','completed','ingesting')
order by updated_at asc
limit 10;
```

Old job cleanup progress should be checked in capped samples to avoid heavy counts:

```sql
select count(*) as old_refresh_pending_capped_10000
from (
  select 1
  from catalog_search_index_jobs
  where catalog_id = 'cat_ocp_commerce_prod'
    and job_type = 'refresh_embedding'
    and status in ('pending', 'running')
  limit 10000
) s;
```

## Cleanup Conditions

Only after old `refresh_embedding` pending/running jobs are drained:

1. Run the migration script in `--mode=materialized-column` for any old jobs that already have `search_document_id`.
2. Drop temporary migration indexes created for old job cleanup.
3. Remove the legacy `refresh_embedding` handler path from `SearchIndexJobHandlerService`.
4. Drop obsolete `catalog_search_index_jobs` embedding-specific indexes if no query uses them.

Do not remove the legacy path before the old job table has been drained or explicitly cancelled.
