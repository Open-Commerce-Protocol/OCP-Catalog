# Shopify Public App (App Store form) — OCP Provider

Implementation: `apps/examples/shopify-app/`.

This is the **public / App Store** form of the Shopify → OCP Provider
integration. It is multi-tenant: a single deployed process serves every
merchant who installs the app. Compare the three forms:

| Form | App | Tenancy | Token source | Merchant install |
|---|---|---|---|---|
| Custom app | `shopify-provider-app` | single | `SHOPIFY_PROVIDER_ACCESS_TOKEN` env | 8 manual steps in their admin |
| Public app | `shopify-app` (this) | multi | OAuth per shop → Postgres | one-click from App Store |

## Architecture

```
                       ┌──────────────────────────────────────────────┐
   merchant clicks     │  shopify-app  (one process, all merchants)    │
   "Install"           │  port 4420                                    │
        │              │                                               │
        ▼              │  GET  /auth            → 302 authorize         │
  Shopify OAuth ──────▶│  GET  /auth/callback   → verify hmac+state,    │
                       │                          code→token,          │
                       │                          store install,       │
                       │                          subscribe webhooks,  │
                       │                          register + full sync  │
   product edits ─────▶│  POST /webhooks/products            → sync     │
   uninstall ─────────▶│  POST /webhooks/app/uninstalled     → purge    │
   GDPR ──────────────▶│  POST /webhooks/compliance/*        → erase    │
                       │                                               │
                       │  installations: Postgres shopify_app_installations
                       └───────────────────────┬───────────────────────┘
                                                │ per-shop ProviderRegistration + ObjectSync
                                                ▼
                                   OCP Catalog (commerce-catalog-api)
```

Each shop becomes its own OCP Provider, `provider_id = shopify_app_<shop>`.

## Two HMAC schemes

Shopify uses two different HMAC encodings; mixing them up is the classic bug.

| Where | Input | Encoding | Key | Code |
|---|---|---|---|---|
| OAuth callback / App Bridge query | sorted `k=v&…` query string (minus `hmac`) | **hex** | app secret | `src/oauth/hmac.ts` |
| Webhook delivery | raw request body bytes | **base64** in `X-Shopify-Hmac-Sha256` | app secret | `src/shopify/webhook-verify.ts` |

## OAuth flow (authorization-code grant)

1. `GET /auth?shop=foo.myshopify.com` → validate the shop is a real
   `*.myshopify.com`, mint a `state` nonce, 302 to
   `https://{shop}/admin/oauth/authorize?client_id=…&scope=…&redirect_uri=…&state=…`.
2. Merchant approves the scopes.
3. Shopify redirects to `GET /auth/callback?code&hmac&shop&state&timestamp`.
   We verify the **query HMAC (hex)**, check the `state` nonce, then
   `POST https://{shop}/admin/oauth/access_token { client_id, client_secret, code }`
   → `{ access_token, scope }`.
4. Persist the install (`shopify_app_installations`), subscribe webhooks,
   register the shop as an OCP provider, run a first full sync, and 302 into
   the embedded app UI (`GET /app`).

## Mandatory App Store requirements implemented

- `app/uninstalled` webhook → purge the stored token, mark `uninstalled`. (The
  token is already dead when this fires, so we make no API calls.)
- The three GDPR webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`). This app stores no customer PII, so the first two are no-ops
  that return 200; `shop/redact` hard-deletes the shop's install row.
- All webhooks verify HMAC before acting; product webhooks return a retryable
  `503` on downstream failure so Shopify re-delivers.
- `shopify.app.toml` declares scopes, redirect URL, and all webhook topics.

Still required before an actual App Store submission (out of scope for this
reference backend): a full embedded **Polaris + App Bridge** React UI, the app
listing assets (icon, screenshots, screencast), and passing Built-for-Shopify
performance checks.

---

## How a merchant adds this app

### A. One-time: you (the app developer) create the app

1. Go to [partners.shopify.com](https://partners.shopify.com) → **Apps → Create app → Create app manually**.
2. Note the **Client ID** (API key) and **Client secret** (API secret).
3. Deploy `shopify-app` somewhere with a public HTTPS URL (prod domain, or an
   ngrok/cloudflared tunnel in dev). Set:
   ```
   SHOPIFY_APP_MOCK=false
   SHOPIFY_APP_API_KEY=<client id>
   SHOPIFY_APP_API_SECRET=<client secret>
   SHOPIFY_APP_URL=https://your-public-url
   ```
4. Edit `apps/examples/shopify-app/shopify.app.toml` — set `client_id`,
   `application_url`, the `redirect_urls`, and the webhook URIs to your public
   URL. Then `shopify app deploy` (Shopify CLI) to register the config, or set
   the same values by hand in the Partner Dashboard:
   - **App setup → URLs**: App URL = `https://your-public-url/app`,
     Allowed redirection URL = `https://your-public-url/auth/callback`.
   - **App setup → Webhooks / compliance topics**: point them at
     `https://your-public-url/webhooks/...` as listed in the toml.
   - **API access scopes**: `read_products, read_inventory, read_locations,
     read_product_listings`.
5. (For App Store distribution) create an App listing and submit for review.
   Until approved, the app is installable via its **install link** on any dev
   store, or distributed as a custom app to specific stores.

### B. The merchant installs it

**From the App Store (once published):**
1. Merchant searches the Shopify App Store for the app, clicks **Add app**.
2. Shopify shows the permission/scope consent screen → merchant clicks
   **Install**.
3. Shopify hits `/auth/callback`; the app stores the token, subscribes
   webhooks, registers the store as an OCP provider, and runs the first sync.
4. Merchant lands on the embedded app page showing sync status. Done — from
   here products sync automatically on every change.

**Before publishing (dev/preview):** open the install link
`https://your-public-url/auth?shop=THEIR-STORE.myshopify.com` (or use the
"Test your app → Select store" button in the Partner Dashboard). The rest is
identical.

### What the merchant does NOT have to do

No manual token creation, no API keys, no config files — unlike the custom-app
form. One click and their catalogue is in OCP.

## Local verification without a public tunnel

OAuth's redirect inherently needs a browser + public URL, but the entire
post-OAuth path (token storage → register → sync → webhooks → uninstall →
GDPR erase) is exercisable locally by seeding a token directly:

```bash
bun run commerce:catalog:api        # catalog on :4000
bun run shopify:app                 # app on :4420 (SHOPIFY_APP_MOCK=true for fixtures)
bun run validate:shopify-app-e2e    # seed → register → full sync → query → delta → uninstall
```

With a real (non-expired) custom-app or OAuth token you can run the same path
against a live store:

```bash
SHOPIFY_APP_MOCK=false SHOPIFY_APP_API_KEY=… SHOPIFY_APP_API_SECRET=… bun run shopify:app
# then:
curl -XPOST localhost:4420/admin/installations/seed -H 'x-admin-key: …' \
  -d '{"shop_domain":"store.myshopify.com","access_token":"shpat_…"}'
curl -XPOST localhost:4420/admin/register/store.myshopify.com -H 'x-admin-key: …'
curl -XPOST localhost:4420/admin/sync/full/store.myshopify.com -H 'x-admin-key: …'
```
