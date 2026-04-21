# RegistrationResult

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
    "matched_contract_ids": { "type": "array" },
    "effective_registration_version": { "type": "integer" },
    "missing_required_fields": { "type": "array" },
    "warnings": { "type": "array" },
    "message": { "type": "string" }
  }
}
```

## 为什么它重要

它不是一个简单的 ACK，而是告诉 Provider：

- 这次注册是否被完全接受
- 匹配到了哪些 contract
- 是否存在缺失字段
- 当前生效版本是多少

这也是 Provider Admin UI 在触发 sync 之前应该先看的结果。
