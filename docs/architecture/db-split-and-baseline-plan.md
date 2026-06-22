# DB Split and Baseline Plan

## Goal

Move database ownership from one global `@ocp-catalog/db` package to service-owned DB packages while keeping production data in place during the first phase.

The current production database is already large and has applied migrations through the embedding queue changes. Do not replace that history with a new `001_init` and run it against production. Baseline adoption must be an explicit verification step.

## Target Ownership

- `packages/db`: connection factory, Drizzle client helpers, advisory locks, migration runner utilities. No business schema exports.
- `packages/catalog-db`: catalog core, provider registry, object sync, search documents, search jobs, embedding work items, embedding batch tables.
- `packages/registration-db`: registration API tables and registration audit tables.
- `packages/activity-db`: activity raw/public event tables.
- `packages/provider-demo-db`: example commerce provider tables.
- `packages/shopify-app-db`: Shopify app installation, OAuth, token, webhook, and sync-job tables.

Catalog core and catalog search stay in one physical database owner for now. Their tables are still tightly coupled by the indexing and embedding state machine, and production already has large tables in that path.

## Migration Model

Each service DB package owns:

- its own `drizzle.config.ts`;
- its own `migrations/` directory;
- its own migration state table, for example `drizzle.__drizzle_migrations_catalog`;
- its own `001_init.sql` for new empty environments.

`packages/db/migrations` stops receiving business migrations after the split. It can either be archived or retained only as historical reference until the adoption is complete.

## Baseline Adoption

New environments execute:

1. infra bootstrap: required extensions such as `vector` and `pg_trgm`;
2. service baselines: `catalog-db`, `registration-db`, `activity-db`, provider demo, Shopify app as needed.

Existing production executes:

1. read-only schema inventory for extensions, tables, columns, enums, indexes, and FKs;
2. strict diff against the generated service baselines;
3. fail if any expected object differs or is missing;
4. insert baseline records into the new per-service migration state tables;
5. do not execute `001_init.sql` against existing production tables.

The adoption script must fail loud. It must not use `IF NOT EXISTS` to hide drift and then report success.

## Work Plan

1. Create service DB package skeletons and move schema files into their owners.
2. Replace imports so services no longer import a global `schema` from `@ocp-catalog/db`.
3. Split catalog schema internally into `core` and `search` modules while keeping one `catalog-db` package.
4. Generate service-owned `001_init.sql` files from the current schema.
5. Build a read-only `schema-diff` command for production adoption.
6. Build an `adopt-baseline` command that only records baseline migration rows after diff success.
7. Run an empty-database initialization test.
8. Run current unit/integration tests.
9. Apply production adoption in a maintenance window.

## Guardrails

- No service imports another service's DB schema directly.
- No global business `schema` barrel export.
- No online API path runs unbounded queries, deep offsets, large table counts, or unindexed ordering.
- Heavy jobs remain asynchronous, bounded, retryable, and explicitly failed on invalid state.
- Online index migrations must remain non-transactional where PostgreSQL requires `CREATE INDEX CONCURRENTLY`.
- Extensions are infra bootstrap ownership, not repeated by every service baseline.

