# OCP Catalog System Design

> 状态说明
>
> 本文档描述 OCP Catalog 的长期系统设计、角色边界和协议语义，不等同于当前仓库已经全部实现的功能。
>
> 当前已落地的协议细节和实现状态请优先参考：
>
> - [README.md](../../README.md)
> - [Handshake v1](../specs/handshake/v1.md)
> - [Registration v1](../specs/registration/v1.md)
>
> [design-v2](../archive/architecture/design-v2.md) 保留了较早阶段的设计推演和实施路径；本文档是更结构化的系统设计说明，用于统一长期概念边界。

## 1. 文档定位

OCP Catalog 是 OCP 体系中的商业对象发现、查询协商、权限化检索与解析层。其目标是为 AI Agent、应用、商业系统和服务提供方提供统一的协议语义，使异构商业对象能够被声明、发现、查询、解释、解析并连接到后续动作。

OCP Catalog 不等同于中心化商品数据库，也不等同于搜索引擎、支付网络、订单系统或履约系统。它提供的是跨商业场景的对象发现与交互入口协议。具体对象可以来自不同 Provider，存放在不同 Catalog Node，由不同 Action Provider 执行动作，并通过统一的协议结构向 Agent 或应用暴露。

本文档描述 OCP Catalog 的概念设计、角色模型、协议分层、数据建模、使用方法、接口支持、多元性与可扩展性。文档不绑定任何部署形态、工程组织或单一业务平台。

## 2. 设计目标

OCP Catalog 的设计目标包括：

1. 建立通用商业对象模型，使商品、服务、职位、人才、采购需求、渠道机会、本地预约资源、报价、任务和工作流入口能够被统一发现和查询。
2. 区分 Catalog 发现、Provider 接入、对象查询、对象解析和动作执行，使不同职责由不同协议边界承载。
3. 支持 Agent 以可验证、可解释、可约束的方式发现 Catalog、选择 Catalog、查询对象并解析下一步动作。
4. 支持 Provider 按契约接入 Catalog，而不是要求所有 Provider 使用相同内部数据模型或搜索引擎。
5. 支持不同 Catalog 暴露不同查询能力、同步能力、权限策略和对象类型，同时保持协议层可互操作。
6. 支持远程优先的联邦协作，使 Catalog 之间优先交换 profile、route hint、contract、summary、trust metadata 和 mutation log，而不是强制复制完整对象数据库。
7. 支持字段级权限、用途限制、来源证明、新鲜度声明、审计记录和信任等级，降低 Agentic Commerce 场景中的错误调用、越权访问和数据污染风险。

## 3. 非目标

OCP Catalog 不承担以下职责：

1. 不作为所有商业对象的中心化主数据库。
2. 不规定 Catalog 内部必须使用何种搜索算法、向量数据库、索引结构或排序模型。
3. 不直接承担支付清结算、卡凭证保存、订单履约、物流、退款、售后或商家后台状态机。
4. 不替代 Provider 对对象真实性、价格、库存、服务可用性、招聘状态或业务状态的权威责任。
5. 不要求所有商业场景使用商品语义；商品只是 CommercialObject 的一个具体类型。
6. 不把 MCP、REST、Webhook、A2A 或特定平台 API 作为核心模型本身；这些属于绑定层或适配层。
7. 不要求 Federation 节点持有所有远端对象的完整明细、私有 embedding、内部排序模型或敏感字段。

## 4. 核心设计原则

### 4.1 Object-Neutral Core

OCP Catalog 以通用商业对象为核心，而不是以商品、订单或店铺为核心。核心模型只定义对象身份、类型、来源、摘要、可见性、访问策略、语义扩展、查询投影、解析能力和动作入口。行业差异通过 Descriptor Pack、Query Pack 和 Action Binding 扩展。

### 4.2 Role Separation

Catalog 发现、对象索引、Provider 接入、对象同步、对象解析和动作执行必须分层。Registration Node 发现 Catalog，Catalog Node 查询对象，Provider 提供对象来源，Action Provider 执行后续动作。角色混淆会导致查询路径、权限边界和责任归属不清。

### 4.3 Contract-First Integration

Provider 接入 Catalog 时应先完成字段级、对象级和同步能力级契约协商。Catalog 不应假设 Provider 的内部数据结构。Provider 也不应把大规模对象数据塞入注册请求。注册建立契约，同步传输对象，查询返回投影，解析返回可交互引用。

### 4.4 Search/Resolve Separation

Search 负责候选发现、摘要、匹配解释、来源提示、新鲜度和可解析性判断。Resolve 负责在明确对象和权限上下文下返回更具体的详情、实时校验、受限字段和下一步动作。Search 不应直接暴露全部私有字段，Resolve 不应替代搜索召回。

### 4.5 Permission by Design

权限不应只作为 endpoint 的外层开关。对象、字段、查询模式、解析动作和后续 action 都需要声明可见性、用途限制、身份要求、审计要求和过期策略。Search 与 Resolve 可以具有不同权限强度。

### 4.6 Trust by Design

Catalog 结果应携带来源、权威性、新鲜度、验证状态和信任等级。Agent 不应把搜索结果视为无条件真实对象，而应根据 provenance、verification、freshness、health 和 trust tier 决定是否继续 resolve 或请求用户确认。

### 4.7 Remote-First Federation

联邦协作应优先交换可缓存、可审计、低敏感度的路由与能力摘要。完整对象数据、私有模型和敏感字段只有在明确契约、权限和业务需要下才同步或解析。该原则降低跨域复制成本和数据泄漏风险。

## 5. 总体架构

OCP Catalog 的概念架构可以分为五层：

| 层级 | 作用 | 典型对象 |
| --- | --- | --- |
| Discovery Layer | 发现 Catalog、验证 Catalog、返回路由摘要 | RegistrationDiscovery、RegistrationManifest、CatalogProfileSnapshot、CatalogRouteHint |
| Catalog Layer | 声明 Catalog 能力、承载对象索引、执行 query/resolve | CatalogManifest、ObjectContract、QueryPackBinding、CatalogEntry |
| Provider Integration Layer | Provider 接入 Catalog、协商对象契约和同步能力 | ProviderRegistration、ProviderDeclaration、SyncCapability |
| Object Semantics Layer | 定义通用对象包络和行业语义扩展 | CommercialObject、DescriptorPack、DescriptorInstance、DescriptorContract |
| Action Layer | 将已解析对象连接到后续可执行动作 | ResolvableReference、ActionBinding、ActionInvocationContract |

