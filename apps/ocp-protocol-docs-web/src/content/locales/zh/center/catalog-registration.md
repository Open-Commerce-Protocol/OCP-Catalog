# CatalogRegistration

`CatalogRegistration` 是 Catalog 向 Center 发送的版本化声明。

## 必需字段

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "center_id",
    "catalog_id",
    "registration_version",
    "updated_at",
    "homepage",
    "well_known_url",
    "claimed_domains",
    "operator"
  ]
}
```

## 示例片段

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "registration_version": 3,
  "homepage": "http://localhost:4000",
  "well_known_url": "http://localhost:4000/.well-known/ocp-catalog",
  "claimed_domains": ["localhost"],
  "operator": {
    "display_name": "Commerce Catalog Local Dev"
  },
  "intended_visibility": "public",
  "tags": ["commerce", "products"]
}
```

## 版本规则

对同一个 `catalog_id`：

- 更大的 `registration_version` 会覆盖旧版本
- `updated_at` 只是审计时间，不是主版本排序依据

## Center 接下来会做什么

Center 接受注册后，可以继续：

- 校验 catalog 控制权
- 拉取 catalog manifest
- 生成 snapshot
- 索引可路由的 metadata
