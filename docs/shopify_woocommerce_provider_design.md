# Shopify & WooCommerce OCP Provider Apps — Design

> Status: implementation in `apps/examples/shopify-provider-app/` and
> `apps/examples/woocommerce-provider-app/`.
> Companion to `docs/woocommerce_ocp_integration_design.md` (which sets the
> longer-term plugin-shaped vision) and `docs/shopify_ocp_catalog_integration_design.md`
> (which covers the *opposite* direction — Shopify Global Catalog as an OCP
> source for agents).

## 1. Background & Goal

Merchants on Shopify and WooCommerce already maintain their canonical product
catalogue inside those platforms. This integration treats each merchant store
as an **OCP Provider** that pushes `CommercialObject`s into an OCP Catalog
(e.g. the reference `commerce-catalog-api`), so agents searching the catalog
can find those merchants' products with no plugin install required on the
agent side.

Goal in one line: **"Shopify/WooCommerce store → OCP Provider App → OCP
Catalog `/ocp/providers/register` + `/ocp/objects/sync` → agents discover the
merchant's products through any OCP-compliant catalog."**

This is the inverse direction of `shopify-catalog-api`, which consumes the
Shopify Global Catalog from an agent's perspective. There is no shared code
or coupling between the two.

## 2. Architecture

```
        ┌────────────────────────────┐                ┌────────────────────────────┐
        │  Shopify Admin GraphQL     │                │  WooCommerce REST API      │
        │  X-Shopify-Access-Token    │                │  Basic auth (CK/CS)        │
        │  /admin/api/.../graphql.json│                │  /wp-json/wc/v3/products   │
        └─────────────┬──────────────┘                └─────────────┬──────────────┘
                      │                                              │
                      ▼                                              ▼
        ┌────────────────────────────┐                ┌────────────────────────────┐
        │  shopify-provider-app      │                │  woocommerce-provider-app  │
        │  port 4400                 │                │  port 4410                 │
        │                            │                │                            │
        │  - GraphQL client          │                │  - REST client             │
        │  - product mapper          │                │  - product mapper          │
        │  - sync service            │                │  - sync service            │
        │  - webhook receiver        │                │  - webhook receiver        │
        │  - admin endpoints         │                │  - admin endpoints         │
        └─────────────┬──────────────┘                └─────────────┬──────────────┘
                      │                                              │
                      └──────────────────┬───────────────────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │  OCP Catalog                 │
                          │  /ocp/providers/register     │
                          │  /ocp/objects/sync           │
                          │  /ocp/query, /ocp/resolve    │
                          │  (commerce-catalog-api or    │
                          │   any conforming catalog)    │
                          └──────────────────────────────┘
```

Both apps share the same control loop:

1. `POST /admin/register` (or boot-time once) ⇒ build a
   `ProviderRegistration`, send to catalog, store the active
   `registration_version`.
2. `POST /admin/sync/full` ⇒ pull every product from the merchant platform,
   map to `CommercialObject`, batch-sync (≤100 per batch).
3. `POST /admin/sync/delta` ⇒ pull products updated after the stored
   `last_synced_at` cursor; mapped+synced.
4. `POST /webhooks/{shopify|woocommerce}` ⇒ verify HMAC, fetch the single
   product from the source-of-truth API (so we always sync canonical state,
   not webhook-attached payload that can race), map, sync one.

Neither app persists product data. The source-of-truth stays in
Shopify/WooCommerce; the only state we keep is small: the active
`registration_version` and a `last_synced_at` cursor for delta sync. For the
reference apps these go to an in-memory store (with disk-backed JSON fallback
on `SHOPIFY_PROVIDER_STATE_FILE` / `WC_PROVIDER_STATE_FILE`); production
deployments can swap in Redis or Postgres.

## 3. Data Mapping

### 3.1 Shopify Product → OCP `CommercialObject`

| Shopify field | OCP pack & field |
|---|---|
| `Product.id` (`gid://shopify/Product/123`) | `object_id` (strip prefix) |
| `Product.title` | `product.core.v1#/title` |
| `Product.descriptionHtml` (→ plain text) | `product.core.v1#/summary` |
| `Product.vendor` | `product.core.v1#/brand` |
| `Product.productType` | `product.core.v1#/category` |
| `Product.handle` + `onlineStoreUrl` | `product.core.v1#/product_url` (`source_url`) |
| `Product.media.nodes[].preview.image.url` | `product.core.v1#/image_urls` |
| `Product.variants.nodes[0].sku` | `product.core.v1#/sku` |
| `Product.variants.nodes[0].price` (string decimal) → number | `price.v1#/amount` |
| `Product.variants.nodes[0].compareAtPrice` → number | `price.v1#/list_amount` |
| Shop currency (set per store, falls back to USD) | `price.v1#/currency` |
| Aggregate of `variants[].inventoryQuantity` + `availableForSale` | `inventory.v1#/availability_status` (`in_stock` / `out_of_stock` / `unknown`) |
| `totalInventory` | `inventory.v1#/quantity` |
| `Product.status` (`ACTIVE`/`ARCHIVED`/`DRAFT`) | `CommercialObject.status` |
| `Product.tags`, `Product.options`, variant breakdown | `product.core.v1#/attributes.*` (free-form) |