典型调用链如下：

```text
Agent/User
  -> local catalog profile cache
  -> Registration Node search
  -> CatalogRouteHint / CatalogManifest
  -> Catalog Node query
  -> CatalogEntry candidates
  -> Catalog Node resolve
  -> ResolvableReference + ActionBinding
  -> Action Provider / Merchant / Workflow
```

典型 Provider 接入链路如下：

```text
Provider
  -> Catalog discovery document
  -> CatalogManifest
  -> ObjectContract inspection
  -> ProviderRegistration
  -> RegistrationResult
  -> Object sync channel
  -> CatalogEntry projection
```

## 6. 角色模型

### 6.1 OCP

OCP 是开放商业协议基座，定义商业对象发现、查询、解析、权限、来源、信任、动作绑定和联邦协作的通用语义。OCP 不要求所有参与方使用相同内部系统，只要求对外暴露可协商、可验证、可解释的协议面。

### 6.2 Registration Node

Registration Node 是 Catalog 的发现、验证、索引与路由节点。它的查询对象是 Catalog metadata，而不是商品、服务、职位或其他商业对象。

Registration Node 的职责包括：

1. 接收 Catalog 的注册声明。
2. 验证 Catalog 身份、域名、manifest、health 和能力摘要。
3. 建立 Catalog profile 与索引条目。
4. 根据 Agent 或应用的意图搜索合适 Catalog。
5. 返回可缓存的 CatalogRouteHint。
6. 提供 Catalog resolve，用于获取更完整的 Catalog profile 或 manifest 入口。

Registration Node 不应承担具体商业对象搜索，不应替代 Catalog Node 的 query/resolve，也不应要求 Catalog 暴露完整对象数据库。

### 6.3 Catalog Node

Catalog Node 是商业对象发现与检索节点。它维护自身对象索引、查询能力、权限策略、排序策略和解析能力。Catalog Node 对外声明自身支持的对象类型、Descriptor Pack、Query Pack、Provider 接入要求、同步能力、endpoint 和认证要求。

Catalog Node 的职责包括：

1. 暴露 CatalogManifest 和 ObjectContract。
2. 接收 ProviderRegistration 并协商 Provider 接入。
3. 接收对象同步数据或远端对象摘要。
4. 生成 CatalogEntry 索引投影。
5. 响应 Agent 或应用的 query 请求。
6. 对候选对象执行 policy-aware resolve。
7. 返回受权限控制的 ResolvableReference 和 ActionBinding。
8. 记录 query、resolve、sync 和 action exposure 相关审计信息。

Catalog Node 可以使用任意内部检索机制，包括关键词检索、向量检索、规则匹配、图检索、混合排序、专有匹配模型或人工审核流程。协议只约束对外契约，不约束内部实现。

### 6.4 Provider

Provider 是商业对象的来源方或权威供给方。Provider 可以是商家、服务商、招聘系统、CRM、ERP、ATS、渠道系统、供应商、库存系统、本地服务平台或任意对象生产系统。

Provider 的职责包括：

1. 声明自身可提供的对象类型和字段。
2. 与 Catalog Node 完成字段级和同步能力级握手。
3. 保证供给字段的真实性、来源和生命周期。
4. 按协商结果同步对象、更新对象或删除对象。
5. 提供必要的 provider endpoints、freshness 信息和 provenance 信息。

Provider 通常接入具体 Catalog Node，而不是直接接入 Registration Node。

### 6.5 Agent/User

Agent/User 是查询方、消费方或代表用户执行商业发现流程的一方。Agent 应按照可验证路径选择 Catalog、检查 manifest、构造合法 query、解释候选结果、调用 resolve，并在动作执行前满足用户授权与权限要求。

Agent 的职责包括：

1. 根据用户意图确定对象类型和查询目标。
2. 优先使用本地缓存的 Catalog profile。
3. 在本地没有合适 Catalog 时查询 Registration Node。
4. 只使用 Catalog 声明支持的 Query Pack 和 filter fields。
5. 不发明 query_pack、route_hint、catalog_id 或字段名。
6. 对候选结果检查来源、新鲜度、可解析性和权限。
7. 仅在需要详情、动作入口或受限字段时调用 resolve。
8. 在 checkout、apply、book、contact 等动作前获得明确用户确认。

### 6.6 Action Provider

Action Provider 是实际执行后续动作的一方。Action 可以包括购买、预约、申请、联系、询价、创建 checkout、提交表单、加入候选名单或触发业务 workflow。

Action Provider 的职责包括：

1. 声明动作类型、输入参数、认证要求和状态语义。
2. 接收来自 Resolve 阶段的受约束 action invocation。
3. 执行动作并返回明确结果或状态引用。
4. 处理动作失败、过期、取消、重试和审计。

Action Provider 可以与 Provider 是同一实体，也可以是独立服务。

### 6.7 Federation Router

Federation Router 负责跨 Catalog 的发现、聚合、路由和信任传播。它不应默认复制全部远端对象，而应基于 route hint、profile、contract、summary、trust metadata 和 policy 进行远程优先协作。

## 7. 协议分层

### 7.1 Catalog Registration Protocol

Catalog Registration Protocol 用于 Catalog Node 与 Registration Node 之间的注册、验证和发现，也用于 Agent/User 向 Registration Node 搜索合适 Catalog。

该协议回答以下问题：

1. 哪些 Catalog 存在。
2. Catalog 的身份、域名、能力、对象类型和健康状态是什么。
3. Catalog 支持哪些 query packs、resolve 能力、认证方式和信任等级。
4. Agent 应该如何路由到某个 Catalog。
5. CatalogRouteHint 的 TTL、snapshot 和验证状态是什么。

Registration 协议不回答具体商业对象是什么，也不承担商品搜索、库存查询或职位匹配。

### 7.2 Catalog Handshake Protocol

Catalog Handshake Protocol 用于 Provider 与 Catalog Node 之间的接入协商。它回答以下问题：

1. Provider 可以提供哪些对象类型。
2. Provider 能保证哪些字段。
3. Catalog 要求哪些 required fields、compatible field groups 和 additional fields policy。
4. 双方支持哪些 sync capability。
5. Provider 应通过 push、pull、feed、streaming、delta 或其他方式同步对象。
6. ProviderRegistration 是否成功，以及成功后使用哪个 selected_sync_capability。

Handshake 协议只建立接入关系和同步契约，不承载大规模对象数据本身。

### 7.3 Catalog Query Protocol

