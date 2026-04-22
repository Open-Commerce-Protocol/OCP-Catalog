# OCP Protocol Docs Web

This app is the protocol documentation site for the OCP Catalog demo workspace.

## Purpose

It provides a three-column documentation experience for:

- OCP Catalog overview and roles
- `ocp.catalog.handshake.v1`
- `ocp.catalog.center.v1`
- example flows and implementation notes

## Content model

Markdown content lives under [`src/content`](./src/content):

- `docs/` for top-level protocol pages
- `handshake/` for handshake-specific pages
- `center/` for center-specific pages
- `examples/` for scenario walkthroughs
- `pages/` for extra standalone sections

The left navigation defines the canonical route structure in
[`src/content/navigation.ts`](./src/content/navigation.ts).

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

## Next likely work

- add the missing handshake, center, and example markdown pages
- wire schema snippets and example payload blocks into content
- add a richer search index when the content set grows
