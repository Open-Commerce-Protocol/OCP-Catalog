# OCP Catalog Agent Workflow

This reference is for agents that need a compact, practical map of how to use OCP Catalog correctly in a portable way.

## The Four Roles

- Provider
  Supplies objects to a catalog. Not the first place an end-user agent should query.
- Catalog
  The query-serving node. It exposes `/.well-known/ocp-catalog`, `CatalogManifest`, `/ocp/query`, and optionally `/ocp/resolve`.
- Registration node
  The catalog registry. It helps agents discover catalogs and returns route hints.
- Agent
  Searches Registration node for a catalog, then queries the chosen catalog directly.

## The Correct Order

```text
classify user intent
-> load local catalog profiles
-> suitable local catalog?
-> yes: inspect route hint or manifest, then query the catalog
-> no: discover/search Registration node for catalogs
-> choose a catalog
-> inspect route hint or manifest
-> query the catalog
-> optionally resolve a chosen entry
```

This ordering matters because Registration node is not a product search engine.

## Local Profile Store

Agents should treat local catalog profiles as a routing cache.

Preferred local files:

- `~/.ocp/catalogs.json`
- `~/.ocp/catalogs.yaml`

Use whichever exists. If neither exists and local writes are allowed, create `~/.ocp/catalogs.json`.

A profile should store:

- catalog id and name
- catalog base URL
- manifest, query, and resolve URLs
- supported query packs
- domain tags such as commerce, local-life, jobs, travel, restaurants, or services
- geography tags such as global, China, Zhejiang, Hangzhou
- language hints
- health, trust, and verification status
- source Registration node URL
- snapshot id and fetch time when provided

Do not store product query results, provider credentials, API keys, or user-private data in this file.

## Intent Fit

Before reusing a local profile, verify that it fits the user's intent.

Check:

- domain fit
- geography fit
- language fit
- health and trust fit
- query capability fit
- endpoint availability

Do not use a merely available catalog when the domain is wrong. For example, if the user asks for Hangzhou local-life content and the local cache only has a commerce product catalog, the correct action is to search a Registration node for a local-life catalog.

If no default Registration node is configured and the user did not provide one, ask for a center base URL instead of guessing.

## What Registration node Is For

Use Registration node to answer:

- which catalog should I query next?
- which catalogs are healthy or trusted?
- which catalogs advertise matching query packs?

Do not use Registration node as if it stores the catalog's product inventory.

## What Route Hint Is For

`CatalogRouteHint` is a routing summary, not a full manifest mirror.

Use it for:

- `manifest_url`
- `query_url`
- `resolve_url`
- `supported_query_packs`
- trust and health status
- cache and snapshot metadata

If you need deeper detail, fetch the manifest.

## What Manifest Is For

`CatalogManifest` is the catalog's detailed public declaration.

For agent-side querying, inspect:

- public query and resolve endpoints
- `query_capabilities`
- each `query_packs[*].pack_id`
- accepted input fields
- searchable, filterable, and sortable fields
- language or mode hints in metadata

## Query-Pack Discipline

The most common agent mistake is inventing a `query_pack`.

Rules:

- only send a `query_pack` the catalog declares
- prefer exact pack ids from `supported_query_packs`
- if a pack is not declared, do not improvise a new one
- if uncertain, omit `query_pack` or choose the safest declared pack

Many catalogs may declare canonical packs such as:

- `ocp.query.keyword.v1`
- `ocp.query.filter.v1`
- `ocp.query.semantic.v1` when enabled

## Query Planning Checklist

Before calling `/ocp/query`, check:

1. Which catalog was selected?
2. What query packs does it declare?
3. Which domain and geography does it cover?
4. Which languages does it hint?
5. Does the request need free text, filters, semantic retrieval, or resolve?
6. Are the chosen filters actually consistent with the catalog's declared or hinted fields?

## Resolve Checklist

Before calling `/ocp/resolve`, check:

1. Has a concrete entry already been selected?
2. Does the catalog expose a `resolve_url`?
3. Does the user actually need the final action target now?

If not, stay at query stage.

## Common Mistakes To Avoid

- Searching Registration node for products instead of catalogs
- Treating Provider endpoints as query endpoints
- Using `CatalogRegistration` logic when the task is agent-side discovery
- Inventing `query_pack` values
- Assuming every catalog supports semantic or hybrid search
- Ignoring trust, health, or language hints at routing time

## Additional Source Documents

For fuller protocol detail, read these bundled references:

- `registration-protocol.md`
- `handshake-protocol.md`
