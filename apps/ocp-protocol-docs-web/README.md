# OCP Protocol Docs Web

This app is the protocol documentation site for the OCP Catalog demo workspace.

## Purpose

It provides a three-column documentation experience for:

- OCP Catalog overview and roles
- `ocp.catalog.handshake.v1`
- `ocp.catalog.registration.v1`
- example flows and implementation notes

## Content Model

Markdown content lives under [`src/content`](./src/content):

- `docs/` for top-level protocol pages.
- `handshake/` for `ocp.catalog.handshake.v1` pages.
- `registration/` for `ocp.catalog.registration.v1` pages.
- `examples/` for scenario walkthroughs and runtime flows.
- `knowledge/` for concept-oriented OCP knowledge-base pages.
- `locales/zh/` for the Chinese mirror of the same route tree.

The left navigation defines the canonical route structure in
[`src/content/navigation.ts`](./src/content/navigation.ts).

The rendered site intentionally has its own user-facing Markdown. Formal
protocol and architecture source documents live under the repository root
[`docs`](../../docs):

- `docs/specs/` for stable protocol specifications.
- `docs/architecture/` for system and repository architecture.
- `docs/integrations/` for scenario and platform integration designs.
- `docs/archive/` for superseded planning material.

Keep these layers aligned through review and integrity checks; do not add a
second untracked copy of protocol truth in the site.

## Development

From the repository root:

```bash
bun run protocol:docs
```

Or from this app directly:

```bash
bun run dev
```

## Current behavior

- routes are markdown-driven
- right-side table of contents is generated from page headings
- top search is a local navigation filter, not a full-text index

## Integrity

Run the docs integrity check from the repository root before changing route
structure or artifacts:

```bash
bun run docs:check
```
