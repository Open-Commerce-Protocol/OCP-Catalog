---
name: ocp-catalog-agent
description: Use this skill only when an agent must call OCP Catalog protocol endpoints: discover a catalog through Registration node, inspect a route hint or manifest, build a valid CatalogQueryRequest, page through catalog results, or resolve a selected entry without inventing unsupported protocol fields.
---

This skill is for agent-side OCP Catalog protocol use.

Do not use it for ordinary repository maintenance, database work, UI work, provider sync implementation, or internal catalog service refactors unless the task requires constructing or validating protocol calls.

## Core Boundary

OCP has two agent-relevant protocol layers:

- `ocp.catalog.center.v1`: Registration node discovery and catalog routing.
- `ocp.catalog.handshake.v1`: Catalog public discovery, manifest, query, and resolve.

Hard rules:

- Registration node indexes catalogs, not products.
- Catalog nodes query products or other commercial objects.
- Provider registration and object sync are not part of end-user agent querying.
- Request fields are catalog-specific. Send only fields declared by the selected catalog's manifest or accepted by its documented request schema.

## When Querying

Follow this order:

1. Reuse a saved local `CatalogRouteHint` when it is still suitable.
2. If no suitable local catalog exists, search Registration node for catalogs.
3. Choose a catalog using health, trust, verification, language hints, endpoints, and supported query packs.
4. Inspect the selected route hint.
5. Fetch the manifest only when the route hint is insufficient.
6. Build the query only from declared catalog capabilities.
7. Call the catalog `query_url`.
8. Call `resolve_url` only after a concrete result entry is selected.

Never skip from Registration node search to product results. Registration node only routes the agent to a catalog.

## Query Pack Rules

`query_pack` is the request-level capability selector.

- Use only an exact pack id declared by the selected catalog.
- Never invent ids such as `catalog`, `search`, `product`, `commerce`, or natural-language placeholders.
- If the best pack is unclear, omit `query_pack` and let the catalog choose.
- Do not add extra planning fields just because one example catalog supports them.

Common canonical packs, when declared:

- Free-text search: `ocp.query.keyword.v1`
- Constraint/list search: `ocp.query.filter.v1`
- Semantic retrieval: `ocp.query.semantic.v1`

If both text and filters are present, choose a declared pack that can support the intent. If uncertain, prefer the safest declared pack or omit `query_pack`.

## Request Shapes

Clean list query with pagination:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogQueryRequest",
  "catalog_id": "selected-catalog-id",
  "limit": 20,
  "offset": 0,
  "explain": false
}
```

Keyword query:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogQueryRequest",
  "catalog_id": "selected-catalog-id",
  "query_pack": "ocp.query.keyword.v1",
  "query": "wireless headphones",
  "filters": {},
  "limit": 10,
  "offset": 0,
  "explain": true
}
```

Filter query:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogQueryRequest",
  "catalog_id": "selected-catalog-id",
  "query_pack": "ocp.query.filter.v1",
  "filters": {
    "category": "electronics",
    "in_stock_only": true
  },
  "limit": 10,
  "offset": 0,
  "explain": true
}
```

Semantic query only when the catalog declares `ocp.query.semantic.v1`:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogQueryRequest",
  "catalog_id": "selected-catalog-id",
  "query_pack": "ocp.query.semantic.v1",
  "query": "lightweight commuting audio gear",
  "limit": 10,
  "offset": 0,
  "explain": true
}
```

## Filter Discipline

Use filters only when the route hint or manifest declares compatible fields.

Commerce catalogs commonly support:

- `category`
- `brand`
- `currency`
- `availability_status`
- `provider_id`
- `sku`
- `min_amount`
- `max_amount`
- `in_stock_only`
- `has_image`

Do not invent aliases such as `price_min`, `price_max`, `merchant`, `seller`, `inStock`, or `image_required` unless the selected catalog explicitly declares them.

## Pagination

Use `limit` and `offset` for page navigation.

- First page: `offset: 0`
- Next page: use `page.next_offset` from `CatalogQueryResult` when present
- Stop when `page.has_more` is false
- A query with only `catalog_id`, `limit`, and `offset` is a valid list request

## Resolve Rules

Use `/ocp/resolve` only when a specific `entry_id` has been chosen by the user or by an explicit selection step.

Do not resolve every query result. Resolve is for final handoff to visible attributes and action bindings.

## Failure Recovery

If the catalog rejects the query:

- Remove any field not declared by the catalog.
- Remove `query_pack` if pack compatibility is uncertain.
- Downgrade semantic intent to keyword or filter when semantic is not declared or not ready.
- Retry with a smaller request before reporting failure.

If Registration node or Catalog is unreachable:

- Report the exact endpoint that failed.
- Say whether failure happened during center discovery, catalog search, route resolve, catalog query, or catalog resolve.

If no suitable catalog exists:

- Say that clearly.
- Identify whether the blocker is health, trust, verification, language, endpoint, or query capability mismatch.

## Read More

Use these references only when deeper context is needed:

- `references/agent-workflow.md`
- `references/registration-protocol.md`
- `references/handshake-protocol.md`
