# OCP Catalog Registration API

`apps/ocp-registration-api` is the first OCP Catalog Registration / Catalog Registry runtime.

It implements the `Catalog Node -> OCP Catalog Registration` side of the protocol, defined by:

```text
docs/ocp_catalog_registration_protocol_v1.md
ocp.catalog.registration.v1/
```

It does not ingest Provider objects. Provider object registration and sync belong to Catalog Nodes, such as `apps/examples/commerce-catalog-api`.

## Implemented Capabilities

Current Phase 1 registration capabilities:

- Registration discovery through `/.well-known/ocp-registration`.
- Registration manifest through `/ocp/registration/manifest`.
- Catalog registration through `CatalogRegistration`.
- Catalog `.well-known/ocp-catalog` fetch.
- Catalog `CatalogManifest` fetch and validation.
- Catalog manifest snapshot persistence.
- Catalog metadata indexing.
- Catalog-specific token issuance after registration.
- Token hash storage; plaintext token is returned only once.
- Catalog refresh with `x-catalog-token`.
- Catalog token rotation with `x-catalog-token`.
- Scheduled refresh of indexed catalogs.
- Catalog search over indexed Catalog metadata.
- Catalog route hint resolve by `catalog_id`.
- Health checks against the Catalog query endpoint.
- Search audit records.

## Role Boundary

OCP Catalog Registration indexes Catalog Nodes:

```text
Catalog Node -> OCP Catalog Registration -> CatalogIndexEntry -> CatalogRouteHint
```

Catalog Nodes index commercial objects:

```text
Provider -> Catalog Node -> CommercialObject -> CatalogEntry -> ResolvableReference
```

The Registration node returns route hints so Agents can call source Catalog Nodes directly. It does not proxy object search in Phase 1.

## Run

Start PostgreSQL and apply migrations:

```bash
docker compose up -d postgres
bun run db:migrate
```

Start a Catalog Node:

```bash
bun run commerce:catalog:api
```

Start the OCP Catalog Registration:

```bash
bun run registration:api
```

Default URLs:

```text
Catalog Node: http://localhost:4000
OCP Catalog Registration:  http://localhost:4100
```

## Environment

Relevant settings:

```text
REGISTRATION_API_PORT=4100
REGISTRATION_PUBLIC_BASE_URL=http://localhost:4100
REGISTRATION_ID=registration_local_dev
REGISTRATION_NAME=Local OCP Catalog Registration
REGISTRATION_REFRESH_SCHEDULER_ENABLED=true
REGISTRATION_REFRESH_INTERVAL_SECONDS=300
```

The refresh scheduler scans indexed Catalogs and refreshes their discovery, manifest, health status, snapshot, and index entry.

## Endpoints

```text
GET  /health
GET  /.well-known/ocp-registration
GET  /ocp/registration/manifest

POST /ocp/catalogs/register
GET  /ocp/catalogs/:catalogId
GET  /ocp/catalogs/:catalogId/manifest-snapshot
GET  /ocp/catalogs/:catalogId/health
GET  /ocp/catalogs/:catalogId/verification
POST /ocp/catalogs/:catalogId/verify
POST /ocp/catalogs/:catalogId/refresh
POST /ocp/catalogs/:catalogId/token/rotate

POST /ocp/catalogs/search
POST /ocp/catalogs/resolve
```

## Register A Catalog

In the current demo Registration node, registration is intentionally simple: once the manifest can be fetched, the snapshot is stored, the catalog is indexed, and a catalog token is issued.

```bash
curl -X POST http://localhost:4100/ocp/catalogs/register \
  -H "content-type: application/json" \
  -d '{
    "ocp_version": "1.0",
    "kind": "CatalogRegistration",
    "id": "catreg_local_1",
    "registration_id": "registration_local_dev",
    "catalog_id": "cat_local_dev",
    "registration_version": 1,
    "updated_at": "2026-04-21T00:00:00.000Z",
    "homepage": "http://localhost:4000",
    "well_known_url": "http://localhost:4000/.well-known/ocp-catalog",
    "claimed_domains": ["localhost"],
    "operator": {
      "operator_id": "local_dev_operator",
      "display_name": "Local Dev Catalog Operator",
      "contact_email": "ops@example.test"
    },
    "intended_visibility": "public",
    "tags": ["local", "commerce", "product"]
  }'
```

The response includes `catalog_access_token` when registration succeeds.

## Verify A Catalog

The current demo Registration node does not require an extra domain-verification challenge. The `verify` endpoint confirms that state and can issue a catalog token when needed:

```bash
curl -X POST http://localhost:4100/ocp/catalogs/<catalog_id>/verify \
  -H "content-type: application/json" \
  -d '{}'
```

If the catalog already has a token, the call simply confirms that no extra verification is required.

## Refresh A Catalog

Manual refresh requires the catalog-specific token:

```bash
curl -X POST http://localhost:4100/ocp/catalogs/cat_local_dev/refresh \
  -H "x-catalog-token: <catalog_access_token>"
```

Refresh re-fetches:

- `/.well-known/ocp-catalog`
- `/ocp/manifest`
- query endpoint health

Then it writes a new manifest snapshot and updates the index entry.

## Rotate Token

```bash
curl -X POST http://localhost:4100/ocp/catalogs/cat_local_dev/token/rotate \
  -H "x-catalog-token: <current_catalog_access_token>"
```

The old token is invalid immediately after rotation.

## Search Catalogs

```bash
curl -X POST http://localhost:4100/ocp/catalogs/search \
  -H "content-type: application/json" \
  -d '{
    "query": "commerce product",
    "filters": {
      "object_type": "product",
      "query_pack": "ocp.query.keyword.v1",
      "supports_resolve": true,
      "verification_status": "not_required"
    },
    "limit": 10,
    "explain": true
  }'
```

Search returns `CatalogRouteHint` values. Agents should save these locally and then call the source Catalog's `query_url` and `resolve_url`.

## Validate

Start both runtimes:

```bash
bun run commerce:catalog:api
bun run registration:api
```

Run:

```bash
bun run validate:registration
```

The validation covers registration, indexing, search, route hint resolve, token-required refresh, token-authenticated refresh, and token rotation.
