# CatalogManifest

`CatalogManifest` 是 Catalog 对外公开的握手文档。

## 它在什么时候使用

Provider 和 Agent 会读取 manifest，以了解：

- 这个 catalog 是谁
- 它有哪些 endpoint
- 它接受哪些 object type
- 它暴露哪些搜索能力

## 必需字段

当前 schema 中最关键的必需字段如下：

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

## Endpoint 片段

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

## Query Capability 片段

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

## 为什么 Query Packs 很重要

Manifest 应该通过 `query_packs` 告诉 agent 如何搜索，而不是只给一段描述文字。

这样 agent 能获得：

- 稳定的 pack 标识
- request schema 链接
- 可选的执行提示

## 仓库中的例子

当前仓库里的 commerce catalog 就是通过一个主要的 product search capability，对外暴露语言提示和语义提示。