Catalog Query Protocol 用于 Agent 或应用向 Catalog Node 检索商业对象。它应以 Query Pack 为单位声明输入、输出、过滤、排序、解释、语言、地理、认证和限流能力。

Query 协议统一的是对外查询契约，而不是内部搜索算法。Catalog 可以使用不同召回和排序机制，只要输出符合声明的 Query Contract。

### 7.4 Catalog Resolve Protocol

Catalog Resolve Protocol 用于对具体 CatalogEntry 执行权限化解析。Resolve 返回的是当前上下文下可被使用的 ResolvableReference，而不是无条件完整对象。

Resolve 可以返回：

1. 更完整但受限的字段。
2. 实时校验后的价格、库存、可预约性、职位状态或服务状态。
3. 对象来源、更新时间、验证状态和过期时间。
4. 可执行 ActionBinding。
5. 需要用户授权、登录、支付信任或二次确认的要求。

### 7.5 Action Binding Protocol

Action Binding Protocol 连接 Resolve 结果与执行层。它描述动作类型、输入参数、认证要求、幂等键、过期时间、风险等级、用户确认要求和审计字段。

Action Binding 不应把 Catalog 变成订单系统。Catalog 暴露动作入口，具体动作由 Action Provider 或业务系统执行。

### 7.6 Transport and Adapter Layer

Transport and Adapter Layer 将 OCP 的核心语义映射到 REST、MCP、Webhook、A2A、SDK、CLI 或平台私有 API。绑定层可以优化不同调用方的体验，但不应改变核心对象模型和职责边界。

MCP 适合作为 Agent-facing orchestration layer。MCP 工具可以提供任务型入口，例如搜索 Catalog、检查 Catalog、查询 Catalog、解析条目或自然语言组合检索。该层不应被视为 OCP Catalog 的唯一协议形态。

## 8. 核心数据模型

### 8.1 CatalogProfile

CatalogProfile 描述一个 Catalog 的稳定身份、能力摘要、信任状态和可发现信息。它面向 Registration Node、Agent、本地 profile cache 和 Federation Router。

建议字段包括：

| 字段 | 含义 |
| --- | --- |
| `catalog_id` | Catalog 的稳定身份标识 |
| `display_name` | 面向人类和 Agent 的名称 |
| `description` | Catalog 服务范围的客观描述 |
| `base_url` | Catalog 的协议根地址 |
| `manifest_url` | CatalogManifest 地址 |
| `supported_object_types` | 支持的商业对象类型 |
| `supported_query_packs` | 支持的查询包摘要 |
| `supported_descriptor_packs` | 支持的语义扩展包摘要 |
| `resolve_capabilities` | 是否支持 resolve、remote resolve、live check |
| `trust_profile` | 信任等级、验证状态、签名状态 |
| `health` | 可用性、延迟、错误率或健康状态 |
| `freshness` | profile 更新时间和过期策略 |

### 8.2 CatalogManifest

CatalogManifest 是 Catalog Node 对外发布的能力声明。它是 Agent、Provider、Registration Node 和 Federation Router 理解 Catalog 的主要入口。

CatalogManifest 应包含：

1. Catalog 身份与版本。
2. 协议版本与兼容策略。
3. Endpoint 列表。
4. Query capability 列表。
5. Resolve capability 列表。
6. Provider-facing contract。
7. ObjectContract 列表。
8. SyncCapability 列表。
9. Auth requirements。
10. Rate limits。
11. Trust、health、freshness 和 signature 信息。

示例结构：

```json
{
  "catalog_id": "catalog.example.commerce",
  "protocol_versions": ["ocp.catalog.registration.v1", "ocp.catalog.handshake.v1"],
  "endpoints": {
    "query": "https://catalog.example.com/ocp/query",
    "resolve": "https://catalog.example.com/ocp/resolve",
    "provider_register": "https://catalog.example.com/ocp/providers/register"
  },
  "object_contracts": ["commerce.product.v1", "local.service.v1"],
  "query_packs": ["keyword.v1", "semantic.v1", "geo.v1"],
  "sync_capabilities": ["ocp.feed.url.v1", "ocp.pull.api.v1"],
  "auth": {
    "search": "none",
    "resolve": "user_or_agent_token"
  }
}
```

### 8.3 CatalogRouteHint

CatalogRouteHint 是 Registration Node 返回给 Agent 的可缓存路由摘要。它不是完整 manifest，也不应包含 secret。

CatalogRouteHint 应包含：

1. Catalog 身份。
2. Manifest URL。
3. Query URL 和 Resolve URL。
4. 支持的 query packs 摘要。
5. 支持的对象类型摘要。
6. 信任、健康和验证摘要。
7. TTL 与 snapshot 时间。
8. 必要的认证提示。

### 8.4 CommercialObject

CommercialObject 是通用商业对象包络。它表达对象本体，不假设对象一定是商品。

建议字段包括：

| 字段 | 含义 |
| --- | --- |
| `object_id` | Provider 或 Catalog 范围内稳定对象标识 |
| `object_type` | 对象类型，如 product、service、job、talent、rfq、opportunity |
| `provider_id` | 来源 Provider |
| `source_authority` | 对象权威来源 |
| `summary` | 可索引、可展示的摘要 |
| `descriptors` | DescriptorInstance 列表 |
| `visibility_policy` | 字段级可见性策略 |
| `access_policy` | 查询和解析访问策略 |
| `provenance` | 来源、生成方式、签名、更新时间 |
| `freshness` | 新鲜度、TTL、过期时间 |
| `resolve_policy` | 可解析性和解析要求 |

### 8.5 Descriptor Pack

Descriptor Pack 是行业语义扩展包。它用于把不同商业场景的专有字段组织成可命名、可版本化、可验证的 schema。

Descriptor Pack 应具备：

1. 命名空间。
2. 版本。
3. JSON Schema 或等价 schema。
4. 字段语义说明。
5. 字段用途分类，例如 indexing、filtering、ranking、display、explain、resolve。
6. 可见性和敏感性标记。
7. 与 Query Pack 或 ObjectContract 的引用关系。

示例 Descriptor Pack：

| Pack | 适用场景 | 典型字段 |
| --- | --- | --- |
| `commerce.product.v1` | 商品 | brand、sku、price、availability、category |
| `local.service.v1` | 本地服务 | location、service_area、availability_window、duration |
| `talent.profile.v1` | 人才 | skills、experience、location、availability |
| `b2b.rfq.v1` | 采购需求 | quantity、deadline、budget、certification |
| `channel.opportunity.v1` | 渠道合作 | region、commission、eligibility、territory |

