---
title: OCP 角色模型
description: OCP 把 Catalog 发现、索引、接入、解析、执行等职责分给不同角色，使权限边界、责任与数据流向都清晰可审计。
category: concepts
order: 3
---

# OCP 角色模型

> OCP 的可审计性来自一件事：协议层面**分角色**。本页给出协议中的核心角色清单，以及几个容易被搞混的边界——例如 Registration Node ≠ 商品搜索引擎。

## 一句话解释

OCP 把"发现 Catalog""索引商业对象""提供对象数据""查询和解析对象""执行动作""跨域路由"等职责**拆给不同角色承担**，让每一段都有清晰的权限边界、责任归属和数据流向。

## 解决的问题

商业系统里"一方包打天下"是常见反模式：

- 同一个组件既是数据库又是搜索引擎又是订单网关，权限和故障域纠缠在一起。
- 一个 Registration 节点同时索引"哪些 Catalog 存在"和"哪些商品存在"，结果它要么成为巨型商品数据库，要么搜索路径混乱。
- Agent 直接读写商家私有表，把"找到对象"和"执行下单"混在一次调用里，绕过了用户确认。

OCP 用角色分离来避免这些问题：每个角色只回答它该回答的那一类问题，其他问题转给下一个角色。

## 它不是什么

- 不是参与方的"组织名单"——它是协议层的责任划分。
- 不是法人或公司划分——同一家公司可以同时担任多个角色。
- 不是进程或微服务边界——同一个进程也可以同时实现多个角色，只要遵守相应的协议面。
- 不是技术栈分层（前端 / 后端 / 数据库）。

## 核心内容

OCP 定义的核心角色：

| 角色 | 它回答什么问题 | 它**不**回答什么问题 |
| --- | --- | --- |
| **OCP**（协议基座） | 发现、查询、解析、权限、来源、信任、动作绑定、联邦协作的通用语义 | 任何具体平台的内部数据结构 |
| **Registration Node** | "哪些 Catalog 存在？怎么路由到合适的 Catalog？" | 具体商品、职位、服务是什么 |
| **Catalog Node** | "在我这里能查询哪些对象？候选是什么？怎么解析？" | 对象的真实性、库存、状态由谁权威决定 |
| **Provider** | "这些对象的字段、来源、更新时间、生命周期" | 全局排序、跨 Catalog 检索、动作执行 |
| **Agent / User** | "用户想做什么？该用哪个 Catalog？要不要确认？" | 索引、字段权威性、支付授权 |
| **Action Provider** | "执行 buy / book / apply / contact / quote 等动作" | Catalog 内的搜索召回与排序 |
| **Federation Router** | "跨 Catalog 的发现、聚合、路由、信任传播" | 默认复制远端对象的完整数据 |

几条容易被搞混的边界：

- **Registration Node ≠ 商品搜索引擎**。它的查询对象是 *Catalog metadata*，不是商品本身。Agent 在 Registration Node 上搜的是"哪个 Catalog 适合我的意图"，不是"哪件商品最便宜"。
- **Provider ≠ Action Provider**。Provider 是对象**来源**，Action Provider 是动作**执行方**。一个商家可以同时担任两者，但协议上它们是两个面。
- **Catalog Node ≠ Order System**。Catalog 暴露 ActionBinding（动作入口），不是动作执行系统本身。"Catalog 暴露动作入口，具体动作由 Action Provider 或业务系统执行。"
- **Agent 的纪律**：只用 manifest 声明的 Query Pack 和 filter fields，不发明字段名、不绕过 resolve，对 checkout / apply / book / contact 等动作必须取得用户明确确认。

在落地时，几种典型组合：

- WooCommerce 店铺通常同时担任 **Provider** 与 **Action Provider**（参见 [WooCommerce 集成概览](/knowledge/woocommerce-overview)）。
- Visa VIC Reference Agent 担任 **Agent**，并把 **Payment Trust** 作为独立的信任层组合进来（参见 [Visa VIC 参考 Agent](/knowledge/visa-vic-reference-agent)）。
- 一个公共 Commerce Catalog 担任 **Catalog Node**，聚合多个 Provider，向 Registration Node 注册。

## 相关页面

- [OCP 是什么](/knowledge/what-is-ocp)
- [Catalog 是什么](/knowledge/what-is-catalog)
- [Search / Resolve / Action 三步法](/knowledge/search-resolve-action)
- [Catalog 架构](/knowledge/catalog-architecture)
- [WooCommerce 集成概览](/knowledge/woocommerce-overview)
- [Visa VIC 参考 Agent](/knowledge/visa-vic-reference-agent)
