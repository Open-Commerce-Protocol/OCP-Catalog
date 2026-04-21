# 对象契约（ObjectContract）

`ObjectContract` 定义 catalog 发布的字段级接收边界。

## 它控制什么

一个 object contract 表达：

- 必需字段要求
- 可选字段引用
- additional field policy

## Schema 片段

```json
{
  "required": ["required_fields"],
  "properties": {
    "required_fields": { "type": "array" },
    "optional_fields": { "type": "array" },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    }
  }
}
```

## 必需字段组

`required_fields` 中的每一项可以是：

- 一个单独的 `FieldRef`
- 一个 `FieldRef[]`，表示“这一组字段至少满足一个”

示例：

```json
[
  "ocp.commerce.product.core.v1#/title",
  [
    "ocp.commerce.price.v1#/amount",
    "provider#/price_text"
  ]
]
```

## 字段引用

字段引用通过 `FieldRef` 指向具体字段。

示例：

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

这样 contract 就能直接按字段表达兼容条件，而不需要额外引入 provider-facing pack 协商。

## Commerce Contract 示例

当前仓库里的第一个 catalog 暴露的是：

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title"
  ],
  "optional_fields": [
    "ocp.commerce.product.core.v1#/summary",
    "ocp.commerce.price.v1#/amount",
    "ocp.commerce.inventory.v1#/availability_status"
  ],
  "additional_fields_policy": "allow"
}
```

因此最小注册条件是：

- 保证 `ocp.commerce.product.core.v1#/title`

同步传输路径通过 `sync_capabilities` 单独协商。