### 8.6 Descriptor Contract

Descriptor Contract 表达 Catalog 对对象接入的字段级要求。它用于判断 Provider 声明是否满足 Catalog 的索引、查询、展示、解释和 resolve 需要。

Descriptor Contract 应描述：

1. Required fields。
2. Compatible field groups。
3. Optional fields。
4. Additional fields policy。
5. 字段用途。
6. 字段敏感性。
7. 字段可见性。
8. 字段验证要求。

### 8.7 ProviderRegistration

ProviderRegistration 是 Provider 向 Catalog Node 发出的接入声明。它用于表达 Provider 能力，而不是传输批量对象数据。

ProviderRegistration 应包含：

1. Provider 身份。
2. 支持对象类型。
3. Object declarations。
4. Guaranteed fields。
5. Provider endpoints。
6. 支持的 sync capabilities。
7. Auth profile。
8. 数据来源和验证声明。

### 8.8 RegistrationResult

RegistrationResult 是 Catalog Node 对 ProviderRegistration 的协商结果。它应清晰说明是否接受接入、接受哪些对象声明、选择哪个同步能力、缺失哪些字段以及后续同步方式。

建议字段包括：

| 字段 | 含义 |
| --- | --- |
| `status` | accepted、rejected、partial、pending |
| `accepted_object_declarations` | 被接受的对象声明 |
| `rejected_object_declarations` | 被拒绝的对象声明和原因 |
| `selected_sync_capability` | 选定同步能力 |
| `required_changes` | Provider 需要调整的字段或 endpoint |
| `sync_instructions` | 后续同步入口和约束 |
| `expires_at` | 协商结果过期时间 |

### 8.9 CatalogEntry

CatalogEntry 是 CommercialObject 在某个 Catalog 内的索引投影。它不是对象全文，也不必等同于 Provider 原始记录。

CatalogEntry 应支持：

1. 搜索召回。
2. 排序。
3. 去重。
4. 聚合。
5. 权限过滤。
6. 解释展示。
7. 新鲜度判断。
8. resolve 引用。

建议字段包括：

| 字段 | 含义 |
| --- | --- |
| `entry_id` | Catalog 范围内的条目标识 |
| `object_ref` | 指向 CommercialObject 或远端对象 |
| `object_type` | 对象类型 |
| `summary` | 搜索结果摘要 |
| `match_features` | 匹配特征摘要 |
| `ranking_signals` | 可解释的排序信号 |
| `visibility_projection` | 当前查询上下文可见字段 |
| `freshness` | 索引更新时间和过期状态 |
| `provenance` | 来源摘要 |
| `resolvable` | 是否可 resolve |

### 8.10 Query Pack

Query Pack 定义一种查询模式的输入、输出和行为约束。它使不同 Catalog 能以统一方式声明能力，而不要求内部算法一致。

常见 Query Pack 包括：

1. `keyword`：关键词检索。
2. `filter`：结构化过滤。
3. `semantic`：语义匹配。
4. `geo`：地理位置检索。
5. `price_compare`：价格或报价比较。
6. `talent_match`：人才或职位匹配。
7. `availability`：时段、库存或容量匹配。
8. `rfq_match`：采购需求和供应能力匹配。

QueryPackBinding 应声明：

1. 输入 schema。
2. 输出 schema。
3. 支持 filter fields。
4. 支持 sort fields。
5. 认证要求。
6. 限流策略。
7. 是否支持 explain。
8. 是否支持 streaming。
9. 是否支持 remote resolve。

### 8.11 QueryResult

QueryResult 是 Catalog 对 query 请求的响应。它应保留查询解释和结果可信度，而不是只返回对象列表。

QueryResult 应包含：

1. `query_id`。
2. `catalog_id`。
3. `query_pack`。
4. `interpreted_intent`。
5. `entries`。
6. `facets`。
7. `explanations`。
8. `freshness`。
9. `warnings`。
10. `next_page_token`。

### 8.12 ResolvableReference

ResolvableReference 是 Resolve 阶段的输出。它代表在特定权限、上下文、时间和用途下可继续交互的对象引用。

ResolvableReference 可以包含：

1. 对象详情。
2. 受限字段。
3. 实时状态。
4. 来源证明。
5. 过期时间。
6. ActionBinding 列表。
7. 用户确认要求。
8. 风险提示。
9. 审计标识。

### 8.13 ActionBinding

ActionBinding 描述已解析对象可以执行的下一步动作。它不直接执行动作，而是给出动作入口、参数约束和调用要求。

常见动作包括：

| 动作 | 场景 |
| --- | --- |
| `buy` | 商品购买 |
| `create_checkout` | 创建 checkout intent |
| `book` | 本地服务预约 |
| `apply` | 职位或机会申请 |
| `request_quote` | 请求报价 |
| `contact` | 联系 Provider |
| `reserve` | 暂留库存、席位或时段 |
| `submit_profile` | 提交候选人或企业资料 |

ActionBinding 应声明：

1. `action_type`。
2. Endpoint 或 invocation target。
3. 输入 schema。
4. Auth requirements。
5. User confirmation requirements。
6. Idempotency requirements。
7. Expiration。
8. Risk level。
9. Audit fields。

### 8.14 Policy and Trust Objects

OCP Catalog 应把权限、信任和治理作为一等对象建模。

核心对象包括：

| 对象 | 作用 |
| --- | --- |
| `VisibilityPolicy` | 控制字段是否可见、在哪个阶段可见、对哪个角色可见 |
| `AccessPolicy` | 控制 query、resolve、action 是否需要认证、授权或用途声明 |
| `ProvenanceRecord` | 记录对象来源、生成方式、签名、Provider、更新时间 |
| `VerificationRecord` | 记录域名验证、签名验证、人工审核、第三方验证 |
| `FreshnessRecord` | 描述数据更新时间、TTL、实时校验能力 |
| `QueryAuditRecord` | 记录查询目的、主体、结果范围和策略命中 |
| `ResolveAuditRecord` | 记录解析主体、字段暴露、动作暴露和确认要求 |

## 9. Catalog 能力声明

Catalog 的能力声明是互操作的关键。一个 Catalog 应通过 discovery document 和 CatalogManifest 表达自身边界，而不是依赖调用方猜测。

### 9.1 Discovery Document

Discovery Document 是最小入口，用于指向 manifest、协议版本和基本身份。典型路径可以采用 `/.well-known/ocp-catalog`。

Discovery Document 应保持小而稳定。它适合包含：

