# Shopify Catalog Example (OCP bridge)

A realtime OCP Catalog Node that proxies queries to the Shopify Catalog MCP
endpoints (Global or Storefront). It does not persist Shopify products and
does not register as an OCP Provider; both `/ocp/query` and `/ocp/resolve`
forward to Shopify in real time.

- `/ocp/query`  → Shopify `search_catalog` (keyword + `available` / `ships_to`)
- `/ocp/resolve` → Shopify `get_product` (returns variants with `checkout_url`)
- Manifest declares only query + resolve capabilities; no provider/sync flow.

See `docs/integrations/shopify-catalog.md` for the design rationale,
field mapping rules, and risks.

## Modes

| Mode | Endpoint | Lookup batch | Filters | Pagination |
|---|---|---|---|---|
| `global` | `https://catalog.shopify.com/api/ucp/mcp` | up to 50 | `ships_to`, `available` | not documented |
| `storefront` | `https://{store}/api/ucp/mcp` | up to 10 | `available` only | cursor-based |

## Endpoints exposed

- `GET /.well-known/ocp-catalog`
- `GET /ocp/manifest`
- `GET /ocp/health`
- `GET /ocp/contracts`
- `POST /ocp/query`
- `POST /ocp/resolve`
- `POST /admin/probe-query`   (requires `x-admin-key`)
- `GET  /admin/stats`         (requires `x-admin-key`)

## Run

```bash
bun install
bun run --cwd apps/examples/shopify-catalog-api dev
```

Defaults to `SHOPIFY_MOCK=true` (reads from `tests/fixtures/`) so it works
out-of-the-box without Shopify credentials. To hit real Shopify endpoints:

```bash
SHOPIFY_MOCK=false \
SHOPIFY_CATALOG_MODE=global \
SHOPIFY_AGENT_PROFILE_URL=https://your.app/agent-profile.json \
bun run --cwd apps/examples/shopify-catalog-api start
```

For Storefront mode also set `SHOPIFY_STORE_DOMAIN=mystore.myshopify.com`.

## Validate

End-to-end check (boots a real server and walks the OCP flow):

```bash
# In one terminal:
bun run --cwd apps/examples/shopify-catalog-api dev

# In another:
bun run validate:shopify-mvp
```

Unit tests:

```bash
bun run --cwd apps/examples/shopify-catalog-api test
bun run --cwd apps/examples/shopify-catalog-api typecheck
```
