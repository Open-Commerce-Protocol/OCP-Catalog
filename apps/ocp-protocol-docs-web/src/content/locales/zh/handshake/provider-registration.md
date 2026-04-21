# ProviderRegistration

`ProviderRegistration` 是 Provider 针对 Catalog 的版本化能力声明。

## 它什么时候提交

Provider 会在以下时机提交 registration：

- 开始 object sync 之前
- 自身供给能力发生变化时
- 需要提升 registration version 时

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

## Provider 片段

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

## Object Declaration 片段

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

## 版本规则

对于同一个 `catalog_id + provider_id`：

- Provider 会提交一份完整的新 registration 文档
- 新文档的 `registration_version` 必须更大
- Catalog 会根据这个版本决定哪个声明处于激活状态

这也是当前仓库里能正确约束“先注册、再同步”的基础。
