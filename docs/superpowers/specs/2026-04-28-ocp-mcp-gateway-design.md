# OCP MCP Gateway Design

## Context

This workspace already implements the two OCP protocol layers as separate HTTP runtimes:

- `ocp.catalog.registration.v1`
  - `apps/ocp-registration-api`
  - handles catalog registration, discovery, search, route hint resolve, verification, refresh
- `ocp.catalog.handshake.v1`
  - `apps/examples/commerce-catalog-api`
  - handles catalog manifest, provider registration, object sync, query, and resolve

The new requirement is to let an agent complete the end-user OCP Catalog flow through MCP:

1. search for suitable catalogs through a Registration node
2. inspect a selected catalog's capabilities
3. query the selected catalog
4. resolve a chosen entry

The user explicitly wants the MCP layer to follow the existing protocol boundary:

- Registration node remains responsible for catalog discovery and routing
- the MCP layer may call target catalog `query_url` and `resolve_url` directly after route selection

## Goal

Add a new MCP-facing runtime that gives agents a complete OCP Catalog interaction path without changing the responsibility of `ocp-registration-api` or catalog runtimes.

## Non-Goals

- Do not turn `ocp-registration-api` into an object query proxy
- Do not expose provider registration or object sync through MCP in v1
- Do not redesign existing OCP HTTP schemas
- Do not require catalog runtimes to implement MCP directly in v1

## Recommended Approach

Introduce a new app:

- `apps/ocp-mcp-server`

This app acts as an MCP gateway for agent-side OCP usage. It consumes the existing OCP HTTP endpoints and exposes a smaller set of agent-oriented MCP tools.

This is preferred over embedding MCP directly into `ocp-registration-api` because:

- it preserves protocol boundaries already established in the repo
- it avoids making the Registration node responsible for commercial object querying
- it can support multiple catalogs without coupling them to one runtime
- it keeps MCP concerns isolated from OCP core services

## High-Level Architecture

```text
Agent
  -> MCP client
  -> ocp-mcp-server
       -> Registration node HTTP API
       -> selected Catalog HTTP API
```

Runtime responsibilities:

- `apps/ocp-mcp-server`
  - tool definitions
  - tool input validation
  - route hint and manifest fetch orchestration
  - catalog selection helper logic
  - query shaping guardrails
  - result normalization for agent use
- `apps/ocp-registration-api`
  - unchanged
  - catalog discovery and route hint source
- target catalog runtimes
  - unchanged
  - manifest, query, resolve source of truth

## Tool Surface

The first version should expose five MCP tools.

### 1. `search_catalogs`

Purpose:

- Search a Registration node for catalogs that fit a user intent

Input:

- `registration_base_url` optional
- `query` required
- `filters` optional
- `limit` optional
- `explain` optional

Behavior:

- if `registration_base_url` is omitted, use configured default Registration node
- call Registration discovery when needed
- call `/ocp/catalogs/search`
- return normalized candidate catalogs and route hints

Output summary:

- registration node used
- candidate list
- route hint essentials
- capability summary when available from search result metadata

### 2. `inspect_catalog`

Purpose:

- Inspect a catalog before querying it

Input:

- `route_hint` or `catalog_id`
- `registration_base_url` optional when `catalog_id` is used

Behavior:

- resolve route hint when only `catalog_id` is given
- fetch catalog manifest
- summarize supported query packs, modes, languages, filters, resolve support, trust and health signals

Output summary:

- manifest endpoints
- supported query packs
- supported filter fields
- content and query languages
- route hint freshness and trust metadata if available

### 3. `query_catalog`

Purpose:

- Execute a legal query against a selected catalog

Input:

- `route_hint` or `catalog_id`
- `registration_base_url` optional when `catalog_id` is used
- `query` optional
- `filters` optional
- `query_pack` optional
- `limit` optional
- `offset` optional
- `explain` optional

Behavior:

- obtain route hint and manifest
- validate requested `query_pack` against manifest
- validate filters against declared filter fields when possible
- send `CatalogQueryRequest` to the catalog `query_url`
- normalize the result for MCP consumers

Output summary:

- selected catalog info
- query request summary
- entries
- pagination state
- explain payload when present

### 4. `resolve_catalog_entry`

Purpose:

- Resolve a concrete entry after selection

Input:

- `route_hint` or `catalog_id`
- `registration_base_url` optional when `catalog_id` is used
- `entry_id` required

Behavior:

- obtain route hint and manifest when needed
- call catalog `resolve_url`
- return resolved attributes and action bindings

### 5. `find_and_query_catalog`

Purpose:

- Provide a higher-level shortcut for the common agent flow

Input:

- `registration_base_url` optional
- `catalog_query` required
- `catalog_filters` optional
- `catalog_selection` optional
- `query` optional
- `filters` optional
- `query_pack` optional
- `limit` optional

Behavior:

- search candidate catalogs
- select one catalog using deterministic policy
- inspect manifest
- run a query against the selected catalog

Selection policy in v1:

- prefer healthy catalogs over degraded ones
- prefer verified or not-required verification over unknown or failed verification
- prefer explicit domain match over generic tags
- prefer catalogs whose declared languages match the request hint
- when scores tie, use search ranking order from the Registration node

## Why Tool Abstractions Instead Of Raw Endpoint Mirrors

The MCP layer should not expose every OCP HTTP endpoint one-to-one in v1.

Reasons:

