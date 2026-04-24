# OCP Catalog Registration Protocol Reference

This reference summarizes the agent-relevant parts of `ocp.catalog.registration.v1`.

## Purpose

The Registration node protocol is for catalog discovery and routing.

Use it to answer:

- which catalog should the agent use
- which catalogs are healthy or trusted enough
- which catalogs advertise matching query packs or capabilities

Do not use it as if it were a product search protocol.

## Role Boundary

- Catalog -> Registration node
  Catalogs register themselves to a Registration node.
- Agent -> Registration node
  Agents search for catalogs and receive route hints.

The Registration node does not replace the catalog's own query and resolve logic.

## Main Objects

The most important Registration node-side objects for an agent are:

- `RegistrationDiscovery`
- `RegistrationManifest`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogSearchResultItem`
- `CatalogRouteHint`

For operator or control-plane tasks, these may also matter:

- `CatalogRegistration`
- `CatalogRegistrationResult`
- `CatalogVerificationResult`
- catalog refresh and token rotation objects

## Key Endpoints

Typical Registration node endpoints are:

```text
GET  /.well-known/ocp-registration
GET  /ocp/registration/manifest
POST /ocp/catalogs/search
POST /ocp/catalogs/resolve
```

Operator or control-plane endpoints may also include:

```text
POST /ocp/catalogs/register
GET  /ocp/catalogs/:catalogId
GET  /ocp/catalogs/:catalogId/manifest-snapshot
GET  /ocp/catalogs/:catalogId/health
GET  /ocp/catalogs/:catalogId/verification
POST /ocp/catalogs/:catalogId/refresh
POST /ocp/catalogs/:catalogId/verify
POST /ocp/catalogs/:catalogId/token/rotate
```

## Agent Discovery Flow

The intended order is:

```text
discover Registration node
-> inspect Registration node manifest if needed
-> search Registration node for catalogs
-> choose a catalog
-> inspect route hint
-> query the chosen catalog directly
```

## Route Hint Semantics

`CatalogRouteHint` is a routing summary, not a full copy of the catalog manifest.

The most useful route-hint fields for an agent are:

- `catalog_id`
- `catalog_name`
- `manifest_url`
- `query_url`
- `resolve_url`
- `supported_query_packs`
- `verification_status`
- `trust_tier`
- `health_status`
- `cache_ttl_seconds`
- `snapshot_id`
- `snapshot_fetched_at`
- optional metadata such as query hints and language hints

Use route hint to decide whether to route.
Use the manifest when you need the full search contract.

## Catalog Search Rules

When searching Registration node:

- search for catalogs, not products
- prefer catalogs whose trust and health are suitable for the task
- prefer catalogs whose `supported_query_packs` match the intended query shape
- use route hints as routing input, not as complete catalog truth

## Common Agent Mistakes

- sending product queries to Registration node instead of the catalog
- assuming Registration node search results are product results
- ignoring trust and health fields during routing
- skipping route-hint inspection before catalog query

