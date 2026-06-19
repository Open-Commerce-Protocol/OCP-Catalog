# Embedding Work Items Rollout

## Goal

Move embedding backlog ownership from `catalog_search_index_jobs` to `catalog_embedding_work_items`.

The invariant is: every active `catalog_search_documents` row without a ready embedding for the configured model must be discoverable by the bounded reconcile/repair producer. The embedding batch submitter only consumes existing work items; it must not run a full-catalog anti-join.

`catalog_embedding_work_items` and `catalog_embedding_batch_items` are queue/state tables. They intentionally do not keep foreign keys to `catalog_search_documents`; high-volume enqueue and legacy job migration must not take parent-table key-share locks on the hot document table. Document existence is checked explicitly when work is claimed. Claimed items whose search document is missing, inactive, or outside the requested provider scope are marked `failed` with a visible error.

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

The migration script only creates work items for active search documents. Old `refresh_embedding` jobs that reference missing or inactive search documents are marked `failed`; they are not silently cancelled and no orphan work item is created.

## Migration Execution

Do not apply production online index migrations with `drizzle-kit migrate`. Migrations containing `CREATE INDEX CONCURRENTLY` must run outside a transaction. Execute them through `psql`, split on `--> statement-breakpoint`, with explicit timeouts:

```sql
set statement_timeout = '5s';
set lock_timeout = '500ms';
```

For long `CREATE INDEX CONCURRENTLY` statements, raise `statement_timeout` for that statement only after checking the target query with `EXPLAIN`.

## Verification

Avoid exact `count(*)` and `group by` on live backlog tables. Check bounded samples and worker movement instead:

```sql
select status, count(*) as capped_count
from (
  select status
  from catalog_embedding_work_items
  where catalog_id = 'cat_ocp_commerce_prod'
    and status in ('pending', 'submitted')
  order by scheduled_at asc, created_at asc, id asc
  limit 10000
) s
group by status;

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
