# OCP WebMCP MCP Demo

This demo exposes the OCP MCP gateway tools to Chrome WebMCP and shows the returned catalog data on the page.

## Local Run

Start the MCP gateway first:

```bash
bun run --cwd apps/ocp-mcp-server dev:http
```

Then start this demo:

```bash
bun run --cwd apps/examples/ocp-webmcp-mcp-demo-web dev
```

The Vite dev server proxies `/api/ocp-mcp` to `http://localhost:4300/mcp`.

## Chrome Setup

Use Chrome 148 or newer, open `chrome://flags`, search for `WebMCP`, then enable:

- `WebMCP support in DevTools`
- `WebMCP for testing`

Restart Chrome after changing the flags.

## OCP Tool Flow

OCP Catalog has two distinct layers:

- Registration discovery answers which Catalog should be used.
- Catalog query and resolve retrieve entries and final details from the selected Catalog.

The recommended WebMCP tool flow is:

1. `ocp.mcp.search_catalogs`
2. `ocp.mcp.inspect_catalog`
3. `ocp.mcp.query_catalog`
4. `ocp.mcp.resolve_catalog_entry`

`ocp.mcp.find_and_query_catalog` is a convenience helper for natural-language retrieval when no Catalog is already selected. It searches Registration, selects a Catalog, and runs a query, but it does not replace `inspect_catalog` or `resolve_catalog_entry` when an agent needs capabilities or final details.
