# OCP MCP Server

`apps/ocp-mcp-server` exposes agent-facing MCP tools for OCP Catalog discovery, inspection, query, and resolve.

It does not replace the OCP HTTP protocols. It acts as a local MCP gateway:

```text
Agent -> MCP client -> ocp-mcp-server -> Registration node -> selected Catalog
```

## Tools

- `search_catalogs`
- `inspect_catalog`
- `query_catalog`
- `resolve_catalog_entry`
- `find_and_query_catalog`

## Run

Start the demo Registration node and Catalog in separate terminals:

```bash
bun run registration:api
bun run commerce:catalog:api
```

Start the MCP server over stdio:

```bash
bun run mcp:gateway
```

## Configuration

```text
OCP_MCP_DEFAULT_REGISTRATION_URL=http://localhost:4100
OCP_MCP_REQUEST_TIMEOUT_MS=10000
OCP_MCP_USER_AGENT=ocp-mcp-server/0.1.0
OCP_MCP_API_KEY=
```

`OCP_MCP_API_KEY` is sent as `x-api-key` when the gateway calls a selected catalog's query endpoint.

## Validate

With the Registration node and demo Catalog running:

```bash
bun run validate:mcp
```

The validator checks the HTTP path that the MCP tools rely on:

```text
Registration search -> route hint -> manifest -> catalog query -> catalog resolve
```
