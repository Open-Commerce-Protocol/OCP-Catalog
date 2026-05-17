# Alimama Provider Example

This package is an isolated example provider that syncs Alimama materials into an
OCP catalog and exposes provider-owned affiliate link resolution.

It intentionally does not extend the OCP schema with provider-specific action
bindings. The catalog objects keep Alimama metadata in attributes, while link
resolution stays behind the provider API.

## Run

```bash
bun install
bun run --cwd apps/examples/alimama-provider-api dev
```

Required local environment variables are listed in the repository `.env.example`
under the Alimama section. For local development, keep `ALIMAMA_MOCK=true`.

## Validate

```bash
bun run --cwd apps/examples/alimama-provider-api test
bun run --cwd apps/examples/alimama-provider-api typecheck
```
