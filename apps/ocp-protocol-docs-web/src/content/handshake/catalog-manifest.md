# CatalogManifest

`CatalogManifest` is the catalog's public handshake document.

## When It Is Used

Providers and agents read the manifest to understand:

- who the catalog is
- where its endpoints are
- what object types it accepts
- what search capability it exposes

## Required Fields

Key required fields in the current schema:

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "catalog_id",
    "catalog_name",
    "endpoints",
    "query_capabilities",
    "provider_contract",
    "object_contracts"
  ]
}
```

## Endpoint Fragment

```json
{
  "endpoints": {
    "query": { "url": "https://catalog.example/query" },
    "resolve": { "url": "https://catalog.example/resolve" },
    "provider_registration": { "url": "https://catalog.example/providers/register" },
    "contracts": { "url": "https://catalog.example/contracts" },
    "object_sync": { "url": "https://catalog.example/object-sync" }
  }
}
```

## Query Capability Fragment

```json
{
  "query_capabilities": [
    {
      "capability_id": "commerce_product_search",
      "name": "Commerce Product Search",
      "target_object_types": ["commerce.product"],
      "query_packs": [
        {
          "pack_id": "ocp.commerce.product.search.v1",
          "description": "Search products by keyword and filters",
          "query_modes": ["keyword", "filter", "semantic", "hybrid"],
          "request_schema_uri": "https://ocp.dev/schema/...",
          "metadata": {
            "query_hints": {
              "supported_query_languages": ["en"],
              "filter_fields": [
                "ocp.commerce.inventory.v1#/availability_status",
                "ocp.commerce.price.v1#/currency"
              ]
            }
          }
        }
      ]
    }
  ]
}
```

## Why Query Packs Matter

The manifest should tell the agent how to search through `query_packs`, not through a loose textual description.

That gives the agent:

- a stable pack identifier
- request schema linkage
- optional execution hints

## Repository Example

In this repository, the commerce catalog uses one primary capability for product search and exposes language and semantic hints through `metadata`.
