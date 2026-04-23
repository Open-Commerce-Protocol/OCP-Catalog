# OCP Catalog Handshake Protocol Reference

This reference summarizes the agent-relevant parts of `ocp.catalog.handshake.v1`.

## Purpose

The handshake protocol defines the catalog's public capability surface and the provider-to-catalog integration model.

For agent-side querying, the most important part is the catalog's public declaration:

- discovery document
- `CatalogManifest`
- query and resolve capability

Provider registration and object sync matter for catalog construction, not for the agent's routing loop.

## Role Boundary

- Provider -> Catalog
  Registration and object sync
- Agent -> Catalog
  Query and optionally resolve

Do not confuse provider-facing sync endpoints with agent-facing query endpoints.

## Main Agent-Relevant Documents

- `/.well-known/ocp-catalog`
- `CatalogManifest`

These tell the agent:

- who the catalog is
- where the public query and resolve endpoints are
- which query capabilities and query packs exist
- which fields are accepted by the query contract

## Typical Catalog Endpoints

Typical public catalog endpoints are:

```text
GET  /.well-known/ocp-catalog
GET  /ocp/manifest
POST /ocp/query
POST /ocp/resolve
```

Provider-facing endpoints may also exist:

```text
POST /ocp/providers/register
POST /ocp/objects/sync
GET  /ocp/contracts
```

These are not the first endpoints an end-user agent should call when trying to search.

## Query Capability Semantics

The search contract is expressed through:

- `query_capabilities`
- `query_capabilities[*].query_packs[*].pack_id`
- query-pack metadata and query-mode hints
- input fields, searchable fields, filterable fields, and sortable fields

The agent should inspect the declared packs before constructing a query.

## Query-Pack Rules

The agent must follow these rules:

- only use a `query_pack` that the selected catalog declares
- do not invent `query_pack` ids
- if the catalog does not declare the desired pack, choose a compatible declared pack or omit `query_pack`
- use query modes and filters consistently with the selected pack

Common canonical pack ids may include:

- `ocp.query.keyword.v1`
- `ocp.query.filter.v1`
- `ocp.query.semantic.v1`

But the agent must still verify what the selected catalog actually declares.

## Manifest Inspection Checklist

Before calling `/ocp/query`, inspect:

1. `endpoints.query.url`
2. `endpoints.resolve.url` if resolve is needed
3. `query_capabilities`
4. each declared `pack_id`
5. query-mode hints
6. language hints
7. accepted filter or input fields

## Common Agent Mistakes

- using provider registration concepts during agent-side querying
- treating every catalog as if it supports the same packs
- assuming semantic or hybrid search always exists
- ignoring the manifest and guessing request shape

