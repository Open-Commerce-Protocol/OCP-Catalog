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
    "health": { "url": "https://catalog.example/ocp/health", "method": "GET" },
    "query": { "url": "https://catalog.example/ocp/query", "method": "POST" },
    "resolve": { "url": "https://catalog.example/ocp/resolve", "method": "POST" },
    "provider_registration": { "url": "https://catalog.example/ocp/providers/register", "method": "POST" },
    "contracts": { "url": "https://catalog.example/ocp/contracts", "method": "GET" },
    "object_sync": { "url": "https://catalog.example/ocp/objects/sync", "method": "POST" }
  }
}
```

`endpoints.health` is optional for schema compatibility, but production catalogs should expose it. Registration nodes call it during registration and refresh before falling back to a query probe for older manifests.

The health endpoint returns `CatalogHealth`:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogHealth",
  "catalog_id": "hello_catalog",
  "status": "healthy",
  "ready": true,
  "checked_at": "2026-05-17T00:00:00.000Z",
  "details": {},
  "dependencies": []
}
```

Only `status: "healthy"` with `ready: true` is treated as a successful Registration health check. `degraded` is a diagnostic state and is counted as unhealthy for search visibility.

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
          "pack_id": "ocp.query.keyword.v1",
          "query_modes": ["keyword", "hybrid"]
        },
        {
          "pack_id": "ocp.query.filter.v1",
          "query_modes": ["filter", "hybrid"]
        }
      ]
    }
  ]
}
```

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
