# ObjectContract

`ObjectContract` defines what a catalog is willing to accept for a given object type.

## What It Controls

An object contract expresses:

- the `object_type`
- required and optional descriptor packs
- field validation rules
- allowed registration modes

## Schema Fragment

```json
{
  "required": ["contract_id", "object_type", "field_rules"],
  "properties": {
    "required_packs": { "type": "array" },
    "optional_packs": { "type": "array" },
    "compatible_packs": { "type": "object" },
    "registration_modes": {
      "type": "array",
      "items": {
        "enum": ["feed_url", "api_pull", "push_api"]
      }
    },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    }
  }
}
```

## Practical Meaning

The object contract is how the catalog keeps provider input bounded.

For example, a commerce product contract can require:

- core product pack
- price pack
- inventory pack

and reject registrations that cannot guarantee required fields.

## Field Rules

Field rules point at concrete fields using `FieldRef`.

Examples:

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

This lets the contract talk about validation without hard-coding one giant object schema.
