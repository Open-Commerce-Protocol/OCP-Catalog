# ObjectContract

`ObjectContract` 定义的是：对于某种 object type，Catalog 愿意接收什么。

## 它控制什么

一个 object contract 会表达：

- `object_type`
- required 和 optional descriptor packs
- field validation rules
- 允许的 registration mode

## Schema 片段

```json
{
  "required": ["contract_id", "object_type", "field_rules"],
  "properties": {
    "required_packs": { "type": "array" },
    "optional_packs": { "type": "array" },
    "compatible_packs": { "type": "object" },
    "registration_modes": {
      "type": "array",
      "items": {
        "enum": ["feed_url", "api_pull", "push_api"]
      }
    },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    }
  }
}
```

## 实际含义

ObjectContract 是 Catalog 约束 Provider 输入边界的方式。

例如一个 commerce product contract 可以要求：

- 核心商品 pack
- price pack
- inventory pack

如果 Provider 无法满足这些要求，Catalog 就可以拒绝注册或降级接入。

## Field Rules

Field rule 通过 `FieldRef` 指向具体字段。

示例：

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

这样 contract 就不需要把所有内容都硬编码成一个巨大的对象 schema。
