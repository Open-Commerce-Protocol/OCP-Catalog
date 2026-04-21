# 中心发现（CenterDiscovery）

`CenterDiscovery` 是访问 Center 时的引导文档。

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
  "center_name": "OCP Center Local Dev",
  "center_protocol": "ocp.catalog.center.v1",
  "manifest_url": "http://localhost:4100/ocp/center/manifest",
  "catalog_registration_url": "http://localhost:4100/ocp/catalogs/register",
  "catalog_search_url": "http://localhost:4100/ocp/catalogs/search"
}
```

## 为什么需要它

如果没有 discovery 文档，所有客户端都只能依赖外部约定知道 Center 的接口地址。

有了它，Center 的入口就变成了自描述的。
