# 注册发现

注册发现文档用于引导调用方访问 OCP Catalog Registration node。

当前 wire schema 仍保留兼容性命名：`CenterDiscovery` kind 和 `center_*` 字段名。它们只是兼容标识，不表示 OCP 存在一个中心权威。

## 必需字段

```json
{
  "required": [
    "ocp_version",
    "kind",
    "center_id",
    "center_name",
    "center_protocol",
    "center_protocol_version",
    "manifest_url",
    "catalog_registration_url",
    "catalog_search_url"
  ]
}
```

## 示例片段

```json
{
  "kind": "CenterDiscovery",
  "center_id": "ocp_center_local_dev",
  "center_name": "OCP Catalog Registration node Local Dev",
  "center_protocol": "ocp.catalog.center.v1",
  "manifest_url": "http://localhost:4100/ocp/registration/manifest",
  "catalog_registration_url": "http://localhost:4100/ocp/catalogs/register",
  "catalog_search_url": "http://localhost:4100/ocp/catalogs/search"
}
```

## 为什么需要它

如果没有 discovery 文档，所有客户端都只能依赖外部约定知道 Registration node 的接口地址。

有了它，registration node 的入口就变成了自描述的。
