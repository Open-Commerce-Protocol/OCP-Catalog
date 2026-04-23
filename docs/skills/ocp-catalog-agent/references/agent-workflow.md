# OCP Catalog Agent Workflow

This reference is for agents that need a compact, practical map of how to use OCP Catalog correctly in a portable way.

## The Four Roles

- Provider
  Supplies objects to a catalog. Not the first place an end-user agent should query.
- Catalog
  The query-serving node. It exposes `/.well-known/ocp-catalog`, `CatalogManifest`, `/ocp/query`, and optionally `/ocp/resolve`.
- Center
  The catalog registry. It helps agents discover catalogs and returns route hints.
- Agent
  Searches Center for a catalog, then queries the chosen catalog directly.

## The Correct Order

```text
local saved catalog?
-> yes: inspect route hint and query the catalog
-> no: search Center for catalogs
-> choose a catalog
-> inspect route hint or manifest
-> query the catalog
-> optionally resolve a chosen entry
```

This ordering matters because Center is not a product search engine.

## What Center Is For

Use Center to answer:

- which catalog should I query next?
- which catalogs are healthy or trusted?
- which catalogs advertise matching query packs?

Do not use Center as if it stores the catalog's product inventory.

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
3. Which query modes does it hint?
4. Which languages does it hint?
5. Does the request need free text, filters, or both?
6. Are the chosen filters actually consistent with the catalog's declared or hinted fields?

## Resolve Checklist

Before calling `/ocp/resolve`, check:

1. Has a concrete entry already been selected?
2. Does the catalog expose a `resolve_url`?
3. Does the user actually need the final action target now?

If not, stay at query stage.

## Common Mistakes To Avoid

- Searching Center for products instead of catalogs
- Treating Provider endpoints as query endpoints
- Using `CatalogRegistration` logic when the task is agent-side discovery
- Inventing `query_pack` values
- Assuming every catalog supports semantic or hybrid search
- Ignoring trust, health, or language hints at routing time

## Additional Source Documents

For fuller protocol detail, read these bundled references:

- `center-protocol.md`
- `handshake-protocol.md`
