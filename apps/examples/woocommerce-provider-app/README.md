# WooCommerce OCP Provider App

Treats a WooCommerce merchant site as an OCP **Provider**: pulls products via
the WooCommerce REST API (`/wp-json/wc/v3/products`), maps each to an OCP
`CommercialObject`, and pushes them to an OCP Catalog via
`/ocp/providers/register` and `/ocp/objects/sync`.

Mirrors the Shopify provider app (`shopify-provider-app`) but speaks WC REST
instead of Shopify Admin GraphQL.

## Sync capabilities

- `POST /admin/register`
- `POST /admin/sync/full`
- `POST /admin/sync/delta`  (uses `modified_after`)
- `POST /admin/sync/one/:productId`
- `POST /webhooks/woocommerce`  (HMAC-SHA256 via `X-WC-Webhook-Signature`)
- `GET  /admin/status`

## Run

```bash
bun run --cwd apps/examples/woocommerce-provider-app dev
```

Mock mode is default (`WC_PROVIDER_MOCK=true`). For a real WooCommerce site:

```bash
WC_PROVIDER_MOCK=false \
WC_PROVIDER_SITE_URL=https://store.example.com \
WC_PROVIDER_CONSUMER_KEY=ck_xxx \
WC_PROVIDER_CONSUMER_SECRET=cs_xxx \
WC_PROVIDER_WEBHOOK_SECRET=whsec_xxx \
bun run --cwd apps/examples/woocommerce-provider-app dev
```

If your hosting strips Authorization headers, set
`WC_PROVIDER_AUTH_MODE=query_string` to fall back to
`?consumer_key=...&consumer_secret=...`.
