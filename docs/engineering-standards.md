# Engineering Standards

This repository is now a protocol-first OCP Catalog v2 codebase. The old public demo loop has been removed.

## Current Product Direction

- Treat `docs/ocp_catalog_registration_protocol_v1.md` as the source of truth for the OCP Catalog Registration node / Catalog Registry handshake.
- Treat `docs/ocp_catalog_handshake_protocol_v1.md` as the source of truth for the Provider -> Catalog Node handshake.
- Treat `docs/design_v2.md` as the object-centric architecture direction.
- Treat `ocp.catalog.handshake.v1/` as the concrete JSON Schema package.
- Do not call a single Catalog Node implementation an OCP Catalog Registration node. A Catalog Node indexes commercial objects. An OCP Catalog Registration node indexes Catalog nodes.
- Do not reintroduce Offer / ItemReference as top-level system centers. Product offers may be represented as `CommercialObject` instances with `object_type = "product"`.

## Implementation Rules

- Keep Catalog registration and Provider registration separate.
- Keep registration and object sync separate.
- Registration node-level search returns Catalog profiles and route hints. Catalog-level search returns CommercialObject/CatalogEntry results.
- OCP Catalog Registration node must not default to syncing full object databases from registered Catalogs. It should index profiles, contracts, query capabilities, trust metadata, and route hints first.
- Keep Query and Resolve as protocol endpoints, but do not freeze their full payload schemas until the v2 core model is stable.
- Prefer typed schema validation at API boundaries.
- Store raw protocol payloads separately from normalized projections when persistence is implemented.
- Catalog Node persistence work should target `commercial_objects`, `descriptor_instances`, `catalog_entries`, and `resolvable_references`.
- OCP Catalog Registration node persistence work should target `registered_catalogs`, `catalog_registration_records`, `catalog_manifest_snapshots`, `catalog_index_entries`, `catalog_verification_records`, `catalog_health_checks`, and `catalog_search_audit_records`.

## Local Checks

Use these checks while rebuilding the v2 core:

```bash
bun run typecheck
bun run build
bun run test
```