Variable products: we emit **one CommercialObject per Shopify Product** (not
per variant), with variant breakdown stored in `attributes.variants`. The
canonical price is the lowest available variant's price; range is recorded in
attributes. This matches what `shopify-catalog-api` already does and avoids
exploding the catalog with millions of variant rows.

### 3.2 WooCommerce Product → OCP `CommercialObject`

| WC field | OCP pack & field |
|---|---|
| `id` | `object_id` |
| `name` | `product.core.v1#/title` |
| `description` / `short_description` (strip HTML) | `product.core.v1#/summary` |
| `attributes[]` find `Brand` | `product.core.v1#/brand` |
| `categories[0].name` | `product.core.v1#/category` |
| `permalink` | `product.core.v1#/product_url` + `source_url` |
| `images[].src` | `product.core.v1#/image_urls` |
| `sku` | `product.core.v1#/sku` |
| `price` (string) → number | `price.v1#/amount` |
| `regular_price` → number | `price.v1#/list_amount` |
| WC site default currency | `price.v1#/currency` |
| `stock_status` (`instock`/`outofstock`/`onbackorder`) | `inventory.v1#/availability_status` |
| `stock_quantity` | `inventory.v1#/quantity` |
| `type=='variable'` | also fetch `/products/{id}/variations` and embed in attributes |

### 3.3 `ProviderRegistration` shape

```ts
{
  provider: {
    provider_id: 'shopify_provider_{storeDomain}',   // or 'wc_provider_{siteHost}'
    entity_type: 'merchant',
    display_name: <fetched once from /shop GraphQL or /settings/general>,
    homepage: 'https://{storeDomain}',
    contact_email?: <env override or shop email>,
    domains: [storeDomain],
  },
  object_declarations: [{
    guaranteed_fields: [
      'ocp.commerce.product.core.v1#/title',
      'ocp.commerce.product.core.v1#/product_url',
      'ocp.commerce.price.v1#/currency',
      'ocp.commerce.price.v1#/amount',
    ],
    optional_fields: [
      'ocp.commerce.product.core.v1#/summary',
      'ocp.commerce.product.core.v1#/brand',
      'ocp.commerce.product.core.v1#/category',
      'ocp.commerce.product.core.v1#/sku',
      'ocp.commerce.product.core.v1#/image_urls',
      'ocp.commerce.inventory.v1#/availability_status',
      'ocp.commerce.inventory.v1#/quantity',
    ],
    sync: {
      preferred_capabilities: ['ocp.push.batch'],
      avoid_capabilities_unless_necessary: [],
      provider_endpoints: {
        webhook: { url: '{PUBLIC_BASE_URL}/webhooks/{shopify|woocommerce}' },
      },
    },
  }],
}
```

## 4. Sync Capabilities & Modes

We declare `ocp.push.batch` as the preferred capability; the merchant platform
itself is the read source. Five concrete operations exposed on each provider
app:

| Operation | Trigger | Endpoint | Behaviour |
|---|---|---|---|
| Full sync | manual or first-time | `POST /admin/sync/full` | List all products, paginate, push in ≤25-per-batch chunks. |
| Delta sync | scheduler (default off) or manual | `POST /admin/sync/delta` | List products updated since `last_synced_at`, push. Update cursor on success. |
| Single sync | API call | `POST /admin/sync/one/:productId` | Fetch one product, push. |
| Webhook ingest | merchant platform | `POST /webhooks/shopify` / `POST /webhooks/woocommerce` | HMAC verify → fetch the product from API (canonical) → single sync. Returns 200 quickly, sync runs synchronously inside the request to keep MVP simple; can be queued later. |
| Status | UI / ops | `GET /admin/status` | Returns active `registration_version`, `last_synced_at`, last run summary. |

### 4.1 Tombstone for deletes

`product.deleted` (Shopify) / `product.deleted` (WC) webhooks are mapped to a
"sync inactive" call: we synthesize a minimal `CommercialObject` with
`status: 'inactive'`. This is enough for the catalog to mark the entry stale
without us needing to keep a full delete API.

