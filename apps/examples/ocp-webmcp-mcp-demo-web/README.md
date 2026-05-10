# OCP WebMCP MCP Demo

This demo renders OCP Commerce product catalog entries as a shopping mall and exposes the OCP MCP gateway tools to Chrome WebMCP. It does not add a new business backend.

The page actively discovers catalogs from a Registration node and calls the selected Catalog HTTP query endpoint directly:

- Registration discovery/search defaults to `https://ocp.deeplumen.io`.
- Current public Commerce catalog: `cat_local_dev`.
- Current query endpoint: `https://ocp.catalog.pageflux.net/ocp/query`.
- Clean list request: `{ "catalog_id": "cat_local_dev", "limit": 24, "offset": 0 }`.
- Keyword search request adds `query_pack: "ocp.query.keyword.v1"` and `query`.

WebMCP is page-native here. The page registers browser tools such as `ocp.mall.search_products` through `navigator.modelContext`; it does not need `apps/ocp-mcp-server` to expose those tools. Start the MCP gateway only when you explicitly want to test the separate server-side MCP service.

## Local Run

Start the MCP gateway first:

```bash
bun run --cwd apps/ocp-mcp-server dev:http
```

Then start this demo:

```bash
bun run --cwd apps/examples/ocp-webmcp-mcp-demo-web dev
```

The Vite dev server proxies `/api/ocp-mcp` to `http://localhost:4300/mcp`. To point at another gateway, set `VITE_OCP_MCP_GATEWAY_URL`.

## Chrome Setup

Use Chrome 148 or newer, open `chrome://flags`, search for `WebMCP`, then enable:

- `WebMCP for testing`
- `WebMCP support in DevTools` if your Chrome build shows that flag

Restart Chrome after changing the flags.

For manual testing, install the Chrome extension `WebMCP - Model Context Tool Inspector`. Open this page, open the extension side panel, and verify that it lists:

- `ocp.mall.get_page_state`
- `ocp.mall.list_products`
- `ocp.mall.search_products`
- `ocp.mall.set_data_source`

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
