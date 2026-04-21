# ProviderRegistration

`ProviderRegistration` is the provider's versioned declaration of what it can supply to a catalog.

## When It Is Submitted

A provider submits a registration:

- before object sync starts
- whenever its declared capability changes
- whenever it needs to increase the registration version

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "catalog_id",
    "provider",
    "registration_version",
    "updated_at",
    "object_declarations"
  ]
}
```

## Provider Fragment

```json
{
  "provider": {
    "provider_id": "commerce_provider_local_dev",
    "entity_type": "merchant",
    "display_name": "Commerce Provider Local Dev",
    "homepage": "https://provider.example"
  }
}
```

## Object Declaration Fragment

```json
{
  "object_declarations": [
    {
      "object_type": "commerce.product",
      "provided_packs": [
        "ocp.commerce.product.core.v1",
        "ocp.commerce.price.v1",
        "ocp.commerce.inventory.v1"
      ],
      "guaranteed_fields": [
        "ocp.commerce.product.core.v1#/title",
        "ocp.commerce.price.v1#/amount"
      ],
      "delivery": {
        "mode": "push_api"
      }
    }
  ]
}
```

## Version Rule

For one `catalog_id + provider_id` pair:

- the provider sends a complete new registration document
- the new document must increase `registration_version`
- the catalog uses that version to decide which declaration is active

This versioned shape is what allowed the current repository to enforce correct registration-before-sync behavior.
