# 角色

当前协议和仓库实现里，主要有四种角色。

## Center

Center 主要回答的问题是：

> 下一步应该去问哪个 Catalog？

Center 不直接提供商品。它索引的是 catalog 元数据、可信状态、route hint 和 manifest snapshot。

## Catalog

Catalog 是真正提供查询能力的节点。

它负责：

- 发布 manifest
- 定义 object contract
- 接收 provider registration
- 接收对象同步
- 暴露 query 和 resolve 接口

## Provider

Provider 是对象供给方。

它负责：

- 声明自己能提供哪些 object type 和 pack
- 发送版本化的 registration
- 把具体对象同步进 catalog

## Agent

Agent 是使用侧。

它负责：

- 通过 Center 选择合适的 catalog
- 读取 catalog 的能力描述
- 对 catalog 发 query 请求
- 对选中的结果执行 resolve

## 角色关系

```text
Provider -> Catalog -> Center
                 ^
                 |
               Agent
```

## 为什么要这样拆分

这种拆分把三个关注点分开了：

- 对象供给
- catalog 服务
- 网络级发现

这正是当前 demo 可以同时支持多个 provider 和多个 catalog 的原因。
