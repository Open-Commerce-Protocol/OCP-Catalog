# 注册结果（RegistrationResult）

`RegistrationResult` 是 Provider registration 完成后的结构化反馈。

## 状态模型

当前 schema 支持：

```json
{
  "status": {
    "enum": [
      "accepted_full",
      "accepted_limited",
      "rejected",
      "pending_verification"
    ]
  }
}
```

## 主要字段

```json
{
  "properties": {
    "matched_object_contract_count": { "type": "integer" },
    "effective_registration_version": { "type": "integer" },
    "selected_sync_capability": {
      "type": "object"
    },
    "missing_required_fields": { "type": "array" },
    "warnings": { "type": "array" },
    "message": { "type": "string" }
  }
}
```

## 为什么它重要

它会告诉 Provider：

- registration 是否被完全接受
- 匹配到了多少个 object contract
- 最终选中了哪条 sync capability
- 是否存在缺失字段
- 当前激活版本是否发生变化

这些反馈都应该在 Provider Admin UI 里展示出来，然后再决定是否继续 full sync。
