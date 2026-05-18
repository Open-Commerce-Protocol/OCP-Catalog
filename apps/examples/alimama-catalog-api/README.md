# Alimama Affiliate Catalog Example

This package is an OCP Catalog Node example for affiliate/commission commerce.
It treats Alimama/Taobao Union as a queryable and resolvable commercial object
directory:

- `/ocp/query` forwards keyword/filter requests to the Alimama material API in
  real time and returns Catalog entries.
- `/ocp/resolve` mints PID-attributed purchase actions with the Alimama
  privilege API and returns OCP `ActionBinding` objects.
- Products are not synced into another Catalog and are not persisted before
  query.
- Provider registration and object sync are intentionally absent from the
  manifest.

Operational order/commission polling remains under `/admin/*` as an internal
tool protected by `x-admin-key`; it is not part of the OCP Provider flow.

## Endpoints

- `GET /.well-known/ocp-catalog`
- `GET /ocp/manifest`
- `GET /ocp/health`
- `GET /ocp/contracts`
- `POST /ocp/query`
- `POST /ocp/resolve`
- `POST /admin/probe-query`
- `POST /admin/sync-orders`
- `GET /admin/stats`
- `GET /admin/ledger`

## Run

```bash
bun install
bun run --cwd apps/examples/alimama-catalog-api dev
```

Required local environment variables are listed in the repository `.env.example`
under the Alimama affiliate Catalog Node section. For local development, keep
`ALIMAMA_MOCK=true`.

## Validate

```bash
bun run --cwd apps/examples/alimama-catalog-api test
bun run --cwd apps/examples/alimama-catalog-api typecheck
```