1. Catalog ID。
2. Manifest URL。
3. Supported protocol versions。
4. Public key 或 signature metadata。
5. Health URL。

### 9.2 Manifest

Manifest 是完整能力声明。它应支持缓存、签名、版本化和兼容性检查。

Manifest 应回答：

1. 该 Catalog 服务哪些对象类型。
2. 该 Catalog 支持哪些查询模式。
3. 该 Catalog 如何进行 resolve。
4. Provider 如何接入。
5. 对象同步如何协商。
6. 哪些字段可用于 filter、sort、display、explain 和 resolve。
7. 哪些操作需要认证、授权或用户确认。
8. Manifest 本身何时过期、如何验证、如何更新。

### 9.3 Query Capability

Query Capability 应使用机器可读形式声明。调用方必须根据声明构造 query，不应假设字段存在。

Query Capability 应包括：

1. Query Pack ID。
2. Input schema。
3. Output schema。
4. Supported object types。
5. Filter fields。
6. Sort fields。
7. Facet fields。
8. Explain support。
9. Pagination support。
10. Authentication requirements。

### 9.4 Resolve Capability

Resolve Capability 应声明：

1. 支持 resolve 的 object types。
2. Resolve 输入结构。
3. Resolve 输出结构。
4. 可返回字段类别。
5. 是否支持 live check。
6. 是否支持 action bindings。
7. 是否需要用户身份、agent token 或 purpose declaration。
8. Resolve 结果的 TTL 和审计要求。

### 9.5 Provider-Facing Capability

Provider-Facing Capability 应声明 Provider 如何接入。它应包括：

1. Provider registration endpoint。
2. Object contracts。
3. Required fields。
4. Compatible field groups。
5. Additional fields policy。
6. Supported sync capabilities。
7. Provider auth requirements。
8. Payload size limits。
9. Rate limits。
10. Validation rules。

## 10. Provider 接入与对象同步

### 10.1 接入流程

Provider 接入 Catalog 的流程应分为四步：

1. Discovery：Provider 获取 Catalog discovery document。
2. Manifest Inspection：Provider 检查 ObjectContract、sync capability 和接入要求。
3. Registration：Provider 提交 ProviderRegistration。
4. Sync：Provider 根据 RegistrationResult 使用选定能力同步对象。

该流程避免把注册和数据传输混在一起。注册只建立契约，同步才传输对象变化。

### 10.2 字段级协商

字段级协商应围绕 required fields、guaranteed fields 和 compatible field groups 进行。

Catalog 应明确：

1. 哪些字段是索引必需字段。
2. 哪些字段是展示必需字段。
3. 哪些字段是 filter 或 sort 必需字段。
4. 哪些字段仅在 resolve 阶段需要。
5. 哪些字段可以替代或组合满足同一语义。
6. 哪些字段不接受或只接受为 opaque metadata。

Provider 应明确：

1. 能保证哪些字段。
2. 字段来源是什么。
3. 字段更新时间和过期策略。
4. 字段是否敏感。
5. 字段是否可以用于索引、展示、过滤、排序或解释。

### 10.3 同步能力

Sync Capability 应使用稳定 `capability_id` 协商。常见同步方式包括：

| 能力 | 含义 |
| --- | --- |
| `ocp.feed.url` | Catalog 从 Provider 暴露的 feed 拉取对象 |
| `ocp.pull.api` | Catalog 通过 Provider API 拉取对象 |
| `ocp.push.api` | Provider 主动推送对象变化 |
| `ocp.streaming` | Provider 持续推送对象事件流 |
| `ocp.delta.log` | Provider 暴露增量变更日志 |
| `ocp.snapshot` | Provider 定期提供完整快照 |

RegistrationResult 应明确选定哪种能力，以及该能力的 endpoint、认证方式、频率、重试策略、幂等要求和失败处理。

### 10.4 生命周期事件

对象同步应支持基本生命周期事件：

1. `created`：新增对象。
2. `updated`：对象字段更新。
3. `deleted`：对象删除。
4. `unavailable`：对象暂时不可用。
5. `expired`：对象过期。
6. `replaced`：对象被新对象替代。
7. `tombstoned`：对象删除标记，需要传播到缓存和联邦摘要。

CatalogEntry 应能反映这些事件对搜索、排序、可见性和 resolve 的影响。

## 11. Catalog 发现与路由

### 11.1 Registration Discovery

Agent 或应用可以通过 Registration Node 搜索合适 Catalog。搜索请求应描述目标对象类型、领域、语言、地区、查询模式、信任要求、认证能力和用途。

Registration Node 应返回 CatalogSearchResult，而不是商业对象搜索结果。

### 11.2 CatalogIndexEntry

CatalogIndexEntry 是 Registration Node 对 Catalog 的索引投影。它应包含足够的发现信息，但不包含 Catalog 的私有对象数据。

CatalogIndexEntry 可包含：

1. Catalog ID。
2. 对象类型摘要。
3. 行业或领域标签。
4. 地理覆盖范围。
5. 语言支持。
6. Query Pack 支持。
7. Trust tier。
8. Health status。
9. Freshness。
10. Manifest snapshot hash。

### 11.3 Route Hint 使用

CatalogRouteHint 用于减少 Agent 的二次发现成本。Agent 可以缓存 route hint，但必须遵守 TTL、manifest version、signature 和 health 标记。

Agent 使用 route hint 时应：

1. 检查 TTL。
2. 检查 Catalog health。
3. 检查支持的 object types 和 query packs。
4. 检查是否需要重新获取 manifest。
5. 不把 route hint 当作完整能力声明。
6. 不把 route hint 中没有声明的字段或 query pack 当作可用。

### 11.4 本地 Profile Cache

Agent 可以维护本地 Catalog profile cache，用于常用 Catalog 的快速路由。该缓存应是路由缓存，不是完整对象缓存。

本地缓存应保存：

1. Catalog profile。
2. Route hint。
3. Manifest snapshot hash。
4. Query pack support。
5. Trust and health summary。
6. Last used time。
7. TTL and revalidation policy。

## 12. Query 与 Resolve 使用方法

### 12.1 Agent 查询流程

标准 Agent 查询流程如下：

1. 识别用户意图、对象类型、地理范围、预算、时间、约束条件和动作目标。
2. 查询本地 Catalog profile cache。
3. 如果本地没有合适 Catalog，则向 Registration Node 搜索 Catalog。
4. 选择一个或多个符合条件的 Catalog。
5. 获取或验证 CatalogManifest。
6. 选择 Catalog 声明支持的 Query Pack。
7. 构造符合 schema 的 query。
8. 接收 QueryResult 并解释候选。
9. 根据用户选择或业务需要调用 resolve。
10. 检查 Resolve 输出的字段、状态、ActionBinding、过期时间和确认要求。
11. 在动作执行前进行用户确认和必要授权。

