# 目录搜索（CatalogSearch）

`CatalogSearchRequest` 和 `CatalogSearchResult` 定义的是 Agent 如何向 Center 询问候选 Catalog。

## 搜索请求

这个请求结构刻意保持轻量。

```json
{
  "required": ["query"],
  "properties": {
    "filters": {
      "properties": {
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

## 搜索结果项

每个结果项同时包含排序信息和 route 信息。

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "catalog_name": "Commerce Catalog Local Dev",
  "score": 0.96,
  "matched_query_capabilities": ["commerce_product_search"],
  "route_hint": {
    "catalog_id": "commerce_catalog_local_dev",
    "query_url": "http://localhost:4000/ocp/query",
    "manifest_url": "http://localhost:4000/ocp/manifest"
  },
  "explain": [
    "Matched supported query pack ocp.commerce.product.search.v1"
  ]
}
```

## 设计意图

Center 负责的是 catalog 选择，不是商品检索。

所以 search result 的作用是帮助 agent 先选 catalog，再把具体商品搜索留给该 catalog。
