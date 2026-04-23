---
name: ocp-catalog-agent
description: Use this skill when an agent needs to work with the OCP Catalog protocol: understand protocol boundaries, discover catalogs through OCP Catalog Registration node, inspect a catalog's route hint or manifest, choose a valid query strategy, and query or resolve results without inventing unsupported protocol fields.
---

This skill teaches an agent how to interact with OCP Catalog correctly.

Use it when the task involves:
- understanding what OCP Catalog Registration node, Catalog, Provider, and Agent each do
- finding a usable catalog through Registration node
- inspecting a catalog before querying it
- building valid `/ocp/query` requests
- using `/ocp/resolve` after choosing a result
- avoiding protocol mistakes such as querying Registration node for products or inventing `query_pack` values

## Protocol Model

Treat the system as two separate protocol layers:

- `ocp.catalog.center.v1`
  Catalog -> Registration node, and Agent -> Registration node for catalog discovery
- `ocp.catalog.handshake.v1`
  Provider -> Catalog, and Catalog public capability declaration

Important boundary:
- Registration node indexes catalogs, not products
- Catalog serves query and resolve over products or other commercial objects
- Provider registration is not part of agent-side catalog querying

## Agent Workflow

Follow this order unless the user explicitly asks for something else:

1. Check whether there is already a saved local catalog profile or route hint.
2. If no suitable local catalog exists, search OCP Catalog Registration node for catalogs.
3. Choose a catalog using Registration node metadata:
   `verification_status`, `trust_tier`, `health_status`, `supported_query_packs`, language hints, and routeable endpoints.
4. Read the selected catalog's `CatalogRouteHint`.
5. If more detail is needed, follow `manifest_url` and inspect `CatalogManifest`.
6. Build the query only from the selected catalog's declared capability surface.
7. Call the catalog's `/ocp/query`.
8. If the user needs a concrete action target, call the catalog's `/ocp/resolve` on a selected entry.

Do not skip directly from Registration node to product results. Registration node only helps you choose the catalog.

## Catalog Discovery Rules

When using Registration node:

- use `/.well-known/ocp-center` to discover Registration node endpoints
- use `/ocp/catalogs/search` to search catalogs
- use `/ocp/catalogs/resolve` only to resolve a catalog route hint, not a product

Prefer catalogs that are:

- healthy
- trusted enough for the task
- compatible with the user request's language and query shape
- advertising query packs that match the job

If route hint is enough, query the catalog directly. If not, inspect `manifest_url` first.

## Catalog Understanding Rules

Before querying a catalog, inspect these fields:

- `query_url`
- `resolve_url` if result resolution is needed
- `supported_query_packs`
- `metadata.query_hints.supported_query_modes`
- `metadata.query_hints.supported_query_languages`
- `metadata.query_hints.content_languages`

If deeper detail is needed, inspect the catalog manifest for:

- `query_capabilities`
- `query_capabilities[*].query_packs[*].pack_id`
- accepted input fields
- searchable, filterable, or sortable fields

## Query Construction Rules

Never invent protocol values.

In particular:

- `query_pack` must exactly match one of the selected catalog's declared packs
- never use natural-language placeholders such as `catalog`, `search`, `product`, or similar as `query_pack`
- if the catalog does not declare a pack you want, choose a compatible declared pack or omit `query_pack`
- use filters only when they match fields the catalog actually hints or declares

Common query-pack mapping when a catalog declares these canonical packs:

- keyword search: `ocp.query.keyword.v1`
- structured filtering: `ocp.query.filter.v1`
- semantic retrieval: `ocp.query.semantic.v1` only when the catalog declares it

If no query text exists and the task is mostly constraints, prefer filter-oriented planning.
If both free text and filters matter, prefer hybrid planning only when the catalog hints that hybrid is supported.

## Resolve Rules

Use `/ocp/resolve` only after the user or agent has chosen a concrete entry.

Do not resolve arbitrarily just because an entry exists.
Resolve is for the final object/action handoff, not for broad discovery.

## Failure Rules

If the catalog rejects a request:

- inspect the returned error message
- compare the attempted `query_pack` and filters against the selected catalog declaration
- retry with a declared pack or a simpler request

If the catalog or Registration node is unreachable:

- report the exact failing endpoint
- report whether the failure happened during Registration node discovery, Registration node search, catalog query, or catalog resolve

If no suitable catalog exists:

- say that clearly
- explain whether the blocker is trust, health, language, or capability mismatch

## Read More

Read these references when needed:

- `references/agent-workflow.md`
  Practical protocol map and step-by-step agent behavior
- `references/registration-protocol.md`
  Registration node protocol, registration, search, and route hint semantics
- `references/handshake-protocol.md`
  Catalog manifest, query capability, and handshake object boundaries
