---
name: ocp-catalog-agent
description: Use this skill only when an agent must call OCP Catalog protocol endpoints: discover a catalog through Registration node, inspect a route hint or manifest, build a valid CatalogQueryRequest, page through catalog results, or resolve a selected entry without inventing unsupported protocol fields.
---

This skill is for agent-side OCP Catalog protocol use.

Do not use it for ordinary repository maintenance, database work, UI work, provider sync implementation, or internal catalog service refactors unless the task requires constructing or validating protocol calls.

## Core Boundary

OCP has two agent-relevant protocol layers:

- `ocp.catalog.registration.v1`: Registration node discovery and catalog routing.
- `ocp.catalog.handshake.v1`: Catalog public discovery, manifest, query, and resolve.

Hard rules:

- Registration node indexes catalogs, not products.
- Catalog nodes query products or other commercial objects.
- Provider registration and object sync are not part of end-user agent querying.
- Request fields are catalog-specific. Send only fields declared by the selected catalog's manifest or accepted by its documented request schema.

## When Querying

Follow this order:

1. Classify the user's intent before choosing a catalog.
2. Load saved local catalog profiles from the local profile store.
3. Reuse a saved profile only when domain, geography, language, health, trust, endpoints, and query capabilities fit the intent.
4. If no suitable local catalog exists, discover or use a Registration node and search it for catalogs.
5. Choose a catalog using health, trust, verification, language hints, geographic hints, endpoints, and supported query packs.
6. Inspect the selected route hint.
7. Fetch the manifest when the route hint is insufficient or stale.
8. Build the query only from declared catalog capabilities.
9. Call the catalog `query_url`.
10. Call `resolve_url` only after a concrete result entry is selected.

Never skip from Registration node search to product results. Registration node only routes the agent to a catalog.

## Local Catalog Profiles

Agents should keep a small local routing cache of known catalogs.

Preferred local files:

- JSON: `~/.ocp/catalogs.json`
- YAML: `~/.ocp/catalogs.yaml`

Use whichever file already exists. If neither exists and the agent can write files, create `~/.ocp/catalogs.json`. Keep the file human-readable and do not store catalog secrets or provider credentials.

Recommended JSON shape:

```json
{
  "version": 1,
  "updated_at": "2026-04-24T00:00:00.000Z",
  "catalogs": [
    {
      "catalog_id": "cat_commerce_demo",
      "name": "Commerce Catalog",
      "base_url": "https://ocp.catalog.example",
      "manifest_url": "https://ocp.catalog.example/ocp/manifest",
      "query_url": "https://ocp.catalog.example/ocp/query",
      "resolve_url": "https://ocp.catalog.example/ocp/resolve",
      "domains": ["commerce", "shopping", "products"],
      "geographies": ["global"],
      "languages": ["zh", "en"],
      "supported_query_packs": ["ocp.query.keyword.v1", "ocp.query.filter.v1"],
      "health_status": "healthy",
      "trust_tier": "standard",
      "verification_status": "verified",
      "snapshot_id": "optional-registration-snapshot-id",
      "snapshot_fetched_at": "2026-04-24T00:00:00.000Z",
      "source_registration_url": "https://registration.example"
    }
  ]
}
```

Equivalent YAML shape:

```yaml
version: 1
updated_at: "2026-04-24T00:00:00.000Z"
catalogs:
  - catalog_id: cat_commerce_demo
    name: Commerce Catalog
    base_url: https://ocp.catalog.example
    manifest_url: https://ocp.catalog.example/ocp/manifest
    query_url: https://ocp.catalog.example/ocp/query
    resolve_url: https://ocp.catalog.example/ocp/resolve
    domains:
      - commerce
      - shopping
      - products
    geographies:
      - global
    languages:
      - zh
      - en
    supported_query_packs:
      - ocp.query.keyword.v1
      - ocp.query.filter.v1
    health_status: healthy
    trust_tier: standard
    verification_status: verified
    snapshot_id: optional-registration-snapshot-id
    snapshot_fetched_at: "2026-04-24T00:00:00.000Z"
    source_registration_url: https://registration.example
```

Local profile matching is strict:

- Match domain first. A commerce/product catalog is not suitable for local life, restaurants, city services, jobs, real estate, travel, or medical queries unless its profile explicitly says so.
- Match geography when the user expresses a location. For example, "杭州本地生活" needs a catalog whose geography or metadata covers Hangzhou, Zhejiang, China, or local-life content.
- Match language when the user expects a language-specific result.
- Match query capability. Do not choose a catalog that cannot support the required keyword, filter, semantic, or resolve flow.
- Respect health and trust. Do not use unhealthy or unverified catalogs unless the user explicitly asks to try them.

If local profiles contain only commerce catalogs and the user asks for Hangzhou local-life content, report that no local catalog is suitable and search a Registration node for a local-life catalog instead.

After selecting a new catalog from a Registration node, save or update its local profile when allowed. Store route hints, capability summaries, trust/health status, relevant domain and geography tags, and the source Registration node. Do not cache product results as catalog profiles.

## Registration Node Discovery

When local profiles are missing or unsuitable, use a Registration node.

If the user provides a Registration node `base_url`, first fetch:

```text
GET {base_url}/.well-known/ocp-registration
```

Use that discovery document to find the Registration manifest and catalog search endpoints. If the user provides a full discovery URL, use it directly.

If the user does not provide a Registration node, use the agent's configured default Registration node. Do not guess random public Registration nodes. If no default exists, ask for a Registration node URL.

Search the Registration node for catalogs matching the intent, not for products. For example:

- For "杭州本地生活", search for catalog profiles with local-life, city service, restaurant, events, travel, or Hangzhou/Zhejiang/China location hints.
- For "买一双帆布鞋", a commerce product catalog may be suitable.

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
- Say whether failure happened during registration discovery, catalog search, route resolve, catalog query, or catalog resolve.

If no suitable catalog exists:

- Say that clearly.
- Identify whether the blocker is health, trust, verification, language, endpoint, or query capability mismatch.

## Read More

Use these references only when deeper context is needed:

- `references/agent-workflow.md`
- `references/registration-protocol.md`
- `references/handshake-protocol.md`
