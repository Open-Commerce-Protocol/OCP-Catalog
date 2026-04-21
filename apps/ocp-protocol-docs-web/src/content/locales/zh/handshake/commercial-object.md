# CommercialObject

`CommercialObject` 是同步进 Catalog 的通用对象包络。

## 目标

它为 Catalog 提供一个稳定的外层结构，同时把领域细节交给 descriptor packs。

## 必需字段

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

## Descriptor 片段

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

## 为什么需要 Descriptor

`CommercialObject` 没有把所有商品细节做成一个固定 schema，而是允许 pack 承载领域数据。

这样 Catalog 可以：

- 分 pack 校验
- 把关键字段投影到本地索引
- 保持 pack 级别的扩展能力

## 仓库中的例子

当前 demo commerce catalog 会把 pack 数据投影到 catalog entry 中，用于：

- keyword 搜索
- 结构化 filter
- semantic embedding text
