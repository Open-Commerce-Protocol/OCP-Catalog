# Repo Architecture

This repository follows a layered workspace layout:

- `apps/`
  - deployable runtimes
  - scenario-specific implementations
  - HTTP surfaces and app-local orchestration
- `packages/`
  - protocol schemas and types
  - shared orchestration cores
  - shared infrastructure utilities

## Runtime Units

At runtime, the workspace currently collapses into 5 service units:

1. `apps/ocp-center-api`
2. `apps/examples/commerce-catalog-api`
3. `commerce-provider`
   - `apps/examples/commerce-provider-api`
   - `apps/examples/commerce-provider-admin-web`
4. `ocp-user-demo`
   - `apps/examples/ocp-user-demo-api`
   - `apps/examples/ocp-user-demo-web`
5. `apps/ocp-protocol-docs-web`

The monorepo contains 7 app directories, but two pairs are intentionally split frontend/backend companions rather than separate product surfaces.

## Boundary Rules

### `packages` keeps the semantic minimum

Code in `packages` should be one of:

- protocol schema and type definitions
- cross-app orchestration services
- infrastructure helpers shared by more than one app
- generic utilities with clear reuse value

Code in `packages` should not carry commerce-specific behavior unless there is already a second scenario that needs the same abstraction.

### `apps` own scenario behavior

Scenario-specific behavior belongs in `apps`, including:

- commerce object contracts
- commerce query capabilities
- search projection rules
- embedding text composition
- provider-side product modeling
- app-local HTTP handlers

Current app ownership:

- `apps/examples/commerce-catalog-api`
  - first catalog implementation for commerce products
- `apps/examples/commerce-provider-api`
  - provider source-data API and catalog sync runtime
- `apps/examples/commerce-provider-admin-web`
  - provider management UI for the provider runtime
- `apps/ocp-center-api`
  - catalog registry and routing center
- `apps/examples/ocp-user-demo-api`
  - user-side agent backend
- `apps/examples/ocp-user-demo-web`
  - user-side demo frontend
- `apps/ocp-protocol-docs-web`
  - protocol documentation site

## Package Responsibilities

- `packages/ocp-schema`
  - Provider <-> Catalog protocol schemas and types
- `packages/center-schema`
  - Catalog <-> Center protocol schemas and types
- `packages/catalog-core`
  - minimal catalog orchestration
- `packages/center-core`
  - minimal center orchestration
- `packages/auth-core`
  - auth helpers
- `packages/config`
  - runtime config loading
- `packages/db`
  - shared persistence schema and migrations
- `packages/shared`
  - cross-cutting helpers and errors

## Persistence Layout

`packages/db/src/schema/` is split by domain:

- `catalog.ts`
  - catalog node persistence
- `provider.ts`
  - provider-owned source data and sync history
- `center.ts`
  - center registry persistence

This split is organizational only. The migration history has now been squashed into a fresh baseline under `packages/db/migrations/`.

## Migration Policy

Current policy after MVP phase 1:

- `packages/db/migrations/` keeps the baseline for fresh environments
- pre-baseline incremental migrations are kept only as workspace backup material when needed
- future migrations should continue linearly from the new baseline

## Current Follow-up Work

- add focused service tests for core paths
- continue moving scenario-only logic out of shared packages when new leakage appears
- keep app-local modules organized by feature as the HTTP surfaces grow
