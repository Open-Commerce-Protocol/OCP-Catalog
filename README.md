# OCP Catalog

The **Open Commerce Protocol (OCP) Catalog** — the protocol specification, its
schema/client packages, the CLI, and minimal reference implementations.

An OCP Catalog Node exposes a small HTTP surface that lets AI agents discover,
query, and resolve commercial objects (products, offers, suppliers, …) across
independent catalogs, with a separate Registration layer for discovery and a
Handshake layer for how providers feed data into a catalog.

## What's in this repo

```text
docs/specs/                     Protocol specifications
  registration/v1.md              How a Catalog registers with a Registration node
  handshake/v1.md                 How a Provider registers + syncs into a Catalog
ocp.catalog.registration.v1/    Machine-readable JSON Schemas (registration)
ocp.catalog.handshake.v1/       Machine-readable JSON Schemas (handshake)

packages/
  ocp-schema/                   Zod schemas: manifest, query, resolve, objects, health
  registration-schema/          Zod schemas for the registration protocol
  ocp-activity-schema/          Zod schemas for catalog activity events
  ocp-client/                   Typed client helpers + validators
  shared/                       Small shared utilities
  webmcp-adapter/               WebMCP adapter for browser tools
  ocp-cli/                      `ocp` CLI (published to npm)

examples/
  typescript/  python/  go/     Minimal, spec-valid Catalog Nodes (~3 in-memory products)

apps/ocp-site-web/              The OCP protocol website + docs
skills/                         Agent skill bundled by the CLI
```

The published protocol packages (npm, scope `@ocp-catalog`):
[`ocp-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-schema),
[`registration-schema`](https://www.npmjs.com/package/@ocp-catalog/registration-schema),
[`ocp-activity-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-activity-schema),
[`ocp-client`](https://www.npmjs.com/package/@ocp-catalog/ocp-client),
[`shared`](https://www.npmjs.com/package/@ocp-catalog/shared),
[`webmcp-adapter`](https://www.npmjs.com/package/@ocp-catalog/webmcp-adapter),
[`ocp-cli`](https://www.npmjs.com/package/@ocp-catalog/ocp-cli).

## Reference applications

The production-grade catalog nodes, provider apps, admin UIs, the MCP server,
the skill gateway, demos, and deploy tooling live in a separate repo:

**[Open-Commerce-Protocol/ocp-catalog-instances](https://github.com/Open-Commerce-Protocol/ocp-catalog-instances)**

It depends on the protocol packages above from npm.

> The full pre-split monorepo history (all applications) is preserved on the
> [`legacy-monorepo`](https://github.com/Open-Commerce-Protocol/OCP-Catalog/tree/legacy-monorepo)
> branch and the `pre-split-monorepo` tag.

## A minimal Catalog Node

A spec-valid Catalog Node answers five endpoints. See
[`examples/`](./examples) for complete implementations in TypeScript, Python, and Go.

| Method | Path | Returns |
|---|---|---|
| GET | `/.well-known/ocp-catalog` | discovery |
| GET | `/ocp/manifest` | capabilities + query packs |
| GET | `/ocp/health` | liveness |
| POST | `/ocp/query` | search entries |
| POST | `/ocp/resolve` | resolve an entry into action bindings |

## Develop

```bash
bun install
bun run typecheck
bun test
bun run build          # build the packages + site
bun run site:dev       # run the protocol website
```

Requires Bun 1.3+. The minimal examples each have their own README under
[`examples/`](./examples).

## Documentation

- [Registration v1 spec](./docs/specs/registration/v1.md)
- [Handshake v1 spec](./docs/specs/handshake/v1.md)
- [docs/README.md](./docs/README.md)

## License

MIT — see [LICENSE](./LICENSE).
