# Large Table Queue Fix And Query Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove JSON payload scans from the catalog search-index job hot path, then add a protected internal query service with API-key auth and rate limiting.

**Architecture:** Phase 1 adds explicit relational columns for hot queue fields and rewrites worker/reconcile/batch code to use those columns. Phase 2 introduces a separate Go query service that reads OpenSearch/Postgres through stable API contracts and never exposes database schema directly.

**Tech Stack:** PostgreSQL/RDS, Drizzle schema/migrations, Bun/TypeScript worker code, Go 1.22+ query service, OpenSearch, Redis-compatible rate limiter, OpenAPI.

---

## Scope And Boundaries

This plan intentionally does not split `catalog_search_index_jobs` into active/history tables in the first deployment. The immediate production issue is that hot-path queries use `payload->>'search_document_id'` on a 20M+ row table and the prepared statements are not reliably using the partial expression index. The first production-safe fix is to add real columns, backfill them in batches, build conventional indexes concurrently, and switch code to the columns.

The active/history split is still the long-term architecture target. It should happen after the column migration proves stable and after queue metrics confirm which history fields are still queried.

## Data Impact

This is a database schema change. It adds nullable columns to `catalog_search_index_jobs`:

- `search_document_id text`
- later optional lease columns: `lease_owner text`, `lease_expires_at timestamptz`, `heartbeat_at timestamptz`

No existing data is deleted in Phase 1. Backfill is idempotent and can be rerun. Old `payload.search_document_id` remains for compatibility only until all code paths are switched and verified.

## Task 1: Search Index Job Model Uses Explicit Search Document Id

**Files:**
- Modify: `packages/db/src/schema/catalog.ts`
- Create: `packages/db/migrations/0020_search_index_job_search_document_id.sql`
- Modify: `apps/commerce-catalog-api/src/search/indexing/index-job-service.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/openai-embedding-batch-backfill.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/reconcile-service.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/search-index-job-handler.ts`
- Test: `apps/commerce-catalog-api/src/search-index-job-handler.test.ts`
- Test: new focused tests for `SearchIndexJobService` if practical with existing test helpers

- [ ] **Step 1: Write failing tests for enqueue column extraction**

Add tests that enqueue `refresh_embedding` jobs with `payload.search_document_id` and assert the service insert value exposes `searchDocumentId`. The expected failure before implementation is that the returned job has no `searchDocumentId` property and SQL code still references JSON payload.

- [ ] **Step 2: Add schema and migration**

Add `searchDocumentId: text('search_document_id')` to `catalogSearchIndexJobs`.

Migration SQL:

```sql
ALTER TABLE "catalog_search_index_jobs"
  ADD COLUMN IF NOT EXISTS "search_document_id" text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_document_id_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "search_document_id")
  WHERE "status" IN ('pending', 'running')
    AND "job_type" = 'refresh_embedding'
    AND "search_document_id" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "catalog_search_index_jobs_pending_embedding_claim_idx"
  ON "catalog_search_index_jobs" ("catalog_id", "scheduled_at", "created_at", "id")
  WHERE "status" = 'pending'
    AND "job_type" = 'refresh_embedding'
    AND "search_document_id" IS NOT NULL;
```

- [ ] **Step 3: Populate the new column on new jobs**

Update `toInsertValue()` to derive `searchDocumentId` from `payload.search_document_id` only when the value is a non-empty string. This is not a fallback for reads; it is write-time normalization into the new model.

- [ ] **Step 4: Rewrite hot queries**

Replace these query patterns:

```sql
payload->>'search_document_id'
```

with:

```sql
search_document_id
```

Affected paths:

- `SearchIndexJobService.markPendingEmbeddingRefreshCompleted`
- `OpenAIEmbeddingBatchBackfillService.loadPendingEmbeddingDocumentIds`
- `OpenAIEmbeddingBatchBackfillService.embeddingServiceJobsMarkCompleted`
- `reconcile-service.ts` active embedding job lookup

- [ ] **Step 5: Keep failure loud**

Do not silently fall back to JSON payload reads in production code. If a `refresh_embedding` job does not have `search_document_id`, it must be invisible to the batch path and visible through metrics/check queries as malformed queue debt.

- [ ] **Step 6: Verify**

Run:

```bash
bun run --cwd apps/commerce-catalog-api typecheck
bun test apps/commerce-catalog-api/src/search-index-job-handler.test.ts apps/commerce-catalog-api/src/embedding-provider.test.ts
```