### 12.2 Query 构造原则

Query 构造应遵守：

1. 只使用 manifest 声明的 query pack。
2. 只使用 manifest 声明的 filter fields、sort fields 和 facet fields。
3. 对不确定字段应省略，而不是猜测。
4. 对自然语言意图应保留原始 query_text 和结构化解释。
5. 对价格、库存、可用性、位置和时间等高变字段应要求 freshness 或 live check。
6. 对敏感领域应附带 purpose declaration。
7. 对多 Catalog 查询应保留每个 Catalog 的独立解释和 provenance。

### 12.3 Query 结果解释

QueryResult 不应只是候选列表。它还应帮助 Agent 判断：

1. 为什么这些候选被返回。
2. 哪些条件被满足。
3. 哪些条件无法验证。
4. 结果是否新鲜。
5. 结果来源是否可信。
6. 是否需要 resolve。
7. 是否存在权限或认证限制。

### 12.4 Resolve 调用时机

Resolve 应在以下情况下调用：

1. 用户或业务流程已选中具体候选。
2. 需要查看受限字段。
3. 需要获得实时价格、库存、可预约性或职位状态。
4. 需要获得动作入口。
5. 需要执行 checkout、apply、book、contact 或 request_quote 前的上下文。
6. 需要审计字段暴露或动作暴露。

Resolve 不应被用于无差别批量抓取对象详情。

### 12.5 动作执行边界

Catalog Resolve 可以暴露 ActionBinding，但动作执行应发生在 Action Provider 或业务系统中。Agent 在执行动作前应检查：

1. 用户确认。
2. 权限和身份。
3. ActionBinding 是否过期。
4. 输入参数是否满足 schema。
5. 幂等键是否存在。
6. 风险等级是否允许自动执行。
7. 是否需要支付信任层、二次认证或人工确认。

## 13. 接口支持

### 13.1 Registration Node 接口

Registration Node 的接口应面向 Catalog 发现和路由。

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/.well-known/ocp-registration` | GET | 获取 Registration Node discovery document |
| `/ocp/registration/manifest` | GET | 获取 Registration Node 能力声明 |
| `/ocp/catalogs/register` | POST | Catalog 向 Registration Node 注册或更新 profile |
| `/ocp/catalogs/search` | POST | Agent/User 搜索合适 Catalog |
| `/ocp/catalogs/resolve` | POST | 解析 Catalog profile 或获取 route hint 详情 |
| `/ocp/catalogs/health` | GET/POST | 检查或上报 Catalog 健康状态 |

### 13.2 Catalog Node 接口

Catalog Node 的接口应面向 Catalog 能力声明、Provider 接入、对象查询和对象解析。

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/.well-known/ocp-catalog` | GET | 获取 Catalog discovery document |
| `/ocp/manifest` | GET | 获取 CatalogManifest |
| `/ocp/contracts` | GET | 获取 ObjectContract 和 Descriptor Contract |
| `/ocp/providers/register` | POST | Provider 接入 Catalog |
| `/ocp/objects/sync` | POST | Provider 推送对象变化 |
| `/ocp/query` | POST | Agent 或应用查询 CatalogEntry |
| `/ocp/resolve` | POST | 解析具体 CatalogEntry |
| `/ocp/audit/events` | POST | 接收或写入审计事件 |

### 13.3 Provider 接口

Provider 接口由 Provider 暴露给 Catalog，用于拉取、同步或验证对象。

| 接口类型 | 作用 |
| --- | --- |
| Feed URL | 暴露对象 feed 或快照 |
| Pull API | 允许 Catalog 拉取对象或增量 |
| Webhook | 接收 Catalog 的验证或状态回调 |
| Streaming endpoint | 输出持续对象事件流 |
| Verification endpoint | 验证对象来源、签名或权威状态 |
| Action endpoint | 执行 Provider 拥有的动作 |

### 13.4 MCP 工具支持

MCP 支持应面向 Agent 使用体验，而不是机械映射所有 HTTP endpoint。工具设计应将底层协议组织成任务型操作。

典型 MCP 工具包括：

| 工具 | 作用 |
| --- | --- |
| `search_catalogs` | 根据意图发现合适 Catalog |
| `inspect_catalog` | 检查 Catalog manifest、query packs 和 resolve 能力 |
| `query_catalog` | 对指定 Catalog 执行对象查询 |
| `resolve_catalog_entry` | 解析指定条目，获取详情和动作入口 |
| `find_and_query_catalog` | 将 Catalog 发现和对象查询组合成自然语言检索路径 |

MCP 工具应明确说明：Catalog discovery 与 object query 是不同阶段；Registration Node 搜索 Catalog，Catalog Node 查询对象。

### 13.5 REST 与 Webhook 支持

REST 适合标准 request/response 查询、注册和解析。Webhook 适合 Provider 对象变更、健康状态、验证结果和动作状态回调。

REST 与 Webhook 应共同遵守：

1. 幂等性。
2. 签名校验。
3. 重试策略。
4. 过期时间。
5. body size limit。
6. rate limit。
7. audit correlation id。

### 13.6 Streaming 支持

Streaming 适合高频对象变化、实时库存、可用时段、价格变动、职位状态或渠道机会变更。Streaming 不应替代基本 snapshot 或 delta log，而应作为高新鲜度场景的增强能力。

## 14. 权限、安全与治理

### 14.1 字段级可见性

字段级可见性应覆盖 search、resolve 和 action 三个阶段。

例如：

| 字段类别 | Search 阶段 | Resolve 阶段 | Action 阶段 |
| --- | --- | --- | --- |
| 公共摘要 | 可见 | 可见 | 可见 |
| 价格区间 | 可见 | 可实时确认 | 可作为 checkout 输入 |
| 精确库存 | 可隐藏或模糊 | 可实时确认 | 可锁定或保留 |
| 联系方式 | 通常不可见 | 认证后可见 | 用户确认后可用 |
| 支付凭证 | 不可见 | 不可见 | 仅由支付信任层处理 |

### 14.2 Purpose-Based Access

访问请求应声明用途，例如 search、compare、quote、checkout、apply、book 或 audit。Catalog 可以基于用途决定字段可见性、resolve 强度和动作暴露。

