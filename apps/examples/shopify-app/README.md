# Shopify Public App (App Store form) — OCP Provider

A **multi-tenant** Shopify app: one process serves every merchant that installs
it. On install it runs OAuth, stores the shop's offline access token encrypted
in Postgres, queues provider registration + first sync, and then syncs product
changes into the OCP Catalog from durable jobs.

This is **form 3** (App Store / public app). Compare:

| App | Form | Tenancy | Token source |
|---|---|---|---|
| `shopify-provider-app` | custom app | single | `SHOPIFY_PROVIDER_ACCESS_TOKEN` env |
| `shopify-app` (this) | public app | multi | OAuth per shop → Postgres |

## Endpoints

| Route | Purpose |
|---|---|
| `GET /auth?shop=…` | Start OAuth — redirect to Shopify authorize |
| `GET /auth/callback` | Verify HMAC + durable state, exchange code→token, persist install, queue register + first sync |
| `GET /app?shop=…` | Embedded landing (App Bridge bootstrap; minimal here) |
| `POST /webhooks/products` | HMAC verify + idempotently queue product sync/tombstone by webhook id |
| `POST /webhooks/app/uninstalled` | queue Catalog deactivation + token purge |
| `POST /webhooks/compliance/{customers-data-request,customers-redact,shop-redact}` | mandatory GDPR webhooks; shop-redact queues Catalog erase |
| `GET /admin/installations` | (x-admin-key) list installs |
| `GET /admin/status/:shop` | (x-admin-key) per-shop state |
| `POST /admin/installations/seed` | (x-admin-key) seed a token without OAuth (custom-app token / tests) |
| `POST /admin/register/:shop`, `/admin/sync/full/:shop`, `/admin/sync/delta/:shop` | (x-admin-key) ops triggers |

## Two HMAC schemes (don't confuse them)

- **OAuth callback / App Bridge**: HMAC-SHA256 over the *sorted query string*,
  **hex**, key = app secret → `src/oauth/hmac.ts`.
- **Webhook delivery**: HMAC-SHA256 over the *raw body*, **base64**, in the
  `X-Shopify-Hmac-Sha256` header → `src/shopify/webhook-verify.ts`.

## Run (mock, no credentials)

```bash
bun run shopify:app   # SHOPIFY_APP_MOCK defaults to false in env; set true for fixtures
```

For local development with fixtures: `SHOPIFY_APP_MOCK=true bun run shopify:app`.

## Run against a real store

You need: a Shopify Partner app (Client ID + Secret), a public HTTPS URL
(ngrok/cloudflared), `SHOPIFY_APP_MOCK=false`, and a real
`SHOPIFY_APP_TOKEN_ENCRYPTION_KEY`. See the repo design doc
`docs/integrations/shopify-app-store.md` for the full install walkthrough.

Without a public tunnel you can still exercise the full sync path by seeding a
known token (e.g. a custom-app token) via `POST /admin/installations/seed`,
then `POST /admin/register/:shop` + `POST /admin/sync/full/:shop`.

## Validate

```bash
bun run --cwd apps/examples/shopify-app test    # unit: oauth, hmac, webhook, worker, mapper
bun run validate:shopify-app-e2e                # E2E vs commerce-catalog-api (mock or seeded real token)
```
