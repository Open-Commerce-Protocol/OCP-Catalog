# CommercialObject

`CommercialObject` is the shared object envelope synchronized into the catalog.

## Goal

It gives the catalog a stable outer structure while leaving the domain-specific payload inside descriptor packs.

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "object_id",
    "object_type",
    "provider_id",
    "title",
    "descriptors"
  ]
}
```

## Descriptor Fragment

```json
{
  "descriptors": [
    {
      "pack_id": "ocp.commerce.product.core.v1",
      "schema_uri": "https://ocp.dev/schema/...",
      "data": {
        "title": "Wireless Noise Cancelling Headphones"
      }
    }
  ]
}
```

## Why Descriptors Exist

Instead of making one fixed product schema, `CommercialObject` lets packs carry domain detail.

That means the catalog can:

- validate packs individually
- project useful fields into an index
- preserve pack-level extensibility

## Repository Example

The demo commerce catalog projects pack data into catalog entries for:

- keyword search
- filter columns
- semantic embedding text
