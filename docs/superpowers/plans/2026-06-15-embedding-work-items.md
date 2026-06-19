# Embedding Work Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move embedding backlog ownership out of `catalog_search_index_jobs` while preserving the guarantee that active documents missing ready embeddings continue to be embedded.

**Architecture:** `catalog_search_index_jobs` remains the short-lived document indexing queue. A new `catalog_embedding_work_items` table owns embedding backlog per `(catalog_id, search_document_id, embedding_model)`. Reconcile/upsert writes work items; OpenAI batch submitter reads work items and, when needed, discovers active documents missing ready embeddings; a migration script consumes old `refresh_embedding` jobs once and cancels them.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, PostgreSQL, OpenAI Batch embedding flow.

---

### Task 1: Schema And Service Boundary

**Files:**
- Modify: `packages/db/src/schema/catalog.ts`
- Create: `packages/db/migrations/0021_catalog_embedding_work_items.sql`
- Create: `apps/commerce-catalog-api/src/search/indexing/embedding-work-item-service.ts`
- Test: `apps/commerce-catalog-api/src/search-index-job-handler.test.ts`

- [ ] Write failing tests that document upsert/rebuild handlers enqueue embedding work items rather than `refresh_embedding` search index jobs.
- [ ] Add `catalog_embedding_work_item_status` enum and `catalog_embedding_work_items` table.
- [ ] Implement `EmbeddingWorkItemService` with explicit methods for enqueue, enqueueMany, loadPendingDocumentIds, markCompletedByDocumentIds, and seedMissingDocuments.
- [ ] Run targeted tests and typecheck.

### Task 2: Runtime Flow Switch

**Files:**
- Modify: `apps/commerce-catalog-api/src/runtime/context.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/search-index-job-handler.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/reconcile-service.ts`
- Modify: `apps/commerce-catalog-api/src/search/indexing/openai-embedding-batch-backfill.ts`

- [ ] Wire `EmbeddingWorkItemService` into worker runtime.
- [ ] Change document upsert/rebuild and reconcile to enqueue work items.
- [ ] Change OpenAI batch candidate loading to read work items and seed missing active documents from document/embedding truth.
- [ ] Keep explicit `refresh_embedding` job handling only for old queued jobs until migration cleanup is complete; do not use it as the primary backlog source.

### Task 3: Migration And Cleanup

**Files:**
- Create: `scripts/migrate-refresh-embedding-jobs-to-work-items.ts`
- Modify: `docs/operations/search-index-job-search-document-id-rollout.md`

- [ ] Create migration script that inserts work items from old pending/running `refresh_embedding` jobs.
- [ ] Mark migrated old jobs cancelled in bounded batches.
- [ ] Make SQL failure fail loud; no skipped/partial-success reporting.
- [ ] Document production order and rollback.

### Task 4: Verification

**Files:**
- Test files above

- [ ] Run targeted Bun tests.
- [ ] Run `bun run --cwd apps/commerce-catalog-api typecheck`.
- [ ] Run `bun run --cwd packages/db typecheck`.
- [ ] On server, apply migration, run migration script, restart worker/API, verify work items are being consumed and ready embedding count continues increasing.