### 14.3 身份与认证

OCP Catalog 应支持多种身份主体：

1. Anonymous user。
2. Authenticated user。
3. Delegated Agent。
4. Enterprise application。
5. Provider system。
6. Catalog federation node。

不同主体可以拥有不同 query、resolve 和 action 权限。

### 14.4 Trust Profile

Trust Profile 应包含：

1. Domain verification。
2. Signed manifest。
3. Provider verification。
4. Catalog health。
5. Abuse reports。
6. Freshness SLA。
7. Audit capability。
8. Manual review status。

Trust Profile 不应作为永久保证，而应随健康状态、验证状态和行为记录动态更新。

### 14.5 Provenance

Provenance 应回答：

1. 对象来自哪个 Provider。
2. 字段由谁提供。
3. 字段何时更新。
4. 字段是否经过验证。
5. 字段是否由模型生成、抽取或标准化。
6. 字段是否可以用于决策或动作执行。

### 14.6 Audit

Audit 应覆盖：

1. Catalog discovery。
2. Query。
3. Result exposure。
4. Resolve。
5. Restricted field exposure。
6. ActionBinding exposure。
7. Action invocation。
8. Policy denial。
9. Provider sync。
10. Federation routing。

审计记录应支持 correlation id，使跨 Catalog、Provider 和 Action Provider 的流程可以被追踪。

### 14.7 风险控制

OCP Catalog 应考虑以下风险：

1. Catalog 路由错误。
2. Provider 数据过期。
3. 价格、库存或可用性变化。
4. Agent 发明字段或 query pack。
5. Resolve 暴露过多字段。
6. ActionBinding 被重放。
7. Federation 缓存污染。
8. Provider spam 或恶意注册。
9. Manifest 被篡改。
10. 用户授权过期。

对应控制包括 signed manifest、domain challenge、schema validation、rate limit、field redaction、purpose-based access、freshness TTL、idempotency key、audit trail 和 trust tier。

## 15. 联邦与缓存

### 15.1 联邦对象

Federation 不应默认交换完整对象。优先交换对象包括：

1. CatalogProfile。
2. CatalogRouteHint。
3. Manifest snapshot hash。
4. Query Pack support summary。
5. Object type coverage summary。
6. Trust metadata。
7. Health metadata。
8. Freshness metadata。
9. Mutation log summary。
10. Tombstone。

### 15.2 缓存分类

OCP Catalog 中存在多类缓存：

| 缓存 | 内容 | 风险 |
| --- | --- | --- |
| Profile cache | Catalog profile 和 route hint | 路由过期 |
| Manifest cache | CatalogManifest snapshot | 能力变化 |
| Query cache | 查询结果摘要 | 数据过期或权限变化 |
| Resolve cache | 受限详情和 action references | 高风险，通常需要短 TTL |
| Trust cache | 验证、健康和声誉摘要 | 信任状态滞后 |
| Federation summary cache | 远端覆盖范围和摘要 | 召回偏差 |

### 15.3 缓存策略

缓存策略应遵守：

1. Route hint 必须有 TTL。
2. Manifest 应有版本、签名和 hash。
3. Query result 应携带 freshness。
4. Resolve result 应短 TTL 或禁止缓存。
5. 权限敏感字段不应进入共享缓存。
6. Tombstone 应优先传播。
7. Trust downgrade 应使相关缓存失效。

## 16. 多元性设计

### 16.1 商业对象多样性

OCP Catalog 的对象类型不应限定于商品。典型对象包括：

| 对象类型 | 示例 |
| --- | --- |
| Product | 商品、SKU、组合包 |
| Service | 家政、维修、咨询、课程 |
| Talent | 候选人、专家、自由职业者 |
| Job | 职位、项目岗位、短期任务 |
| RFQ | 采购需求、询价单 |
| Supplier | 供应商、制造商、渠道商 |
| Opportunity | 招商、代理、分销、合作机会 |
| Booking Resource | 房间、设备、时间段、席位 |
| Workflow Entry | 可被启动的业务流程入口 |

### 16.2 查询模式多样性

不同对象需要不同查询模式。商品常用关键词、价格、库存和品牌过滤；服务常用位置、时间和资质过滤；招聘常用技能、经验和地点匹配；B2B 常用预算、交期、认证和产能约束。

Query Pack 允许这些差异以可声明方式存在，而不污染核心对象模型。

### 16.3 动作多样性

不同对象的后续动作不同。Product 可能进入 checkout，Service 可能进入预约，Talent 可能进入联系或面试流程，RFQ 可能进入报价，Opportunity 可能进入申请或审核。

ActionBinding 用统一结构描述动作入口，但动作语义由 action type 和 action contract 扩展。

### 16.4 语义扩展多样性

Descriptor Pack 支持按行业组织字段。不同 Descriptor Pack 可以组合在同一个 CommercialObject 上。例如一个本地课程可以同时使用 service、booking 和 education descriptor。

### 16.5 平台适配多样性

商家系统、招聘系统、CRM、ERP、ATS、支付信任层、物流系统和平台 API 都可以通过 adapter 映射到 OCP Catalog 模型。Adapter 应承担格式转换和平台认证，不应改变 OCP 的核心语义。

## 17. 可扩展性设计

### 17.1 协议版本扩展

协议版本应独立声明。Catalog 可以同时支持多个协议版本，并通过 manifest 明确兼容范围。

扩展原则：

1. 新增字段优先使用可选字段。
2. 新增能力优先使用 capability object。
3. 破坏性变更必须提升 protocol version 或 contract version。
4. Descriptor Pack、Query Pack 和 Action Contract 应独立版本化。
5. 调用方必须基于 manifest 判断能力，而不是基于固定假设。

### 17.2 Descriptor Pack 扩展

Descriptor Pack 扩展应满足：

1. 命名空间唯一。
2. 版本明确。
3. schema 可验证。
4. 字段用途清晰。
5. 敏感性和可见性可声明。
6. 与 Query Pack 和 ObjectContract 可组合。

### 17.3 Query Pack 扩展

新增 Query Pack 不应要求所有 Catalog 支持。Catalog 可以按自身对象类型和业务能力选择支持。

Query Pack 应包含：

1. Query semantics。
2. Input schema。
3. Output schema。
4. Error model。
5. Explain model。
6. Pagination model。
7. Auth requirements。
8. Compatibility notes。

### 17.4 Action Contract 扩展

Action Contract 应支持新增动作类型。动作类型应明确：

