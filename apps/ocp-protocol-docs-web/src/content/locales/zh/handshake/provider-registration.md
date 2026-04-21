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
        "ocp.commerce.price.v1#/amount"
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
- 至少存在一个和 catalog 互相支持的 sync capability

在协议层，catalog 按以下 contract 条件匹配 declaration：

- `guaranteed_fields`
- `required_fields`

## 示例同步路径

示例同步链路是：

- `sync.preferred_capabilities = ["ocp.push.batch"]`
- registration version 生效
- `RegistrationResult.selected_sync_capability = ocp.push.batch`
- 通过 catalog sync API 做 batched object sync

像 `ocp.feed.url` 这样的保留能力，应在 provider-hosted endpoint 和 catalog pull path 都实现后再由 provider 声明。

## 版本规则

对于一个 `catalog_id + provider_id` 组合：

- provider 提交完整的新 registration 文档
- 新文档必须提升 `registration_version`
- catalog 用这个版本决定哪个声明生效
