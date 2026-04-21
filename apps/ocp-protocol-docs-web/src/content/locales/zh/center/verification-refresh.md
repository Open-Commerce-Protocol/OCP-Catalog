# 验证与刷新

Center 包里还定义了 catalog verification、refresh 和 token rotation 相关的控制面对象。

## Verification Request

当前 verification request 很小，只做最小必要表达。

```json
{
  "properties": {
    "ocp_version": { "const": "1.0" },
    "kind": { "const": "CatalogVerificationRequest" },
    "challenge_id": { "type": "string" }
  }
}
```

这一套 challenge 生命周期让 Center 能确认注册中的 catalog 确实控制了声明的 endpoint 或域名。

## Refresh Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "center_id",
    "catalog_id",
    "status",
    "health_status",
    "indexed",
    "warnings",
    "refreshed_at"
  ]
}
```

这个结果告诉 Catalog：一次 refresh 是否成功生成了健康、可索引的 snapshot。

## Token Rotation Result

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "center_id",
    "catalog_id",
    "catalog_access_token",
    "token_issued_at"
  ]
}
```

## 为什么这些对象重要

它们不会直接影响用户侧商品搜索，但对多 catalog 网络的运维非常关键：

- verification 保证注册可信
- refresh 保证 snapshot 是新的
- token rotation 保证操作权限可控