### 4.2 Inventory-only fast path (deferred)

Shopify `inventory_levels/update` and WC stock webhooks could trigger an
inventory-only pack push (without rebuilding the full object). The OCP
schema's `ObjectSyncRequest` accepts full objects only today, so the MVP
re-syncs the full object on inventory changes; we list this as a future
optimisation.

## 5. Authentication & Operational Model

### 5.1 Shopify

* Admin GraphQL API at `https://{shop}.myshopify.com/admin/api/2025-10/graphql.json`
* Header `X-Shopify-Access-Token: {token}`
* Token comes from a Shopify custom app (Partner Dashboard) — for the
  reference app, the operator generates a token in their dev store and sets
  `SHOPIFY_PROVIDER_ACCESS_TOKEN`.
* Webhook signature: `X-Shopify-Hmac-Sha256` (HMAC-SHA256 of raw body with
  the app's webhook secret). Header `X-Shopify-Topic`, `X-Shopify-Shop-Domain`.

### 5.2 WooCommerce

* REST API at `https://{site}/wp-json/wc/v3/products`
* Basic Auth: consumer key (`CK`) + consumer secret (`CS`), generated in
  WC Admin → Settings → Advanced → REST API.
* Webhook signature: `X-WC-Webhook-Signature` (base64 HMAC-SHA256). Header
  `X-WC-Webhook-Topic`, `X-WC-Webhook-Source`.

### 5.3 Mock mode

Both apps default to `*_MOCK=true`, in which case all upstream calls are
replaced by fixture JSON in `tests/fixtures/`. This lets unit tests and
local development work without any merchant credentials, matching the pattern
established by `alimama-catalog-api` and `shopify-catalog-api`.

## 6. Risks & Open Questions

1. **API version drift.** Shopify retires Admin API versions on a 12-month
   cadence. The app pins a single version constant and surfaces it in
   `GET /admin/status`; production deployments should bump it quarterly.
2. **Currency.** Both stores can be multi-currency. MVP reads the shop's
   default currency once and applies it to all `price.v1` packs. Multi-region
   pricing is a future extension.
3. **Variants.** As above, we collapse variants into a single
   `CommercialObject`. Catalogs that want per-variant search will need a
   future pack (e.g. `ocp.commerce.product.variant.v1`) plus mapper work.
4. **Rate limits.** Shopify Admin GraphQL uses a leaky-bucket cost system; WC
   has no formal limit but plugins like LiteSpeed cache may rate-limit. The
   apps add basic exponential backoff on 429/5xx. Production deployments may
   want a queue.
5. **Webhook reliability.** Shopify retries failed webhooks for up to 48h,
   then disables. The app must return 200 promptly. We do this by fetching
   the product from the API synchronously inside the webhook handler — fine
   for small stores; for thousands of skus a redis-backed worker queue
   should be added.
6. **Delete signal.** Tombstone via `status:'inactive'` is a soft delete; if
   a merchant truly removes a product, agents may still see an inactive
   entry for some time depending on catalog refresh policy.
7. **Storefront-only access.** WooCommerce sites without HTTPS or with
   plugins that strip Authorization headers need `?consumer_key=...&consumer_secret=...`
   in the query string. The app supports both styles via env flag.

## 7. Out of Scope (vs `docs/woocommerce_ocp_integration_design.md`)

These are intentionally **not** in this MVP:

* Plugin/app installation flow (Partner OAuth, WP plugin marketplace) — the
  reference apps assume the operator has already obtained credentials.
* Order/checkout/event-ledger — only product sync.
* Merchant-hosted catalog mode (the Woo design doc's §4.2) — handled via
  `shopify-catalog-api` style if needed.
* Visa VIC trust layer.

## 8. Verification Plan

1. Boot `commerce-catalog-api` (port 4000) and DB.
2. Boot `shopify-provider-app` with `SHOPIFY_PROVIDER_MOCK=true`.
3. `POST /admin/register` → expect `accepted_full` from catalog.
4. `POST /admin/sync/full` → expect all fixture products to land in catalog.
5. `POST /ocp/query { query: "<fixture title>" }` on the catalog → expect
   the merchant's products to be returned.
6. `POST /webhooks/shopify` with a signed mock payload → expect catalog
   single-object sync to succeed.
7. Repeat 2–6 for the WooCommerce app.
8. Optional: flip `SHOPIFY_PROVIDER_MOCK=false` with a real dev-store token
   and verify against the live Shopify Admin GraphQL API.
