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

### 握手层

`ocp.catalog.handshake.v1` 负责：

- `Provider -> Catalog`
- catalog manifest 发现
- object contract
- provider registration
- 通用 commercial object 包络

它**不**负责 Center 注册或 catalog 联邦发现。

### 中心层

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

这条链路背后的 live example 现在已经明确是一个 commerce product catalog：

- catalog 的最低 object contract 要求 `title + price.currency + price.amount`
- provider 的默认 registration 还会额外保证 `product_url`
- sync 进来的商品会被投影成带价格、图片、库存、质量信号的 commerce search entry
- provider admin flow 会展示 `local_quality`、`publish_readiness`、`catalog_quality`
- 在启用 embedding 时，semantic 和 hybrid retrieval 也属于已验证的实现路径

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
      "query_modes": ["keyword", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"],
          "filter_fields": ["category", "brand", "currency", "availability_status", "provider_id", "sku", "min_amount", "max_amount", "in_stock_only", "has_image"]
        }
      }
    }
  ]
}
```

当前仓库里的真实 commerce manifest 实际上会在同一个 capability 下发布多个 query pack：

- `ocp.query.keyword.v1`
- `ocp.query.filter.v1`
- 启用 embedding 时的 `ocp.query.semantic.v1`

### 可选提示统一放在 Metadata 中

像语言支持、语义检索提示、过滤提示这些扩展信息，都放在 `metadata` 里，而不是直接变成顶层必填协议字段。

这样可以在不破坏最小协议闭环的前提下，继续给 agent 更多规划信息。

## 推荐阅读顺序

- 先看 [角色](/roles)
- 如果你想快速参与建设，先看 [快速接入](/getting-started)
- 如果你有一些接入层面的简单问题，先看 [FAQ](/faq)
- 如果你想先看最小可实现版本，先看 [最小 Catalog](/examples/minimal-catalog) 和 [最小 Provider](/examples/minimal-provider)
- 再看 Handshake 概览
- 再看 Center 概览
- 最后看示例流程
