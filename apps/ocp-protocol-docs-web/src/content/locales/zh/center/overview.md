# Center 概览

`ocp.catalog.center.v1` 定义的是 Catalog 如何注册到 OCP Center，以及 Agent 如何发现 Catalog。

## 核心职责

Center 回答的问题是：

> 应该去哪个 Catalog 查询？

它不回答：

> 具体应该买哪个商品？

后一个问题属于 Catalog 本身。

## Center 对象

这个包包含：

- `CenterDiscovery`
- `CenterManifest`
- `CatalogRegistration`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- verification 和 refresh 相关结果对象

## 当前运行时角色

在当前仓库里，Center 会：

- 存储 catalog registration
- 获取并索引 manifest snapshot
- 提供 catalog search
- 返回带 trust 和 health 信息的 route hint

## Route Hint 原则

Route hint 是一个摘要。

它应该告诉 agent：

- 这个 catalog 在哪里
- 它是否可信和健康
- 它大致支持哪些 object type 和 query pack

如果 agent 需要更完整的能力说明，应该去请求 `manifest_url`。