- the end-user agent flow is multi-hop and stateful
- the manifest must constrain valid query construction
- route hints and manifest lookup are boilerplate for most calls
- raw endpoint mirroring would make the model more likely to invent unsupported fields

The MCP tool surface should be task-oriented, while still staying faithful to protocol boundaries underneath.

## App Layout

Recommended app structure:

```text
apps/ocp-mcp-server/
  package.json
  tsconfig.json
  src/
    index.ts
    config.ts
    server.ts
    tools/
      search-catalogs.ts
      inspect-catalog.ts
      query-catalog.ts
      resolve-catalog-entry.ts
      find-and-query-catalog.ts
    ocp/
      registration-client.ts
      catalog-client.ts
      route-hints.ts
      manifest.ts
      selection.ts
    schemas/
      tool-inputs.ts
    errors.ts
```

Notes:

- client modules should wrap HTTP calls only
- tool modules should own orchestration and output shaping
- selection logic should stay isolated so future ranking policy changes do not affect transport code

## Transport Choice

The MCP server should support standard MCP server transport suitable for local agent integration.

Recommended v1 transport:

- `stdio`

Optional follow-up:

- streamable HTTP transport for remote or shared deployment

Reasoning:

- `stdio` is the lowest-friction path for local Codex or agent integration
- it avoids deployment and auth complexity in the first iteration
- the internal OCP HTTP calls still allow interaction with local or remote Registration and Catalog nodes

## Configuration

The MCP app should introduce a small dedicated config surface:

- `OCP_MCP_DEFAULT_REGISTRATION_URL`
- `OCP_MCP_REQUEST_TIMEOUT_MS`
- `OCP_MCP_USER_AGENT`
- optional `OCP_MCP_API_KEY`

Config rules:

- default Registration URL is required unless every tool invocation always passes one explicitly
- request timeout should have a conservative default such as `10000`
- when a target catalog requires an API key for query, support one configured outbound key in v1

## Data Flow Details

### Search Flow

```text
tool call
  -> choose Registration node
  -> fetch discovery if needed
  -> POST /ocp/catalogs/search
  -> normalize candidates
```

### Inspect Flow

```text
tool call
  -> resolve route hint if needed
  -> GET catalog manifest
  -> summarize capabilities
```

### Query Flow

```text
tool call
  -> route hint lookup
  -> manifest fetch
  -> validate query_pack and filters
  -> POST catalog query_url
  -> normalize entries and page info
```

### Resolve Flow

```text
tool call
  -> route hint lookup
  -> POST catalog resolve_url
  -> normalize resolved reference
```

## Error Model

The MCP layer should return structured, actionable tool errors instead of leaking raw HTTP failures when possible.

Error classes:

- `configuration_error`
  - missing default Registration URL
  - invalid MCP config
- `registration_unavailable`
  - Registration node timeout or non-success response
- `catalog_not_found`
  - route hint resolve failed or no matching catalog
- `catalog_manifest_unavailable`
  - manifest fetch failed
- `invalid_query_pack`
  - requested pack not declared by manifest
- `invalid_filter_field`
  - unsupported filter requested
- `catalog_query_failed`
  - target catalog query returned non-success
- `catalog_resolve_failed`
  - target catalog resolve returned non-success

Each tool result should include:

- stable error code
- readable message
- upstream endpoint involved when relevant
- safe debugging detail when available

## Trust And Safety Rules

The gateway must not silently ignore protocol constraints.

Rules:

- do not invent `query_pack` ids
- do not pass undeclared filter aliases when the manifest provides a field list
- do not query a catalog when route hints are missing mandatory endpoints
- surface trust and verification status in tool outputs
- do not auto-select an unhealthy catalog when a healthy alternative exists

## Caching

V1 should use lightweight in-memory caching only.

Cache targets:

- Registration discovery document
- route hint lookup by `catalog_id`
- catalog manifest by `manifest_url`

Cache policy:

- short TTL, for example 60 to 300 seconds
- cache is best-effort only
- cache must be bypassable when the tool explicitly requests freshness in a future revision

Persistent local catalog profile storage is out of scope for this first MCP server implementation.

## Testing Strategy

V1 verification should cover:

1. unit tests for selection and query validation logic
2. tool-level tests with mocked HTTP responses
3. one local smoke path against the existing demo services

Minimum smoke scenario:

1. start `ocp-registration-api`
2. start `commerce-catalog-api`
3. ensure the catalog is registered
4. call `search_catalogs`
5. call `inspect_catalog`
6. call `query_catalog`
7. call `resolve_catalog_entry`

## Implementation Plan Boundary

The implementation plan should be limited to the new MCP app and the smallest shared config helpers needed to support it.

Avoid in the first implementation plan:

- broad refactors in `ocp-registration-api`
- protocol schema redesign
- provider-side MCP features
- remote deployment packaging beyond local runtime support

## Open Decisions Resolved For V1

- MCP lives in a new app, not inside `ocp-registration-api`
- MCP may directly call selected catalog endpoints after route selection
- first version focuses on user-side discovery, query, and resolve only
- first transport is `stdio`
- first cache layer is in-memory only

## Success Criteria

The design is successful when:

- an agent can discover catalogs through MCP without manually composing Registration node calls
- an agent can inspect a catalog before querying it
- an agent can query a selected catalog using only manifest-supported capabilities
- an agent can resolve a selected entry
- the existing OCP protocol boundary remains intact
