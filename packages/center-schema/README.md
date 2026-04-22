# @ocp-catalog/center-schema

TypeScript and Zod schema package for `ocp.catalog.center.v1`.

This package models the `Catalog Node -> OCP Center` handshake:

```text
CatalogRegistration
CatalogRegistrationResult
CatalogProfileSnapshot
CatalogIndexEntry
CatalogSearchRequest
CatalogSearchResult
CatalogRouteHint
```

It is intentionally separate from `@ocp-catalog/ocp-schema`, which models the `Provider -> Catalog Node` handshake.
