# @ocp-catalog/center-core

Core services for the OCP Center / Catalog Registry.

This package implements the `Catalog Node -> OCP Center` side of the system:

- Center discovery and manifest.
- Catalog registration intake.
- Catalog `.well-known/ocp-catalog` and `CatalogManifest` fetch.
- Catalog profile snapshot and index entry creation.
- Catalog search and route hint resolution.

It does not implement Provider object sync. That remains in `@ocp-catalog/catalog-core`.
