---
title: Search / Resolve / Action 三步法
description: OCP 把"从需求到下单"拆为 Search、Resolve、Action 三个严格分开的阶段，分别承担候选发现、权限化详情与动作执行。
category: concepts
order: 4
---

# Search / Resolve / Action 三步法

> 这三个阶段的字段可见性、新鲜度要求、权限强度、审计粒度各不相同。如果搅在一起，结果通常是：用户没确认就下单、价格陈旧、字段过度暴露。

## 一句话解释

在 OCP 里，一次完整的"从需求到下单"被拆成三个**严格分开**的阶段：**Search**（发现候选并解释）→ **Resolve**（在权限上下文里返回详情和动作入口）→ **Action**（由 Action Provider 实际执行）。三个阶段的字段可见性、新鲜度要求、权限强度、审计粒度各不相同。

## 解决的问题

如果不分阶段，常会出现三种典型问题：

1. **字段过度暴露**——把"联系方式、精确库存、价格区间内幕"等字段直接放进搜索结果，等同于绕过权限。
2. **数据陈旧**——把搜索结果中的价格 / 库存当作可下单的快照，结果用户付钱时发现已经变了。
3. **越权下单**——Agent 在没有用户确认、没有再次校验的情况下直接调用商家私有 API，让"找到"和"购买"在一次调用里完成，事后审计也无从入手。

Search / Resolve / Action 把这些风险拆到三个不同的协议面上，每一面只回答它该回答的问题。

## 它不是什么

- 不是同一个 endpoint 的三种参数。
- 不是数据库的三种查询语法。
- 不是"先搜后查"那种简单的两段式——Resolve 不是搜索的下一页，它会带回受限字段、实时校验、ActionBinding 和确认要求。
- Action 阶段**不是 Catalog 的功能**：Catalog 暴露动作入口（ActionBinding），但真正执行 buy / book / apply 的是 Action Provider 或业务系统。
- Search 不应替代 Resolve，Resolve 也不应替代 Search 召回。

## 核心内容

| 阶段 | 主要职责 | 输入 | 输出 | 典型权限强度 |
| --- | --- | --- | --- | --- |
| **Search** | 候选发现、摘要、匹配解释、来源提示、新鲜度判断、可解析性提示 | Query（按 manifest 声明的 Query Pack） | QueryResult / CatalogEntry 列表 + 解释、facets、freshness、warnings | 通常匿名或弱身份 |
| **Resolve** | 在身份、用途、上下文确定后返回受限详情、实时校验、ActionBinding、确认要求 | 指定 CatalogEntry + 身份 / 用途 / token | ResolvableReference + 受限字段 + 实时状态 + ActionBinding + 风险提示 + TTL | 用户 / Agent token + purpose declaration |
| **Action** | 真正执行 buy / create_checkout / book / apply / contact / request_quote / reserve / submit_profile 等 | ActionBinding + 经用户确认的输入参数 | 动作结果或状态引用 | 用户确认 + 幂等键 + 必要时支付信任层 |

几个关键纪律：

- **不要在 Search 阶段暴露价格 / 库存的内幕、联系方式、支付凭证**——这些在 Resolve 或 Action 阶段才出现，且按 visibility policy 控制。
- **Resolve 不是无差别批量抓取详情**——它应在用户已选中候选、需要受限字段、需要实时校验、或需要动作入口时调用。
- **Action 前必须确认**：用户授权、ActionBinding 是否过期、输入参数是否符合 schema、幂等键是否存在、风险等级是否允许自动执行。
- **三阶段都要审计**：query exposure、result exposure、restricted field exposure、action binding exposure、action invocation 都进入 audit ledger。

这套三步法在具体场景里的样子：

- **WebMCP Demo** 把搜索阶段直接做成浏览器内的 WebMCP 工具：`ocp.mall.search_products` 走 Search。Demo 中的页面打开工具（`ocp.mall.open_product_page`）可类比动作入口，但不等同于正式 OCP ActionBinding / Action Provider 执行链（参见 [WebMCP Demo](/knowledge/webmcp-demo)）。
- **Visa VIC Reference Agent** 严格遵守三步法：Search 得到候选 → Resolve 拿到 ActionBinding 与实时价格 → 在用户确认 Payment Instruction 后才创建 checkout，强调"购买必须经过 Resolve、用户确认和 Payment Instruction"（参见 [Visa VIC 参考 Agent](/knowledge/visa-vic-reference-agent)）。
- **WooCommerce 集成**把 Resolve 的 `create_checkout` 映射到 `POST /ocp/checkout/create`，并要求 checkout 前重新校验价格、库存、税费和配送（参见 [WooCommerce 集成概览](/knowledge/woocommerce-overview)）。

## 相关页面

- [OCP 是什么](/knowledge/what-is-ocp)
- [Catalog 是什么](/knowledge/what-is-catalog)
- [OCP 角色模型](/knowledge/roles)
- [Catalog 架构](/knowledge/catalog-architecture)
- [WebMCP Demo](/knowledge/webmcp-demo)
- [Visa VIC 参考 Agent](/knowledge/visa-vic-reference-agent)
- [WooCommerce 集成概览](/knowledge/woocommerce-overview)
