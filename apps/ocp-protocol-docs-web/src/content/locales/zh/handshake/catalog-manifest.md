# 目录清单（CatalogManifest）

`CatalogManifest` 是 catalog 对外公开的握手文档。

## 它声明什么

它会告诉 provider 或 agent：

- catalog 是谁
- 哪些 endpoint 是公开的
- 它接受哪些 object contract
- 它暴露哪些 query capability
- 它要求 provider 具备哪些字段
- 它愿意和 provider 协商哪些 sync capability

## Endpoint 形状

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

## Provider Contract 形状

`provider_contract` 包含两个正式部分：

- `field_rules`
- `sync_capabilities`

示例：

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

## 搜索契约形状

搜索契约通过 `query_capabilities[*].query_packs` 表达。

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

`target_object_types` 可以作为 catalog 自己写入的提示字段出现，但它不是 query negotiation 的主协议轴。

协议层真正要求 catalog 声明的是：

- 有哪些 query endpoint
- 有哪些 query capability
- 接受哪些输入字段
- 哪些字段可搜索、可过滤、可排序
- request schema 在哪里

## 运行时示例

commerce catalog 示例的 live manifest 发布一个 provider-facing sync capability：

- `ocp.push.batch`

像 `ocp.feed.url` 这样的保留能力，应在对应传输路径实现后再出现在运行时 manifest 中。
