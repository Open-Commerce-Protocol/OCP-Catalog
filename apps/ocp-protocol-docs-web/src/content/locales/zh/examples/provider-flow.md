# 提供方流程（Provider Flow）

这个示例流程描述的是当前仓库里真实存在的 commerce provider 实现。

## 真实生命周期

```text
provider admin seed 或编辑商品
-> provider 读取 catalog manifest 和 object contracts
-> provider 基于 guaranteed_fields 和 preferred sync capability 构造 ProviderRegistration
-> catalog 返回 RegistrationResult，并选中 selected_sync_capability = ocp.push.batch
-> provider 发布 CommercialObject batch
-> catalog 把商品数据投影成可搜索 entry
-> provider status 页面显示 local_quality、publish_readiness 和 catalog_quality
```

## Provider 现在实际发布什么

当前 provider 实现不是在发布匿名对象，而是把本地商品行映射成 `CommercialObject`，其中包含：

- 商品基础字段：`title`、`summary`、`brand`、`category`、`sku`、`product_url`、`image_urls`
- 价格字段：`currency`、`amount`、`list_amount`、`price_type`
- 库存字段：`availability_status`、`quantity`

当前 provider 在 registration 阶段会明确保证：

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`
- `ocp.commerce.product.core.v1#/product_url`

## 当前仓库中的真实行为

在当前 workspace 里：

- provider admin API 可以 seed 更真实的 demo 商品
- provider 可以向 commerce catalog 发起注册
- catalog 会协商出 `ocp.push.batch`
- provider 可以一次发布全部商品，也可以单条同步某个商品
- publish run 会被记录到 `provider_sync_runs`
- provider admin UI 会展示最近 run、本地 feed 质量、发布前 readiness，以及 catalog 侧的质量反馈

## 当前 `publish-to-catalog` 的真实含义

`POST /provider/publish-to-catalog` 是 provider API 上的一层 orchestration helper。它当前会顺序执行：

1. `registerToCatalog`
2. `syncAll`

它返回的响应里会同时带上两条 run record：

- `register_run`
- `sync_run`

所以这个流程示例不是理论上的“握手演示”，而是对真实 provider-side workflow wrapper 的描述。

## 质量反馈闭环

当前 provider 会暴露三种不同层面的质量视图：

- `local_quality`
  统计 provider 本地商品数据的问题，比如缺价格、缺图片、缺 URL、缺 brand/category。
- `publish_readiness`
  判断 provider 当前是否已经具备可发布的有效商品集合。
- `catalog_quality`
  从 catalog 读回这个 provider 的真实索引结果，包括 `basic`、`standard`、`rich` entry 数量，以及缺图、缺 URL、缺货等统计。

这让 provider flow 更接近真实电商 feed lifecycle，而不是“发成功就算完成”。

## 重要运行规则

- provider 必须先拥有 active registration version，object sync 才能成功。
- `out_of_stock` 不等于删除。商品可以继续保持 active，只是由排序和 filter 决定如何展示。
- 选中的 sync capability 在 registration 阶段协商得出。当前仓库里的 live path 是 `ocp.push.batch`。

## 为什么这个流程重要

当前 provider example 展示的是一种更真实的职责拆分：

- handshake 决定 provider 是否满足 catalog 的最低字段基线
- provider 决定自己的声明和 payload 可以有多丰富
- catalog 决定 sync 之后如何排序、过滤和暴露这些商品
- provider admin 界面再把结果反馈回来，告诉你这个 feed 是“只是被接收”，还是“已经达到高质量目录标准”
