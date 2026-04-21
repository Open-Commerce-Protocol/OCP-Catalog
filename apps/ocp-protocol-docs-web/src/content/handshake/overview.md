# Handshake Overview

`ocp.catalog.handshake.v1` is the minimal handshake layer between a Provider and a Catalog node.

## What It Covers

The handshake package defines:

- catalog manifest discovery
- object contracts
- provider registration
- shared commercial object envelope
- registration feedback

## What It Does Not Cover

This package does **not** freeze:

- object sync request envelopes
- catalog query request envelopes
- resolve request envelopes
- Center registration

Those concerns live elsewhere in the repository runtime and may later split into dedicated protocol packages.

## Core Questions

The handshake layer answers three questions:

1. What kind of catalog is this?
2. What objects can it accept?
3. How does a provider declare its supply capability?

## Package Surface

```text
CatalogManifest
ObjectContract
ProviderRegistration
CommercialObject
RegistrationResult
FieldRef
FieldRule
```

## Example Handshake Flow

```text
GET /.well-known/ocp-catalog
-> fetch manifest
-> inspect contracts
-> POST provider registration
-> receive registration result
-> start object sync
```

## Search Capability Shape

Inside `CatalogManifest`, the main search contract is expressed through `query_packs`.

```json
{
  "capability_id": "commerce_product_search",
  "target_object_types": ["commerce.product"],
  "query_packs": [
    {
      "pack_id": "ocp.commerce.product.search.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"],
          "content_languages": ["en"]
        }
      }
    }
  ]
}
```

That structure is intentional:

- `query_packs` define how an agent should search
- `query_modes` stay attached to a pack
- extra hints live in `metadata`
