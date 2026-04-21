# OCP Catalog 协议

这个站点说明的是当前仓库里已经实现的 OCP Catalog 协议面。

它主要覆盖两层协议：

- `ocp.catalog.handshake.v1`
- `ocp.catalog.center.v1`

## 这个协议解决什么问题

该协议把 catalog 的供给侧和发现侧分开了。

高层流程如下：

1. Provider 告诉 Catalog 自己能提供哪些对象
2. Catalog 对这些对象暴露 query 和 resolve 能力
3. Catalog 把自己注册到 OCP Center
4. 用户侧 agent 先向 Center 询问应该使用哪个 Catalog
5. agent 再路由到选中的 Catalog，执行 query 和 resolve

## 协议边界

协议被故意拆成两层。

### Handshake

`ocp.catalog.handshake.v1` 负责：

- `Provider -> Catalog`
- catalog manifest 发现
- object contract
- provider registration
- 通用 commercial object 包络

它**不**负责 Center 注册或 catalog 联邦发现。

### Center

`ocp.catalog.center.v1` 负责：

- `Catalog -> Center`
- Center discovery
- catalog registration
- catalog search
- route hint 返回

它**不**直接索引商品对象。

## 当前仓库实现状态

当前仓库已经跑通了下面这条链路：

```text
Catalog 启动
-> Catalog 注册到 Center
-> Provider 注册到 Catalog
-> Provider 同步 commercial object
-> Agent 向 Center 查找 Catalog
-> Agent 查询 Catalog
-> Agent resolve 选中的结果
```

## 当前设计约定

当前实现有两条重要约定。

### Query Packs 是主搜索契约

Catalog 告诉 agent 如何搜索，主要通过 `query_packs`，而不是一个平铺的 mode 列表。

示例：

```json
{
  "query_packs": [
    {
      "pack_id": "ocp.commerce.product.search.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"]
        }
      }
    }
  ]
}
```

### 可选提示统一放在 Metadata 中

像语言支持、语义检索提示、过滤提示这些扩展信息，都放在 `metadata` 里，而不是直接变成顶层必填协议字段。

这样可以在不破坏最小协议闭环的前提下，继续给 agent 更多规划信息。

## 推荐阅读顺序

- 先看 [角色](/roles)
- 再看 Handshake 概览
- 再看 Center 概览
- 最后看示例流程
