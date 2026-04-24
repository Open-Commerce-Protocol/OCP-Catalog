# @ocp-catalog/catalog-core

Minimal protocol runtime package for an OCP Catalog Node.

This package contains protocol-facing building blocks used by runtime apps: manifest construction, provider registration rules, object sync orchestration, projection helpers, and resolve reference generation. Scenario-specific search, query packs, ranking, and index maintenance belong in the app that owns the scenario.

This package is not the OCP Catalog Registration / Catalog Registry implementation. It implements the `Provider -> Catalog Node` side of the protocol. The `Catalog Node -> OCP Catalog Registration` handshake is documented in `docs/ocp_catalog_registration_protocol_v1.md`.

## Status

`@ocp-catalog/catalog-core` is currently an internal workspace package. It is structured so it can become a public package later, but the public API should stay conservative until the Catalog Node protocol surface is stable.

The package intentionally does not start an HTTP server. Runtime adapters such as Elysia should create services from this package and bind them to transport-specific routes.

## Responsibilities

- Build OCP Catalog discovery and manifest objects.
- Accept scenario-specific object contracts through `CatalogScenarioModule`.
- Validate provider registrations against supported contracts.
- Enforce provider registration version activation rules.
- Validate synced `CommercialObject` payloads.
- Delegate descriptor pack validation to the runtime scenario module.
- Delegate normalized search and explain projections to the runtime scenario module.
- Upsert commercial objects, descriptor instances, and catalog entries.
- Resolve active entries into `ResolvableReference` payloads.

## Non-Responsibilities

- HTTP routing.
- CORS, request parsing, or response formatting.
- API key extraction.
- Process configuration loading.
- Database connection creation.
- UI or provider demo behavior.
- Scenario-specific query modes, query packs, search ranking, retrieval indexes, or index jobs.
- Long-term provider identity verification.

Those concerns live in runtime packages such as `apps/examples/commerce-catalog-api`, `packages/config`, and `packages/auth-core`.

## Package Layout

```text
src/
  contracts.ts              Catalog discovery and manifest builders
  field-ref.ts              field_ref parser and descriptor field reader
  projection.ts             Generic projection helpers
  scenario.ts               Scenario module interface
  registration-service.ts   Provider registration validation and versioning
  object-sync-service.ts    Object sync validation and persistence
  resolve-service.ts        ResolvableReference creation and persistence
  index.ts                  Public workspace exports
```

## Usage

```ts
import { buildCatalogManifest, createCatalogServices } from '@ocp-catalog/catalog-core';
import { loadConfig } from '@ocp-catalog/config';
import { createDb } from '@ocp-catalog/db';
import { commerceCatalogScenario } from './commerce-scenario';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const services = createCatalogServices(db, config, commerceCatalogScenario);

const manifest = buildCatalogManifest(config, commerceCatalogScenario);
const resolved = await services.resolve.resolve({ entry_id: 'entry_...' });
```

Most runtime code should use `createCatalogServices(db, config, scenario)` instead of manually wiring service constructors.

## Public API Boundary

The current intended API surface is:

```ts
createCatalogServices(db, config, scenario)

buildWellKnownDiscovery(config)
buildCatalogManifest(config, scenario)

RegistrationService
ObjectSyncService
ResolveService

parseFieldRef(fieldRef)
readDescriptorField(object, fieldRef)
visibleAttributes(projection)
CatalogScenarioModule
```

Everything else should be treated as implementation detail.

## Persistence Boundary

`catalog-core` receives a Drizzle database instance from `@ocp-catalog/db`. It does not own migrations or connection lifecycle. This keeps the package usable by multiple hosts:

- Bun + Elysia API server.
- Future admin worker.
- Future test harness.
- Future hosted Catalog Node runtime.

## Registration Model

Provider registration is not object sync. Registration only declares provider identity, supported object types, provided descriptor packs, guaranteed field refs, and delivery mode.

The service activates a registration only when:

- `catalog_id` matches the running Catalog.
- `registration_version` is newer than the active version.
- At least one declaration matches a supported object contract.
- Required packs and required field refs are covered.
- Delivery mode is allowed by the matched contract.

Stale versions are recorded but do not replace the active contract state.

## Object Sync Model

Object sync requires an active provider state and matching `registration_version`. Each object in a batch is validated independently so a batch can partially succeed.

Accepted objects produce:

- `commercial_objects`
- `descriptor_instances`
- `catalog_entries`

Rejected objects produce item-level structured errors in `object_sync_item_results`.

## Query and Resolve Model

Resolve accepts an `entry_id`, verifies that the entry and underlying object are active, then returns a short-lived `ResolvableReference` with visible attributes and controlled URL action bindings.

Query execution is app-owned. A runtime app should implement its own query service from its declared query packs, filters, ranking policy, retrieval indexes, and embedding provider choices. `apps/examples/commerce-catalog-api` contains the commerce-specific implementation.

## Publishing Preparation

Before publishing this package publicly, do the following:

1. Decide whether the public package should export TypeScript source or built JavaScript declarations.
2. Add declaration output or a dedicated package build step if publishing compiled artifacts.
3. Replace workspace dependency ranges with npm-publishable semver ranges.
4. Review which service classes should remain public.
5. Add package-level tests for registration, sync validation, projection, and resolve behavior.
6. Remove `"private": true` only when the package API is ready to support external users.

Current package metadata already includes `files`, `description`, `keywords`, and `sideEffects` to keep the future publish shape explicit without changing workspace development.
