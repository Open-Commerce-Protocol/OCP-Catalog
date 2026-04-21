# ObjectContract

`ObjectContract` defines the field-level acceptance boundary published by a catalog.

## What It Controls

An object contract expresses:

- required field requirements
- optional field references
- additional field policy

## Schema Fragment

```json
{
  "required": ["required_fields"],
  "properties": {
    "required_fields": { "type": "array" },
    "optional_fields": { "type": "array" },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    }
  }
}
```

## Required Field Groups

Each entry in `required_fields` is either:

- a single `FieldRef`
- an array of `FieldRef` values meaning "at least one of these fields must be guaranteed"

Example:

```json
[
  "ocp.commerce.product.core.v1#/title",
  [
    "ocp.commerce.price.v1#/amount",
    "provider#/price_text"
  ]
]
```

## Field References

Field references point at concrete fields using `FieldRef`.

Examples:

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

This keeps compatibility checks directly on fields instead of requiring provider-facing pack negotiation.

## Current Commerce Contract In This Repository

The first catalog in this repository currently exposes this contract:

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title",
    "ocp.commerce.price.v1#/currency",
    "ocp.commerce.price.v1#/amount"
  ],
  "optional_fields": [
    "ocp.commerce.product.core.v1#/summary",
    "ocp.commerce.product.core.v1#/brand",
    "ocp.commerce.product.core.v1#/category",
    "ocp.commerce.product.core.v1#/sku",
    "ocp.commerce.product.core.v1#/product_url",
    "ocp.commerce.product.core.v1#/image_urls",
    "ocp.commerce.inventory.v1#/availability_status",
    "ocp.commerce.inventory.v1#/quantity"
  ],
  "additional_fields_policy": "allow"
}
```

The minimum registration condition is therefore:

- guarantee `ocp.commerce.product.core.v1#/title`
- guarantee `ocp.commerce.price.v1#/currency`
- guarantee `ocp.commerce.price.v1#/amount`

The current provider example in this repository declares an even stronger baseline by also guaranteeing `ocp.commerce.product.core.v1#/product_url`.

That is an implementation choice, not a protocol requirement. The catalog publishes the minimum it needs for commerce indexing, while the provider can still promise a richer payload.

Sync transport is negotiated separately through `sync_capabilities`, not through `ObjectContract`.
