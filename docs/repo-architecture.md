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

- `apps/commerce-catalog-api`
  - first catalog implementation for commerce products
- `apps/commerce-provider-api`
  - provider source-data API and catalog sync runtime
- `apps/ocp-center-api`
  - catalog registry and routing center

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

This split is organizational only. Migrations still remain in one linear history under `packages/db/migrations/`.

## Migration Policy

During active phase development:

- keep a single linear migration history
- make migrations small and domain-focused
- do not rewrite history for cosmetic cleanup

After the phase 1 storage model stabilizes, the migration history can be squashed into a fresh baseline.

## Current Follow-up Work

- add focused service tests for core paths
- continue moving scenario-only logic out of shared packages when new leakage appears
- keep app-local modules organized by feature as the HTTP surfaces grow
