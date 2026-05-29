# Open Commerce Protocol — Catalog

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Spec](https://img.shields.io/badge/spec-v1-informational)](./docs/specs/registration/v1.md)
[![Runtime](https://img.shields.io/badge/runtime-Bun%201.3-black)](https://bun.sh)

Open Commerce Protocol (OCP) is an open protocol for **discovering, querying,
resolving and binding actions on commerce objects** across registrations,
catalogs, providers, and user-side agents.

This repository is the **official reference implementation** for the
*OCP Catalog* family of protocols. It is not a sketch — every role in the
protocol has a runnable service in this workspace, and every spec page is
backed by code you can read and run.

The three protocol surfaces, all live:

```text
Catalog -> Registration node
  Catalog registers with an OCP Catalog Registration node.
  Registration node fetches the manifest and builds an index + route hint.

Provider -> Catalog
  Provider discovers a Catalog, registers, and negotiates sync capability.
  Provider pushes objects; Catalog validates, persists, and indexes them.

User / Agent -> Registration node -> Catalog
  Agent reads its local catalog profile first.
  When missing, it asks a Registration node for catalog route hints.
  After user confirmation it saves the profile and queries / resolves
  directly against the Catalog.
```

## What's in this repo

```text
apps/
  ocp-registration-api/         OCP Catalog Registration node runtime
  ocp-registration-admin-web/   Registration node admin console
  ocp-site-web/                 Public site, protocol docs, latest updates
  ocp-activity-api/             Cross-service activity telemetry endpoint
  ocp-mcp-server/               OCP <-> MCP gateway
  examples/                     Reference implementations of each role
    commerce-catalog-api/         First Catalog implementation (commerce)
    commerce-catalog-admin-web/   Catalog admin console
    commerce-provider-api/        Reference Provider API
    commerce-provider-admin-web/  Provider admin console
    alimama-catalog-api/          Catalog backed by Alimama
    shopify-catalog-api/          Catalog backed by Shopify
    shopify-provider-app/         Provider app embedded in Shopify Admin
    shopify-app/                  Public Shopify lifecycle host
    woocommerce-provider-app/     Provider app for WooCommerce
    ocp-user-demo-api/            User-side agent reference backend
    ocp-user-demo-web/            User-side agent reference UI
    ocp-webmcp-mcp-demo-web/      WebMCP bridge sample
packages/
  ocp-schema/                   Provider <-> Catalog protocol schema
  registration-schema/          Catalog <-> Registration protocol schema
  ocp-activity-schema/          Activity wire schema
  catalog-core/                 Catalog orchestration kernel
  registration-core/            Registration node kernel
  ocp-activity-core/            Activity telemetry kernel
  ocp-client/                   TypeScript client for OCP HTTP surfaces
  ocp-cli/                      Command-line client (resolve, query, register)
  webmcp-adapter/               WebMCP transport adapter
  auth-core/                    Authentication helpers
  config/                       Configuration loader
  db/                           Drizzle schema and migrations
  shared/                       Common errors and utilities
docs/
  specs/                        Stable protocol specifications
  architecture/                 System and repository architecture
  integrations/                 Platform and scenario designs
  reference-agents/             Reference agent designs
  agent-guides/                 Agent-facing usage material
  archive/                      Superseded planning material
ocp.catalog.handshake.v1/       Wire schema package (Provider <-> Catalog)
ocp.catalog.registration.v1/    Wire schema package (Catalog <-> Registration)
skills/                         Agent skill source for the OCP toolchain
scripts/                        End-to-end validation scripts
```

Architecture boundaries are described in
[docs/architecture/repo-architecture.md](./docs/architecture/repo-architecture.md).
The full doc index is in [docs/README.md](./docs/README.md).

## What the reference implementation provides

### OCP Catalog Registration node

- Catalog registration with manifest snapshotting
- Catalog health, verification, refresh, token rotation
- Catalog search over indexed metadata, with stale-detection
- Route hint return, including manifest federation summary and trust profile
- Index field projection for Catalog manifests
- Remote-first federation as a declarative contract projection: Registration
  nodes exchange profile, contract, summary, mutation and trust metadata;
  they do not proxy a Catalog's object query or resolve

### Commerce Catalog

- Discovery, manifest, contracts
- Provider registration versioning and active contract state
- Sync capability negotiation and batched object sync
- `CommercialObject`, `DescriptorInstance`, `CatalogEntry` persistence
- Query: keyword, filter, hybrid, semantic
- Explain
- Resolve to `ResolvableReference`

The commerce Catalog's minimum live object contract:

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`

Default provider registration additionally guarantees:

- `ocp.commerce.product.core.v1#/product_url`

Declared query capability:

- Modes: `keyword`, `filter`, `hybrid`; `semantic` when embeddings are enabled
- Packs: `ocp.query.keyword.v1`, `ocp.query.filter.v1`,
  optional `ocp.query.semantic.v1`
- `supported_query_languages: ["en"]`, `content_languages: ["en"]`
- Filter fields: `category`, `brand`, `currency`, `availability_status`,
  `provider_id`, `sku`, `min_amount`, `max_amount`, `in_stock_only`,
  `has_image`

Declared provider-facing sync capability:

- `ocp.push.batch`

Query results include real commerce signal (price, image, availability,
quantity, `quality_tier`, resolved `view_product` action). Providers also
receive quality feedback (`local_quality`, `publish_readiness`,
`catalog_quality`).

### Commerce Provider

- Product CRUD and seed corpus
- Register with a Catalog
- Publish to Catalog: register + negotiate selected sync capability, then
  batch-sync at the current active registration version
- Sync run audit
- Provider admin console for inventory and registration lifecycle

### User-side agent

- A real agent backend, not just front-end rules
- The agent digests Registration node and Catalog responses before talking
  to the user — raw tool output is never returned
- Local catalog profiles are opt-in
- Multi-turn refinement against Catalog query

### Indexing and retrieval

The commerce Catalog is not a single `LIKE` table:

```text
CommercialObject
  -> scenario projection
  -> CatalogEntry
  -> structured filter columns
  -> search_text
  -> optional embedding rows
```

Retrieval mechanics:

- Structured filters pushed to the database (`provider_id`, `category`,
  `brand`, `currency`, `availability_status`, `sku`, `min_amount`,
  `max_amount`, `in_stock_only`, `has_image`)
- Keyword retrieval over `search_text`
- Hybrid retrieval merges keyword and semantic scores
- Semantic retrieval uses `pgvector` with HNSW ANN shortlist followed by an
  exact cosine rerank — no full-set cosine scan in the application layer

```text
ANN shortlist -> exact cosine rerank -> final merge / rank
```

## Quick start

### Prerequisites

- Bun `1.3.12+`
- PostgreSQL with the `pgvector` extension

### Install and migrate

```bash
bun install
bun run db:migrate
```

### Reset the local database

Local development does not preserve existing data. When the schema or baseline
migration changes, reset:

```bash
docker compose up -d postgres
bun run db:reset
```

This command clears the `public` and `drizzle` schemas of the database
referenced by `DATABASE_URL`, then reapplies the current baseline migrations.
It rejects non-local databases by default (`localhost`, `127.0.0.1`, `::1`).
For disposable environments, set `DB_RESET_ALLOW_NON_LOCAL=1` explicitly.

Configuration reference: [.env.example](./.env.example).

### Run the full reference chain

```bash
bun run registration:api
bun run commerce:catalog:api
bun run commerce:provider:api
bun run user:demo:api
```

To run the consoles and site as well:

```bash
bun run commerce:provider:admin
bun run user:demo
bun run site:dev
```

Default ports:

| Service                    | URL                       |
| -------------------------- | ------------------------- |
| Catalog API                | `http://localhost:4000`   |
| Registration node API      | `http://localhost:4100`   |
| Provider API               | `http://localhost:4200`   |
| Provider admin console     | `http://localhost:4210`   |
| User-side agent web        | `http://localhost:4220`   |
| User-side agent API        | `http://localhost:4230`   |
| OCP site web               | `http://localhost:5173`   |

### Run a single slice

```bash
# Site only (static front-end, no backend dependency)
bun run site:dev

# Catalog + Registration node (verify the Catalog -> Registration link)
bun run registration:api
bun run commerce:catalog:api

# Provider pair (verify the Provider -> Catalog link)
bun run commerce:provider:api
bun run commerce:provider:admin

# User-side agent pair (verify the Agent -> Catalog link)
bun run user:demo:api
bun run user:demo
```

## Validation

```bash
bun run validate:mvp            # Provider -> Catalog flow
bun run validate:registration   # Catalog -> Registration node flow
bun run test:integration        # Catalog integration tests (needs Postgres)
```

`bun run test` runs only tests with no external dependency.

## Common commands

```bash
bun run typecheck
bun run build
bun run test
```

## Documentation

- [docs/README.md](./docs/README.md) — documentation index
- [docs/architecture/repo-architecture.md](./docs/architecture/repo-architecture.md) — repository architecture
- [docs/architecture/system-design.md](./docs/architecture/system-design.md) — long-term system design
- [docs/specs/registration/v1.md](./docs/specs/registration/v1.md) — Registration v1 spec
- [docs/specs/handshake/v1.md](./docs/specs/handshake/v1.md) — Handshake v1 spec

When protocol descriptions conflict, the order of authority is: specs >
architecture > implementation > archived material.

## Contributing

Pull requests and issues are welcome. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community expectations.

To report a security vulnerability, follow [SECURITY.md](./SECURITY.md).

## License

Released under the [MIT License](./LICENSE).
