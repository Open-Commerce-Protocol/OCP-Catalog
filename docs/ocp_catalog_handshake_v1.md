# OCP Catalog Handshake v1 Package

The concrete schema package lives at:

```text
ocp.catalog.handshake.v1/
```

The package is derived from the formal protocol draft in `docs/ocp_catalog_handshake_protocol_v1.md` and freezes the minimal handshake boundary for Catalog and Provider interoperability.

## Package Contents

```text
ocp.catalog.handshake.v1/
├── package.json
├── common.schema.json
├── catalog-manifest.schema.json
├── object-contract.schema.json
├── provider-registration.schema.json
├── commercial-object.schema.json
├── registration-result.schema.json
├── pack.ocp.commerce.product.core.v1.schema.json
├── pack.ocp.commerce.price.v1.schema.json
└── pack.ocp.commerce.inventory.v1.schema.json
```

## Protocol Boundary

This package includes:

- Catalog discovery and capability declaration through `CatalogManifest`.
- Provider contract creation and updates through `ProviderRegistration`.
- Object type requirements through `ObjectContract`.
- Structured provider registration outcomes through `RegistrationResult`.
- A shared `CommercialObject` envelope for object sync APIs.
- Common field addressing through `field_ref`.
- Product, price, and inventory descriptor pack schemas.

This package is for the `Provider -> Catalog Node` handshake only.

It does not define how a Catalog Node registers with an OCP Center. Catalog registration, Catalog profile indexing, Catalog search, Catalog verification, and route hints are specified separately in:

```text
docs/ocp_catalog_center_protocol_v1.md
```

This package does not freeze:

- Full object sync request and response schemas.
- Full query request and response schemas.
- Full resolve request and response schemas.
- Auth, payment, fulfillment, federation, OMS, ATS, or checkout protocols.

`object_sync`, `query`, and `resolve` remain required endpoints in `CatalogManifest`, while their payload schemas should be versioned separately when ready.
