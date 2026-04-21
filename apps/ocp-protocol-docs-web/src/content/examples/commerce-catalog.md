# Commerce Catalog Example

This repository implements one concrete catalog scenario: a commerce product catalog.

## Catalog Profile

The current catalog profile is shaped around:

- `product`
- one main product-search capability
- `query_packs` as the primary search contract
- English-first content with language hints in metadata
- one live provider-facing sync capability: `ocp.push.batch`

## Current ObjectContract

The current commerce catalog accepts one object contract:

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title"
  ],
  "optional_fields": [
    "ocp.commerce.price.v1#/amount",
    "ocp.commerce.inventory.v1#/availability_status"
  ],
  "additional_fields_policy": "allow"
}
```

This is the actual contract boundary the provider must satisfy.

## Minimal Registration Success Conditions

For the current repository, a provider can register successfully only if it can declare:

- `guaranteed_fields` includes `ocp.commerce.product.core.v1#/title`
- `sync.preferred_capabilities` or `sync.avoid_capabilities_unless_necessary` intersects with the catalog's `sync_capabilities`

The protocol handshake itself does not require the provider to declare `object_type` for that match.

In practice, the provider usually also declares:

- `ocp.commerce.price.v1`
- `ocp.commerce.inventory.v1`

because those packs improve filtering, ranking, display, and resolve behavior.

## Current Published Sync Capability

The current live manifest publishes:

```json
{
  "capability_id": "ocp.push.batch",
  "direction": "provider_to_catalog",
  "transport": "http_push",
  "sync_model": {
    "snapshot": true,
    "delta": false,
    "stream": false
  },
  "mutation_semantics": {
    "upsert": true,
    "delete": true
  }
}
```

## Current Sync Path In This Repository

The verified interaction is:

```text
ProviderRegistration.sync.preferred_capabilities = ["ocp.push.batch"]
  -> provider registers
  -> RegistrationResult.selected_sync_capability = ocp.push.batch
  -> provider sends batched object sync requests
```

Reserved capabilities such as `ocp.feed.url` belong in the runtime manifest only after the matching pull implementation exists.

## Indexing Strategy

The commerce catalog currently uses a layered index:

1. descriptor projection into catalog entries
2. structured filter columns in Postgres
3. normalized search text for keyword search
4. embedding vectors for semantic search
5. `pgvector` HNSW shortlist plus exact cosine rerank

## Why This Matters

The protocol documents the shape of the catalog, but the example catalog also shows how a real implementation can expose:

- language hints
- semantic capability hints
- filterable field hints
- resolve support
- concrete object-contract requirements for provider registration
- explicit sync capability negotiation instead of a flat delivery-mode enum
