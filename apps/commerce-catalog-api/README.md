# Commerce Catalog API

Production-oriented OCP commerce catalog runtime.

This app is the runtime boundary for a large product catalog. It owns HTTP
surfaces, commerce-specific projection rules, query planning, indexing workers,
admin endpoints, and deployment-time wiring. Shared protocol semantics remain in
`packages/*`.

## Stack Decision

The runtime keeps Bun + Elysia.

- Bun is still a good fit for this service because the app is TypeScript-first,
  has lightweight startup, simple worker processes, and uses Bun-native test and
  build workflows already across the repo.
- Elysia remains appropriate for the HTTP shell because the API surface is small,
  schema validation lives in Zod/protocol packages, and the service does not need
  a heavier framework lifecycle.
- PostgreSQL / RDS is the fact store and structured/full-text retrieval plane.
- Vector recall must be treated as a separate index plane for production scale.
  The current local embedding path is a development and integration surface, not
  the long-term 30M-product vector architecture.

Do not make Elysia route handlers own database policy, indexing policy, or
provider lifecycle policy. Route handlers should delegate to app services.

## Target Architecture

```text
Provider / Import Feed
  -> ingestion service
  -> CommercialObject fact store in RDS
  -> CatalogEntry projection
  -> search document and full-text indexes
  -> embedding/index jobs
  -> dedicated worker process writes vector index
  -> API query process reads RDS and vector index
  -> query planner merges keyword/filter/vector candidates
  -> resolve returns catalog_cached, provider_api, or source_url detail
```

## Source Layout

Current structure:

```text
src/
  index.ts                         HTTP API process entrypoint
  worker.ts                        search indexing worker process entrypoint
  http/
    app.ts                         Elysia app factory
  runtime/
    context.ts                     separate API and worker dependency factories
    search-index-scheduler.ts      worker scheduling and startup reconcile hook
  commerce-scenario.ts             object contract, projection, resolve policy
  embedding-provider.ts            local/OpenAI-compatible embedding provider
  query/
    commerce-query-planner.ts      query pack and mode selection
    commerce-query-service.ts      structured/full-text/vector candidate merge
    query-mode.ts                  mode inference
  search/
    indexing/                      document, embedding, and job workers
    retrieval/                     semantic retrieval adapter
  test/
    integration-db.ts              integration database guard
```

Near-term production structure:

```text
src/
  http/
    app.ts                         Elysia app factory
    routes/
      protocol.ts                  /ocp/* protocol endpoints
      admin.ts                     /api/catalog-admin/*
      health.ts                    health and discovery endpoints
    errors.ts                      HTTP error mapping
    request-context.ts             request logging and auth helpers
  runtime/
    context.ts                     dependency construction
    start.ts                       process startup and graceful shutdown
    search-index-scheduler.ts      worker scheduling only
  ingestion/
    object-sync-adapter.ts         protocol object sync entry
    batch-ingest-service.ts        production batch import path
    identity-service.ts            identity claims and dedupe
  projection/
    catalog-entry-projector.ts     CommercialObject -> CatalogEntry projection
    search-document-projector.ts   CatalogEntry -> search document projection
  search/
    indexing/
      index-job-service.ts         DB job enqueue and atomic claim
      reconcile-service.ts         paged checkpoint reconcile
    retrieval/
      full-text-retrieval.ts       PostgreSQL full-text retrieval
      vector-index-adapter.ts      dedicated vector index boundary
    query/
      commerce-query-planner.ts
      commerce-query-service.ts
  resolve/
    commerce-resolve-policy.ts     provider_api/source_url/catalog_cached policy
```

## Production Rules

- The HTTP API process must not run background embedding/indexing loops.
  Start `commerce:catalog:api` and `commerce:catalog:worker` as separate
  processes with separate connection-pool budgets.
- `DATABASE_POOL_MAX` controls the foreground API pool.
  `CATALOG_WORKER_DATABASE_POOL_MAX` controls the background indexing worker
  pool. Do not size the worker pool so high that it can exhaust RDS capacity
  needed by query traffic.
- Startup must not scan all catalog entries. Reconcile jobs must be paged and
  checkpointed.
- Search index jobs must be claimed atomically in the database before multiple
  workers run in parallel.
- Search indexing should prioritize document delete/upsert/rebuild work ahead
  of embedding refresh so an embedding backlog cannot starve query-visible
  document changes.
- Offset pagination is acceptable for shallow admin views only. Production query
  pagination should use cursor/keyset semantics.
- Search results return `CatalogEntry` projections. Full product details belong
  in Resolve or Provider/source systems.
- `CatalogEntry.image_url` is a preview projection. Full image lists remain in
  descriptor packs or resolve details.
- Object sync persistence is chunk-oriented. `batch_id` remains the provider
  idempotency key, while the catalog stores committed receipts as sync chunks;
  lifecycle erase responses report the deleted receipt count as
  `sync_chunk_count`.
- Do not put provider source tables in this app. Provider examples remain
  separate ingestion clients.

## Next Implementation Steps

1. Add separate foreground/background embedding rate limits or credentials so
   query embedding is not throttled by product embedding backlog.
2. Replace startup reconcile with `search/indexing/reconcile-service.ts` using
   keyset pagination and checkpoint state.
3. Add cursor pagination to catalog query protocol and keep offset as shallow
   compatibility only if explicitly required.
4. Add OpenSearch bulk upsert and ingest-pressure metrics for large rebuilds.