Expected: all pass.

## Task 2: Production Backfill And Online Migration

**Files:**
- Create: `scripts/backfill-search-index-job-search-document-id.ts`
- Create: `docs/operations/search-index-job-search-document-id-rollout.md`

- [ ] **Step 1: Write a batch backfill script**

The script must update rows in small batches:

```sql
WITH rows AS (
  SELECT ctid
  FROM catalog_search_index_jobs
  WHERE job_type = 'refresh_embedding'
    AND status IN ('pending', 'running')
    AND search_document_id IS NULL
    AND payload->>'search_document_id' IS NOT NULL
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE catalog_search_index_jobs jobs
SET search_document_id = jobs.payload->>'search_document_id',
    updated_at = now()
FROM rows
WHERE jobs.ctid = rows.ctid
RETURNING jobs.id;
```

- [ ] **Step 2: Add statement and lock timeouts**

Each batch must use:

```sql
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '500ms';
```

If a batch times out, the script must report failure and stop. It must not mark the migration complete.

- [ ] **Step 3: Add rollout commands**

Document exact production sequence:

```bash
cd ~/workspace/OCP-Catalog
git pull --ff-only
bun run db:migrate
bun scripts/backfill-search-index-job-search-document-id.ts --batch-size 5000 --max-batches 200
```

Verification SQL:

```sql
SELECT count(*) AS missing
FROM catalog_search_index_jobs
WHERE job_type = 'refresh_embedding'
  AND status IN ('pending', 'running')
  AND payload->>'search_document_id' IS NOT NULL
  AND search_document_id IS NULL;

SELECT indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE indexrelname = 'catalog_search_index_jobs_pending_embedding_document_id_idx';
```

## Task 3: Worker Lease Model

**Files:**
- Modify: `packages/db/src/schema/catalog.ts`
- Create: `packages/db/migrations/0021_search_index_job_leases.sql`
- Modify: `apps/commerce-catalog-api/src/search/indexing/index-job-service.ts`

- [ ] **Step 1: Add lease columns**

Add `lease_owner`, `lease_expires_at`, and `heartbeat_at`.

- [ ] **Step 2: Claim using lease semantics**

Claim should set `status='running'`, `lease_owner`, `lease_expires_at`, `heartbeat_at`. Claims must treat expired running jobs as claimable only through an explicit recovery method, not through silent fallback.

- [ ] **Step 3: Add recovery command**

Add a script to mark expired running jobs back to pending or failed with a visible reason.

## Task 4: Query Service Prototype

**Files:**
- Create under: `C:/Users/czykl/Desktop/drafts/ocp-query-service`

Service requirements:

- Go service, not TypeScript, for the data-plane query API.
- API-key auth on every non-health endpoint.
- Rate limiting keyed by API key and client IP.
- OpenAPI spec generated or committed as `openapi.yaml`.
- No direct SQL access for SDK users.
- No public endpoint returns raw internal table shape.

Initial endpoints:

- `GET /healthz`
- `POST /v1/products/search`
- `GET /v1/products/{documentId}`
- `GET /v1/index/status`

Security rules:

- API keys are provided as `Authorization: Bearer <key>` or `x-api-key`.
- Store only SHA-256/HMAC-SHA-256 hashes of keys in config or DB.
- Reject missing/invalid keys with `401`.
- Reject over-quota keys with `429`.
- Include `Retry-After` on rate-limit responses.

Validation:

```bash
go test ./...
go run ./cmd/ocp-query-service
```

Then smoke:

```bash
curl http://localhost:8080/healthz
curl -H "x-api-key: dev_key" http://localhost:8080/v1/index/status
```

## Task 5: SDKs

SDKs are generated from OpenAPI plus small handwritten ergonomic wrappers:

- `sdk/typescript`
- `sdk/python`
- `sdk/go`

Each SDK must support:

- API key injection
- timeout
- retry for `429`, `502`, `503`, `504`
- typed search request/response
- no database concepts

## Production Acceptance

- No active query in `pg_stat_activity` contains `payload->>'search_document_id'`.
- New index has non-zero `idx_scan` after worker traffic.
- Embedding batch progresses through `completed`/`ingesting`/`ingested` without cleanup blocking.
- Ready embedding count increases over repeated samples.
- Query service rejects unauthenticated requests.
- Query service rate-limits abusive request loops.
- SDK smoke tests work against local service.
