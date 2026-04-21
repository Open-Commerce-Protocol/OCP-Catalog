# 提供方注册（ProviderRegistration）

`ProviderRegistration` 是 Provider 针对 Catalog 的版本化供给声明。

## 提交时机

Provider 会在这些时机提交 registration：

- object sync 之前
- 已声明能力发生变化时
- 需要提升 `registration_version` 时

## 必需字段

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

## 提供方片段

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

## 对象声明片段

```json
{
  "object_declarations": [
    {
      "guaranteed_fields": [
        "ocp.commerce.product.core.v1#/title",
        "ocp.commerce.price.v1#/currency",
        "ocp.commerce.price.v1#/amount",
        "ocp.commerce.product.core.v1#/product_url"
      ],
      "optional_fields": [
        "ocp.commerce.product.core.v1#/summary",
        "ocp.commerce.product.core.v1#/brand",
        "ocp.commerce.product.core.v1#/category",
        "ocp.commerce.product.core.v1#/sku",
        "ocp.commerce.product.core.v1#/image_urls",
        "ocp.commerce.inventory.v1#/availability_status",
        "ocp.commerce.inventory.v1#/quantity"
      ],
      "sync": {
        "preferred_capabilities": ["ocp.push.batch"],
        "avoid_capabilities_unless_necessary": [],
        "provider_endpoints": {}
      }
    }
  ]
}
```

## 如何与对象契约匹配

Provider registration 需要同时匹配 catalog 发布的 `ObjectContract` 和 `sync_capabilities`。

在 commerce catalog 示例中，registration 只有在以下条件满足时才会成功：

- 必需字段 `ocp.commerce.product.core.v1#/title`
- 必需字段 `ocp.commerce.price.v1#/currency`
- 必需字段 `ocp.commerce.price.v1#/amount`
- 至少存在一个和 catalog 互相支持的 sync capability

在当前仓库里，live provider 实现通常会比这个最低门槛再强一些，还会保证 `product_url`，因为它要产出的是可 resolve 的商品结果，而不只是勉强通过接入校验。

在协议层，catalog 按以下 contract 条件匹配 declaration：

- `guaranteed_fields`
- `required_fields`

## 为什么只做字段级匹配

这不是契约变弱，而是协议边界的刻意收敛。

握手层只需要判断两件事：

- provider 能否保证 catalog 所要求的字段
- 双方能否协商出一条可用的 sync capability

它不要求双方先共享同一套对象类型命名，也不要求 catalog 在 registration 阶段暴露自己的内部 query 分区或索引模型。

这样协议就会稳定地落在最可验证的一层：字段保证与能力协商，而不是命名体系对齐。

## 示例同步路径

示例同步链路是：

- `sync.preferred_capabilities = ["ocp.push.batch"]`
- registration version 生效
- `RegistrationResult.selected_sync_capability = ocp.push.batch`
- 通过 catalog sync API 做 batched object sync

像 `ocp.feed.url` 这样的保留能力，应在 provider-hosted endpoint 和 catalog pull path 都实现后再由 provider 声明。

## 当前仓库里的真实运行路径

当前 provider API 同时暴露了底层路径和编排路径：

- `POST /provider/register-to-catalog`
- `POST /provider/sync-to-catalog`
- `POST /provider/sync-product/:id`
- `POST /provider/publish-to-catalog`

其中 `publish-to-catalog` 是仓库里的“先注册，再同步全部商品”的便捷路径，provider admin UI 当前就是围绕这条 operator flow 构建的。

## 版本规则

对于一个 `catalog_id + provider_id` 组合：

- provider 提交完整的新 registration 文档
- 新文档必须提升 `registration_version`
- catalog 用这个版本决定哪个声明生效
