# Shopify OCP Provider App

Treats a Shopify merchant store as an OCP **Provider**: pulls products from
the Shopify Admin GraphQL API, maps each to an OCP `CommercialObject`, and
pushes them to an OCP Catalog via `/ocp/providers/register` and
`/ocp/objects/sync`.

This is **the opposite direction** of `shopify-catalog-api`, which exposes
the Shopify Global Catalog *to* agents. There is no shared code.

See `docs/shopify_woocommerce_provider_design.md` for the rationale, mapping
rules, and verification plan.

## Sync capabilities

- `POST /admin/register` — register this provider with the OCP catalog
- `POST /admin/sync/full` — list every product, batch-sync (≤25/batch)
- `POST /admin/sync/delta` — only products updated since the stored cursor
- `POST /admin/sync/one/:productId` — single product, useful for ops
- `POST /webhooks/shopify` — receive `products/{create,update,delete}` events
- `GET  /admin/status` — active registration version, last sync, last error

All `/admin/*` endpoints require `x-admin-key`.

## Run

```bash
bun run --cwd apps/examples/shopify-provider-app dev
```

Mock mode is on by default (`SHOPIFY_PROVIDER_MOCK=true`) so no Shopify
credentials are needed. The fixture lives in `tests/fixtures/`.

For a real store:

```bash
SHOPIFY_PROVIDER_MOCK=false \
SHOPIFY_PROVIDER_STORE_DOMAIN=mystore.myshopify.com \
SHOPIFY_PROVIDER_ACCESS_TOKEN=shpat_xxx \
SHOPIFY_PROVIDER_WEBHOOK_SECRET=whsec_xxx \
bun run --cwd apps/examples/shopify-provider-app dev
```

Then point the OCP catalog url at a running `commerce-catalog-api`
(`CATALOG_PUBLIC_BASE_URL=http://localhost:4000`).

## Validate

```bash
bun run --cwd apps/examples/shopify-provider-app test
bun run validate:shopify-provider-e2e
```
