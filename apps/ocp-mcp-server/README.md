# OCP MCP Server

`apps/ocp-mcp-server` exposes agent-facing MCP tools for OCP Catalog discovery, inspection, query, and resolve.

It does not replace the OCP HTTP protocols. It acts as a local MCP gateway:

```text
Agent -> MCP client -> ocp-mcp-server -> Registration node -> selected Catalog
```

## Tools

- `describe_ocp_catalog`
- `search_catalogs`
- `inspect_catalog`
- `query_catalog`
- `resolve_catalog_entry`
- `find_and_query_catalog`

## User intent to tool

| User intent | Preferred tool |
| --- | --- |
| Find products, compare prices, check stock or inventory, search suppliers/providers/services/opportunities without choosing a catalog first | `find_and_query_catalog` |
| Ask what OCP catalogs, searchable domains, services, or data sources are available | `search_catalogs` |
| Ask which filters, query packs, languages, contracts, or endpoint health a catalog supports | `inspect_catalog` |
| Search inside one already selected catalog | `query_catalog` |
| Ask for final details, purchase/view/contact links, source URL, or provider-owned actions for a selected result | `resolve_catalog_entry` |
| Ask how this MCP gateway or OCP Catalog works | `describe_ocp_catalog` |

## Run

Start the demo Registration node and Catalog in separate terminals:

```bash
bun run registration:api
bun run commerce:catalog:api
```

Start the MCP server:

```bash
bun run mcp:gateway
```

## Configuration

```text
OCP_MCP_DEFAULT_REGISTRATION_URL=http://localhost:4100
OCP_MCP_REQUEST_TIMEOUT_MS=10000
OCP_MCP_USER_AGENT=ocp-mcp-server/0.1.0
OCP_MCP_API_KEY=
OCP_MCP_HTTP_PORT=4300
OCP_MCP_HTTP_PATH=/mcp
```

`OCP_MCP_API_KEY` is sent as `x-api-key` when the gateway calls a selected catalog's query endpoint.
The server exposes a Streamable HTTP MCP endpoint at `OCP_MCP_HTTP_PATH`.

## Validate

With the Registration node and demo Catalog running:

```bash
bun run validate:mcp
```

The validator checks the HTTP path that the MCP tools rely on:

```text
Registration search -> route hint -> manifest -> catalog query -> catalog resolve
```
