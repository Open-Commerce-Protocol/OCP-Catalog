# 注册发现概览

OCP Catalog Registration 定义的是 Catalog 如何注册到 registration node，以及 Agent 如何发现 Catalog。

当前实现仍暴露 legacy schema namespace `ocp.catalog.center.v1` 和 legacy `Center*` 对象名。它们只是兼容性命名；概念角色是去中心化协议中的注册与发现。

## 核心职责

Registration node 回答的问题是：

> 应该去哪个 Catalog 查询？

它不回答：

> 具体应该买哪个商品？

后一个问题属于 Catalog 本身。

## Registration 对象

这个包包含：

- `CenterDiscovery`
- `CenterManifest`
- `CatalogRegistration`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogRouteHint`
- verification 和 refresh 相关结果对象

## 当前运行时角色

在当前仓库里，Registration node 会：

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
