# OCP Catalog Docs

This directory is the repository-level documentation source. It is deliberately
split by responsibility instead of keeping every markdown file at the root.

## Source Of Truth

Use this order when protocol descriptions conflict:

1. [Registration v1](./specs/registration/v1.md) defines how a Catalog Node registers with an OCP Catalog Registration node and how agents discover Catalog route hints.
2. [Handshake v1](./specs/handshake/v1.md) defines how a Provider registers with a Catalog Node and how object sync is negotiated.
3. [System Design](./architecture/system-design.md) defines the long-term OCP Catalog role model, protocol boundaries, object model, Search/Resolve split, governance, and federation direction.
4. [Repository Architecture](./architecture/repo-architecture.md) and [Engineering Standards](./architecture/engineering-standards.md) define implementation boundaries for this codebase.

Archived material is background only. Do not use archived roadmaps or plans as
current field, endpoint, or schema authority.

## Directory Map

- `specs/`: stable protocol specifications.
- `architecture/`: system architecture and engineering governance.
- `integrations/`: platform and scenario integration designs.
- `reference-agents/`: reference agent designs.
- `agent-guides/`: agent-facing usage material and skill references.
- `archive/`: superseded planning and design material.

## Protocol Notes

- Registration and Handshake are separate protocols. Registration selects which
  Catalog to ask; Handshake defines how Provider data enters a Catalog.
- Registration `resolve` returns a `CatalogRouteHint`. Catalog `resolve` returns
  a `ResolvableReference`.
- `CatalogRouteHint` is a compact routing, trust, health, and cache summary. The
  full capability truth remains in the Catalog manifest.
- Search returns CatalogEntry-like projections. `CommercialObject` is the sync
  envelope, not the search result itself.
