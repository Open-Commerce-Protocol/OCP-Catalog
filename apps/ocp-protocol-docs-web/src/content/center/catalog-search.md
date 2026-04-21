# CatalogSearch

`CatalogSearchRequest` and `CatalogSearchResult` define how an agent asks the Center for candidate catalogs.

## Search Request

The request is intentionally lightweight.

```json
{
  "required": ["query"],
  "properties": {
    "filters": {
      "properties": {
        "object_type": { "type": "string" },
        "query_mode": { "type": "string" },
        "query_pack": { "type": "string" },
        "supports_resolve": { "type": "boolean" },
        "verification_status": { "type": "string" },
        "trust_tier": { "type": "string" },
        "health_status": { "type": "string" },
        "domain": { "type": "string" },
        "tag": { "type": "string" }
      }
    }
  }
}
```

## Search Result Item

Each result item includes both ranking and route information.

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "catalog_name": "Commerce Catalog Local Dev",
  "score": 0.96,
  "matched_object_types": ["product"],
  "matched_query_capabilities": ["commerce_product_search"],
  "route_hint": {
    "catalog_id": "commerce_catalog_local_dev",
    "query_url": "http://localhost:4000/ocp/query",
    "manifest_url": "http://localhost:4000/ocp/manifest"
  },
  "explain": [
    "Matched object type product",
    "Matched supported query pack ocp.commerce.product.search.v1"
  ]
}
```

## Design Intent

The Center performs catalog selection, not product retrieval.

So the search result should help the agent choose a catalog and then leave product search to that catalog.
