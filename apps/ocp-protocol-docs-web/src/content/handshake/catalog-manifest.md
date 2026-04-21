# CatalogManifest

`CatalogManifest` is the catalog's public handshake document.

## What It Declares

It tells a provider or agent:

- who the catalog is
- which endpoints are public
- which object contracts it accepts
- which query capabilities it exposes
- which provider fields it requires
- which sync capabilities it is willing to negotiate with providers

## Endpoint Shape

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

## Provider Contract Shape

`provider_contract` includes two formal surfaces:

- `field_rules`
- `sync_capabilities`

Example:

```json
{
  "provider_contract": {
    "field_rules": [
      {
        "field_ref": "provider#/display_name",
        "requirement": "required"
      }
    ],
    "sync_capabilities": [
      {
        "capability_id": "ocp.push.batch",
        "direction": "provider_to_catalog",
        "transport": "http_push",
        "object_types": ["product"],
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
    ]
  }
}
```

## Search Contract Shape

The search contract is expressed through `query_capabilities[*].query_packs`.

```json
{
  "query_capabilities": [
    {
      "capability_id": "ocp.commerce.product.search.v1",
      "query_packs": [
        {
          "pack_id": "ocp.commerce.product.search.v1",
          "query_modes": ["keyword", "filter", "semantic", "hybrid"]
        }
      ]
    }
  ]
}
```

`target_object_types` may appear as a catalog-authored hint, but it is not the main protocol axis for query negotiation.

The protocol only requires the catalog to declare:

- which query endpoints exist
- which query capabilities exist
- which input fields are accepted
- which fields are searchable, filterable, or sortable
- where the request schema lives

## Runtime Example

The commerce catalog example publishes one provider-facing sync capability:

- `ocp.push.batch`

Reserved capabilities such as `ocp.feed.url` belong in the runtime manifest only when the corresponding transport path is implemented.