1. 业务含义。
2. 输入参数。
3. 状态结果。
4. 幂等策略。
5. 认证方式。
6. 用户确认要求。
7. 风险等级。
8. 审计要求。

### 17.5 Federation 扩展

Federation 扩展应优先保持低耦合。一个 Catalog 加入联邦时，应只需要暴露 profile、manifest、route hint、trust metadata 和 query/resolve endpoint。是否暴露对象 summary、mutation log 或远端 resolve 能力应由 manifest 和 trust policy 决定。

## 18. 典型场景

### 18.1 电商商品发现

Agent 根据用户意图搜索合适的商品 Catalog，查询商品候选，比较价格、库存、品牌、评价或配送约束。用户选中候选后，Agent 调用 resolve 获取实时价格、库存、商品 URL 或 checkout action。支付和订单由商家系统或支付信任层执行。

### 18.2 本地服务预约

Agent 搜索支持本地服务的 Catalog，查询服务类型、位置、时间窗口、服务范围和资质。Resolve 返回可预约时段、服务详情、商家联系规则和 book action。预约执行由服务平台或商家系统完成。

### 18.3 人才与招聘

Agent 查询人才、职位或项目需求。CatalogEntry 可展示摘要、技能匹配、地点和经验范围。Resolve 可在权限允许时返回更详细简历、联系方式、申请入口或面试安排 action。

### 18.4 B2B 采购与报价

采购方 Agent 搜索供应商或 RFQ Catalog，查询满足品类、数量、认证、地区、交期和预算的候选。Resolve 返回受权限控制的供应商详情、报价入口、资质证明和 request_quote action。

### 18.5 渠道合作与招商机会

Agent 查询渠道机会、代理资格、地区范围、佣金结构和准入条件。Resolve 返回申请入口、材料要求、合作方联系规则和 apply action。

### 18.6 可交互工作流入口

Catalog 可以暴露 workflow entry，例如开通服务、提交申请、创建报价、发起维修或触发内部审批。Query 用于发现合适 workflow，Resolve 返回 action schema、权限要求和执行入口。

## 19. 错误模型

OCP Catalog 应提供结构化错误，而不是只返回文本错误。

常见错误类别包括：

| 错误 | 含义 |
| --- | --- |
| `catalog_not_found` | 未找到合适 Catalog |
| `manifest_unavailable` | Catalog manifest 不可用 |
| `unsupported_query_pack` | Query Pack 不被支持 |
| `invalid_query` | Query 不符合 schema |
| `policy_denied` | 权限或用途限制拒绝 |
| `entry_not_found` | 指定 entry 不存在 |
| `entry_not_resolvable` | entry 不支持 resolve |
| `stale_result` | 结果过期，需要重新查询或 live check |
| `provider_unavailable` | Provider 不可用 |
| `action_expired` | ActionBinding 已过期 |
| `trust_insufficient` | 信任等级不满足调用要求 |

错误响应应包含 machine-readable code、human-readable message、retryability、required_action、correlation_id 和 audit reference。

## 20. 兼容性与演进

OCP Catalog 的演进应优先通过能力声明和版本化 contract 进行。

兼容演进包括：

1. 新增可选字段。
2. 新增 Descriptor Pack。
3. 新增 Query Pack。
4. 新增 Action Contract。
5. 新增 Sync Capability。
6. 新增 trust metadata。

破坏性演进包括：

1. 删除 required fields。
2. 改变字段语义。
3. 改变 query 输入或输出结构。
4. 改变 resolve 权限模型。
5. 改变 action invocation contract。
6. 改变对象身份规则。

破坏性演进应提升对应 protocol version、contract version 或 pack version，并通过 manifest 明确声明。

## 21. 设计约束总结

OCP Catalog 的长期设计可以总结为以下约束：

1. Registration Node 搜索 Catalog，不搜索商业对象。
2. Catalog Node 搜索和解析商业对象。
3. Provider 接入 Catalog，不直接向 Registration Node 提交对象。
4. ProviderRegistration 建立接入契约，不传输批量对象。
5. Object sync 独立于 registration handshake。
6. Search 返回候选和解释，Resolve 返回权限化详情和动作入口。
7. ActionBinding 暴露动作入口，不把 Catalog 变成动作执行系统。
8. CommercialObject 是通用对象包络，不以商品为唯一中心。
9. Descriptor Pack、Query Pack 和 Action Contract 承载行业差异。
10. 权限、信任、来源、新鲜度和审计是核心协议要素，而不是外围功能。
11. Federation 优先交换路由、能力、摘要和信任信息，不默认复制完整对象。
12. MCP、REST、Webhook、A2A 和平台 API 属于绑定层或适配层，不改变核心模型。

## 22. 术语表

| 术语 | 定义 |
| --- | --- |
| OCP Catalog | 商业对象发现、查询协商、权限化检索与解析协议层 |
| Registration Node | Catalog 的发现、验证、索引和路由节点 |
| Catalog Node | 商业对象索引、查询、解析和动作入口暴露节点 |
| Provider | 商业对象的来源方或权威供给方 |
| Agent/User | 查询、选择、解析和发起动作的一方 |
| CommercialObject | 通用商业对象包络 |
| Descriptor Pack | 行业语义扩展包 |
| Descriptor Contract | Catalog 对对象字段和语义的接入要求 |
| ObjectContract | Catalog 对对象类型、字段和策略的契约声明 |
| ProviderRegistration | Provider 向 Catalog 声明接入能力的请求 |
| RegistrationResult | Catalog 对 Provider 接入请求的协商结果 |
| CatalogProfile | Catalog 的身份、能力和信任摘要 |
| CatalogManifest | Catalog 的完整能力声明 |
| CatalogRouteHint | Registration Node 返回的可缓存路由摘要 |
| CatalogEntry | CommercialObject 在 Catalog 内的索引投影 |
| Query Pack | 查询模式和输入输出契约 |
| QueryPackBinding | Catalog 对某个 Query Pack 的支持声明 |
| QueryResult | Catalog query 的结构化响应 |
| Resolve | 对具体条目执行权限化解析 |
| ResolvableReference | Resolve 返回的可交互对象引用 |
| ActionBinding | Resolve 后可执行动作的入口和约束 |
| VisibilityPolicy | 字段级可见性策略 |
| AccessPolicy | query、resolve 和 action 的访问策略 |
| Provenance | 对象和字段的来源证明 |
| Freshness | 数据更新时间、TTL 和实时性声明 |
| Federation | 多 Catalog 之间的发现、路由、聚合和信任协作 |
