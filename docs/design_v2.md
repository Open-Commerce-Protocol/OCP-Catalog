> 状态说明
>
> 本文档描述的是 OCP Catalog 的长期设计目标和语义边界，不等同于当前仓库已经全部实现的功能。
>
> 当前仓库的真实实现状态请优先参考：
>
> - [../README.md](../README.md)
> - [ocp_catalog_handshake_protocol_v1.md](./ocp_catalog_handshake_protocol_v1.md)
> - [ocp_catalog_registration_protocol_v1.md](./ocp_catalog_registration_protocol_v1.md)
>
> 当前已落地的是 Phase 1 可运行闭环，包含：
>
> - Catalog -> Registration node 注册与发现
> - Provider -> Catalog 注册与对象同步
> - User / Agent -> Registration node -> Catalog 的查询与 resolve
> - 第一个 commerce product catalog 示例

1. 文档目标
本文档用于重新定义 OCP Catalog 的产品定位、系统边界、核心概念、数据模型、模块设计、API 设计、权限与治理机制、多协议兼容架构、Remote-first 联邦模式与实施路径，作为后续研发、协议演进与生态接入的基础。

---
1.1 关键角色澄清：OCP Catalog Registration node 与 Catalog Node

为防止后续实现方向混淆，本文档中的 “Catalog” 与 “OCP Catalog Registration node” 必须区分。

OCP Catalog Registration node 不是单个业务 Catalog，也不是默认存储全网商业对象的中心数据库。OCP Catalog Registration node 是 Catalog 的 Catalog，即 Catalog Registry / Catalog Discovery Node。它负责接收 Catalog 注册、验证 Catalog 身份、拉取 CatalogManifest、索引 Catalog 的查询能力与对象契约，并让用户或 Agent 能够搜索“应该使用哪个 Catalog”。

Catalog Node 是具体场景下的对象发现与检索节点，例如电商商品 Catalog、供应商渠道 Catalog、人才 Catalog、本地服务 Catalog。Catalog Node 自己实现索引引擎、Query、Resolve、权限策略和 Provider 接入。

Provider 是对象来源方，通常注册到某个 Catalog Node，而不是直接注册到 OCP Catalog Registration node。

因此，OCP 体系中的两条握手链路必须拆开：

```text
Catalog -> OCP Catalog Registration node
  使用 ocp.catalog.registration.v1
  目标：让 Catalog 被 Registration node 收录、验证、索引和发现。

Provider -> Catalog
  使用 ocp.catalog.handshake.v1
  目标：让 Provider 的对象数据被某个 Catalog 接收、校验和索引。
```

用户或 Agent 的推荐查找路径是：

```text
1. 先查本地已保存的 Catalog cache。
2. 如果没有合适 Catalog，再向 OCP Catalog Registration node 搜索 Catalog。
3. 从 Registration node 返回的 CatalogRouteHint 中获取 manifest/query/resolve 入口。
4. 按对应 Catalog 声明的 Query Capability 调用源 Catalog。
5. 对搜索结果需要进一步交互时，再调用源 Catalog 的 Resolve。
```

也就是说，OCP Catalog Registration node 的核心查询对象是 Catalog metadata；Catalog Node 的核心查询对象才是 CommercialObject / CatalogEntry。

Catalog 注册到 OCP Catalog Registration node 的协议详见 `docs/ocp_catalog_registration_protocol_v1.md`。

---
本版设计明确放弃“Catalog 仅服务电商商品发现”的假设，转而将 OCP Catalog 定位为：
一个面向通用商业对象发现、异构查询协商、权限化访问与可解析交互引用生成的开放协议层。
它的目标不是建立一个中心化的商品数据库，而是建立一个：
联邦式、协议中立、AI Native、可验证、可解释、可权限化、可扩展的商业对象发现网络。
这里的“商业对象”不限于商品，还包括但不限于：
- 商品、服务、套餐、报价单
- 人才、职位、任务、项目机会
- 采购需求、合作需求、代理机会
- 商业资源、资格、能力摘要
- 可进一步交互的 workflow entry / access point
换句话说，OCP Catalog 要回答的问题不再只是“哪里有商品”，而是：
- 有哪些商业对象存在
- 它们能否被某个 Catalog 接收与索引
- 应当如何查询它们
- 在什么权限下能看到哪些信息
- 如何把搜索结果进一步解析成可执行的下一步引用

---
2. OCP 与 OCP Catalog 的关系
2.1 OCP 的定位
OCP（Open Commerce Protocol）不是单一 Catalog 协议，而是一个更广义的开放商业协议基座。
它负责定义商业对象、发现、解析、权限、来源、信任、动作绑定与联邦协作所需的最小通用语义。
OCP 不是某个具体平台，不是某个单点索引服务，也不是某个中心化 marketplace。
2.2 OCP Catalog 的定位
OCP Catalog 是 OCP 体系中的一个核心角色，负责：
- 对外暴露 Catalog Profile
- 声明自己支持哪些对象类型
- 声明自己接受哪些 Descriptor、哪些字段是必需的
- 声明自己支持哪些 Query Pack
- 接收对象注册、自发现或远端投影
- 在本地执行搜索、匹配、排序与解释
- 在权限控制下返回候选结果
- 通过 Resolve 返回标准化 ResolvableReference
2.3 边界划分
为避免 Catalog 过度膨胀，必须明确：
OCP Catalog 负责 discovery、query negotiation、policy-aware retrieval、resolve、action exposure。
它不直接负责：
- 支付清结算
- 订单主流程编排
- ATS/CRM/ERP/OMS 的业务状态机
- 复杂审批工作流
- 全网统一交易履约系统
Catalog 可以暴露“下一步动作的标准入口”，但不应演化为“统一业务执行中台”。
2.4 建议的 OCP 角色模型
为了让 OCP 本体与 Catalog 的关系足够清晰，建议将 OCP 设计为角色化协议：
A. Catalog Role
负责发现、查询协商、候选召回、权限过滤、Resolve 与动作入口暴露。
B. Object Provider Role
负责对象本体的权威来源、字段真实性、权限策略与生命周期维护。
C. Action Provider Role
负责真正执行 buy/apply/book/request_quote/contact 等动作。
D. Federation / Router Role
负责 Catalog 节点发现、远端查询路由、结果聚合与联邦信任。
这样一来，Catalog 是 OCP 的核心角色之一，但不是 OCP 的全部。

---
3. 核心定位与问题定义
3.1 OCP Catalog 解决什么问题
OCP Catalog 负责解决的不是“如何完成交易”，而是：
在异构商业对象、异构检索逻辑、异构权限策略共存的前提下，如何建立统一的发现与解析层。
它需要支持：
- 不同类型商业对象的统一接入包络
- 每个 Catalog 自定义自己的检索、匹配与索引策略
- 每个 Catalog 声明自己要求哪些对象信息、最低接收门槛是什么
- 对象提供方声明自己提供哪些信息、哪些字段可见
- Catalog 与 Object 在协议层完成兼容性判断
- 返回可解释、可权限化、可解析的候选对象
- 联邦节点之间以 Remote-first 方式协同
3.2 OCP Catalog 不再以 Offer 为唯一中心
旧版设计默认 Catalog 的索引中心是 Offer / ItemReference，这对电商成立，但对人才市场、项目撮合、合作机会、线索市场并不成立。
因此，新的 OCP Catalog 中：
- Offer 不再是顶层中心对象
- Offer 可以成为某一类 CommercialObject
- ItemReference 被更中性的 ResolvableReference 替代
3.3 典型适用场景
OCP Catalog 需要同时适配以下场景：
电商场景
对象是商品、服务套餐、SKU 摘要、商家报价等。
人才市场场景
对象是人才档案、职位、任务、可雇佣能力、候选简历摘要等。
B2B 服务场景
对象是服务目录、资格能力、区域覆盖、报价申请入口、采购需求等。
本地生活/预约场景
对象是门店、服务时段、医生、咨询师、课程、预约入口等。
合作/招商/渠道场景
对象是合作机会、代理资格、供应能力、招商项目、分销入口等。

---
4. 设计原则
4.1 Object-Neutral Core
OCP Catalog 的核心模型必须面向通用商业对象，而不是预设商品语义。
4.2 Discovery First
优先做好对象发现、查询协商、候选解释与 Resolve，不急于做统一执行编排。
4.3 Query Negotiation Native
Catalog 不仅暴露“有什么数据”，还要暴露“怎么问它、它怎么回答”。
4.4 Schema Core + Descriptor Extension
OCP 只定义极小的核心语义；行业差异通过命名空间化 Descriptor Pack 扩展，而不是把所有行业统一进一个超大 Schema。
4.5 Contract-Based Compatibility
Catalog 与 Object 的兼容性，不靠口头约定，而靠可机器判断的 Descriptor Contract。
4.6 Permission by Design
权限不是附加特性，而是设计中心。搜索、结果、Resolve、动作暴露都必须原生支持受限可见性。
4.7 Trust by Design
任何被发现的数据都必须附带来源、验证状态、信任等级与新鲜度，而不能只靠声明。
4.8 Private Model, Public Contract
每个 Catalog 可以拥有私有检索模型和排序策略，但必须通过标准化的 Query Contract 暴露公共协商界面。
4.9 Search / Resolve Separation
搜索只负责返回候选对象与解释；Resolve 负责返回在当前权限和上下文下可继续交互的 ResolvableReference。
4.10 Remote-First Federation
联邦默认以“能力、摘要、入口、路由”为主，而不是强制同步完整对象数据和内部索引。
4.11 Protocol-Neutral Core
OCP Catalog 内部模型不能直接绑定 ACP、UCP 或任何单一协议的原始 Schema，只能依赖 OCP 自身的中性最小语义。

---
5. 核心概念与术语体系
5.1 Catalog
Catalog 是一个可被发现、可被查询、可声明约束的对象发现节点。
一个 Catalog 至少需要声明：
- 自己支持哪些对象类型
- 接受哪些 Descriptor Pack
- 哪些字段/描述是必需的
- 哪些是可选的
- 哪些兼容替代可以接受
- 支持哪些 Query Pack
- 返回什么结果形态
- Resolve 能返回什么
- 权限要求是什么
Catalog 本身不是对象数据库的同义词，而是“带有约束和查询能力声明的发现入口”。

---
5.2 CommercialObject
CommercialObject 是 OCP Catalog 中被发现和被解析的最小统一对象包络。
它可以代表：
- 商品
- 服务
- 人
- 职位
- 需求
- 机会
- 资源
- 报价
- 可交互入口
OCP 不强行冻结完整商业本体分类，只要求任何对象都满足最小核心语义：
- 对象身份
- 对象类型
- 来源与所有者
- 摘要信息
- Descriptor Packs
- 可见性与访问策略
- 可进一步解析的能力

---
5.3 CatalogEntry
CatalogEntry 是某个 CommercialObject 在某个特定 Catalog 中的本地索引投影。
同一个对象可以进入多个 Catalog，但在不同 Catalog 中可能有不同的：
- 可见字段
- 索引方式
- 匹配特征
- 排序分值
- 可解释性信息
- 权限约束
- 缓存与新鲜度策略
因此，Catalog 不应直接把 CommercialObject 当作自己的索引实体，而应该使用：
CommercialObject 作为对象本体包络，CatalogEntry 作为 Catalog 本地投影。

---
5.4 Descriptor Pack
Descriptor Pack 是对象语义扩展的最小标准模块。
它用于表达某个对象“提供了哪些可被理解和匹配的信息”。
例如人才场景中可以有：
- ocp.talent.resume.v1
- ocp.talent.education.v1
- ocp.talent.age.v1
- ocp.talent.skills.v1
- ocp.talent.location.v1
电商场景中可以有：
- ocp.commerce.product.core.v1
- ocp.commerce.price.v1
- ocp.commerce.inventory.v1
本地服务场景中可以有：
- ocp.service.coverage.v1
- ocp.service.schedule.v1
- ocp.service.booking.v1
Descriptor Pack 是 Object 侧语义的核心载体。
它不是任意 JSON，它必须：
- 命名空间化
- 版本化
- 有 Schema
- 可被 Catalog 契约引用
- 可被解释和验证

---
5.5 Descriptor Contract
Descriptor Contract 是 Catalog 对某类对象的接入约束声明。
它定义：
- 哪些 Descriptor Pack 是必需的
- 哪些是可选的
- 哪些替代 Pack 可以兼容
- 某个 Pack 内哪些字段必须存在
- 哪些字段仅用于索引
- 哪些字段可用于过滤
- 哪些字段可用于排序/匹配
- 哪些字段可用于解释
- 哪些字段可在搜索结果中展示
- 哪些字段只能在 Resolve 后展示
- 哪些字段永远不对外展示
这正是你刚刚提到的关键机制：
Object 声明自己提供什么；Catalog 声明自己需要什么、会怎么使用这些信息。

---
5.6 Query Pack
Query Pack 用于定义 Catalog 支持的查询模式与输入/输出契约。
例如：
- ocp.query.keyword.v1
- ocp.query.filter.v1
- ocp.query.semantic.v1
- ocp.query.talent.match.v1
- ocp.query.geo_service_match.v1
一个 Catalog 可以支持多个 Query Pack。
不同 Catalog 不要求拥有同样的内部搜索实现，但必须通过 Query Pack 对外说明：
- 接受什么输入
- 支持什么过滤方式
- 排序/匹配结果如何表达
- explain 返回的结构是什么
- 权限与审计要求是什么

---
5.7 ResolvableReference
ResolvableReference 是 Resolve 阶段的标准输出。
它表示：
某个候选对象在当前上下文、当前权限、当前策略下，被解析为一个可进一步交互的标准引用。
它不等于永久稳定 ID，也不等于原始对象全文，而是一个面向 Agent 和调用方的“下一步可执行候选”。
它可以附带：
- 当前可见字段
- 来源与验证状态
- 权限状态
- 新鲜度
- 匹配解释
- 后续动作入口
- live check 结果
- 跳转/调用绑定

---
5.8 Action Binding
Action Binding 用于表达 Resolve 之后可以进行哪些动作。
例如：
- buy
- apply
- book
- request_quote
- contact
- invite_interview
Action Binding 只描述动作入口与调用要求，不负责动作状态机本身。

---
5.9 Visibility Policy 与 Access Policy
Visibility 与 Access 是新的 Catalog 模型中的一等公民。
它们用于表达：
- 哪些字段可公开
- 哪些字段只对认证请求方开放
- 哪些字段只对特定角色开放
- 搜索请求是否要求认证
- Resolve 是否要求授权
- 是否需要审计查询原因
- 是否需要 purpose-based access

---
5.10 Provenance / Trust / Verification
任何 CatalogEntry、SearchResult、ResolvableReference 都必须附带：
- 来源类型
- 来源链路
- 验证记录
- 新鲜度
- 信任等级
- 最后更新时间
- 是否权威源
OCP Catalog 的可信性不能建立在“我说这是对的”，而必须建立在可追溯来源与验证上。

---
6. 新的核心链路
旧版链路是：
Catalog -> Offer -> ItemReference
新版链路建议定义为：
Catalog -> CommercialObject -> CatalogEntry -> ResolvableReference
其中：
- CommercialObject 是对象本体包络
- CatalogEntry 是 Catalog 本地投影
- ResolvableReference 是面向调用方的解析结果
在很多场景里，搜索返回的是 CatalogEntry Summary，Resolve 返回的是 ResolvableReference。

---
7. Catalog 契约模型：如何让 Catalog 与 Object 对上
这是本版设计的关键。
7.1 核心思想
Catalog 与 Object 之间的兼容性，不再依赖统一行业模型，而依赖：
- Catalog 声明 Descriptor Contract
- Object 声明自己提供的 Descriptor Pack
- 系统执行契约校验与兼容映射
- 满足要求才允许注册或进入某种索引层级
7.2 契约结构
一个 Catalog 对某类对象输入的契约至少包含：
- required_fields
- optional_fields
- field_requirement_groups
- field_usage_policy
- visibility_expectations
- validation_rules
- resolve_expectations
7.3 字段级使用语义
Catalog 不能只说“我要这个字段”，还要说“我怎么用它”。
建议每个字段都支持以下使用语义声明：
- required_for_registration
- used_for_index
- used_for_filter
- used_for_match
- used_for_rank
- used_for_explain
- visible_in_search
- visible_in_resolve
- never_expose
- policy_scope
这样，一个人才 Catalog 就可以声明：
- 简历文本用于匹配和排序
- 教育字段用于过滤和解释
- 年龄字段可选，仅在合规场景下使用
- 联系方式永远不在搜索结果里暴露，只能在授权 Resolve 后返回
7.4 兼容字段与字段组
Catalog 需要允许“兼容满足”而不是只接受“完全同名字段”。
因此应支持：
- 替代字段组
- 字段别名
- 类型归一化
- 枚举映射
- 受控 transform rule
例如：
- education 相关字段可由兼容字段组映射满足
- degree_level 可兼容 degree
- city 可被标准化到 location.city
7.5 注册结果模式
对象向 Catalog 注册时，系统不一定只有“成功/失败”两种结果。
建议支持：
- accepted_full：完整满足契约，进入正式索引
- accepted_limited：满足最低要求，但仅进入弱索引或部分展示层
- rejected_missing_required：缺少必需字段
- rejected_policy_conflict：权限策略与 Catalog 要求冲突
- pending_verification：来源或所有权待验证

---
8. 示例：人才 Catalog 的契约
下面给一个简化示例。
{
  "catalog_id": "catalog_pageflux_talent",
  "required_fields": [
    "ocp.talent.resume.v1#/text",
    "ocp.talent.resume.v1#/skills"
  ],
  "optional_fields": [
    "ocp.talent.education.v1#/degree_level",
    "ocp.talent.age.v1#/age",
    "ocp.talent.location.v1#/city",
    "ocp.talent.availability.v1#/status"
  ],
  "field_requirement_groups": [
    ["ocp.talent.education.v1#/degree_level", "ext.pageflux.education.v1#/degree"],
    ["ocp.talent.location.v1#/city", "ext.pageflux.profile.v1#/location_city"]
  ],
  "field_usage_policy": {
    "ocp.talent.resume.v1.text": {
      "used_for_index": true,
      "used_for_match": true,
      "used_for_rank": true,
      "visible_in_search": false,
      "visible_in_resolve": "gated"
    },
    "ocp.talent.resume.v1.skills": {
      "used_for_filter": true,
      "used_for_match": true,
      "used_for_explain": true,
      "visible_in_search": true
    },
    "ocp.talent.education.v1.degree": {
      "used_for_filter": true,
      "used_for_explain": true,
      "visible_in_search": true
    }
  }
}
这个例子就把你想要的机制表达清楚了：
- 有的 Pack 是必须的
- 有的 Pack 是可选的
- 有兼容替代
- 每个字段怎么用是 Catalog 自己声明的
- Object 只要满足最低契约就能注册

---
9. 系统总体架构
9.1 模块划分
9.1.1 Catalog API
负责外部查询入口、契约查询、对象注册、Resolve 与联邦访问。
9.1.2 Catalog Profile Store
存储 Catalog 的 Profile、支持对象类型、支持 Query Pack、Descriptor Contract 等元信息。
9.1.3 Object Registry
存储 CommercialObject 的最小规范化包络。
9.1.4 Descriptor Validation & Mapping Engine
负责 Descriptor Pack 校验、兼容映射、字段归一化、契约匹配判断。
9.1.5 Catalog Index Engine
负责把对象转化为 Catalog 本地的 CatalogEntry，并执行索引、召回、排序特征构建。
9.1.6 Query Broker
根据 Query Pack 路由到不同搜索逻辑，支持 keyword、vector、talent_match、geo_match 等异构查询。
9.1.7 Resolve Engine
负责把候选对象解析为 ResolvableReference，并在需要时触发实时确认或权限检查。
9.1.8 Policy Gate
负责鉴权、字段脱敏、可见性判断、用途限制、审计。
9.1.9 Federation Gateway
负责 Catalog 节点之间的 Remote-first 联邦同步、远端查询路由、缓存与聚合。
9.1.10 Protocol Compatibility Layer
负责 ACP、UCP 与其他协议到 OCP Canonical Model 的映射。
9.1.11 Dashboard
供 Catalog 运营者、对象提供者和治理人员管理契约、对象、验证、调试信息。
9.1.12 Governance / Anti-Spam / Trust
负责域名验证、对象验证、来源评分、黑白名单、滥用控制与举报处理。
9.1.13 Observability / Audit
负责查询日志、Resolve 日志、策略命中、联邦路由、调试与审计接口。

---
10. 核心数据模型设计
10.1 CatalogProfile
描述一个 Catalog 节点的元信息。
核心字段建议：
- id
- node_id
- canonical_name
- domains[]
- description
- supported_query_packs[]
- default_visibility_policy
- auth_requirements
- trust_tier
- verification_status
- health_status
- freshness_status
- federation_mode
- protocol_profiles[]

---
10.2 DescriptorContract
描述某个 Catalog 对某类对象的接入与使用约束。
核心字段建议：
- id
- catalog_id
- required_fields
- optional_fields
- field_requirement_groups
- field_usage_policy
- validation_rules
- resolve_rules
- version

---
10.3 CommercialObject
对象的最小统一包络。
核心字段建议：
- id
- object_type
- object_subtype
- canonical_title
- summary
- owner_entity_id
- provider_id
- source_type
- source_uri
- descriptor_pack_refs[]
- visibility_policy_id
- access_policy_id
- trust_tier
- verification_status
- freshness_status
- raw_payload_ref
- created_at
- updated_at

---
10.4 DescriptorInstance
对象实际提供的 Descriptor 数据实例。
核心字段建议：
- id
- object_id
- pack_name
- pack_version
- namespace
- schema_ref
- payload
- normalized_payload
- source_provenance
- visibility_scope
- expires_at

---
10.5 CatalogEntry
对象在某个 Catalog 中的本地投影。
核心字段建议：
- id
- catalog_id
- object_id
- entry_status
- contract_match_status
- matched_packs[]
- missing_required[]
- search_projection
- filter_projection
- rank_features
- explain_projection
- local_policy_projection
- index_freshness
- remote_authority_ref
- embedding
- created_at
- updated_at

---
10.6 QueryPackBinding
描述某个 Catalog 对某个 Query Pack 的支持细节。
核心字段建议：
- id
- catalog_id
- query_pack
- input_schema
- output_schema
- auth_scheme
- rate_limit_policy
- supports_explain
- supports_streaming
- supports_remote_resolve
- version

---
10.7 ResolvableReference
Resolve 阶段的标准输出对象。
核心字段建议：
- id
- catalog_id
- object_id
- entry_id
- reference_type
- resolved_title
- visible_attributes
- redacted_attributes
- match_explanation
- policy_state
- verification_state
- freshness_state
- live_check_state
- action_bindings[]
- source_reference
- expires_at

---
10.8 ActionBinding
描述后续可执行动作的入口。
核心字段建议：
- id
- reference_id
- action_key
- protocol_family
- binding_type
- endpoint_url
- auth_scheme
- request_schema
- response_schema
- rate_limit_policy
- requires_consent
- supports_streaming

---
10.9 VisibilityPolicy / AccessPolicy
表达对象、字段、查询、Resolve 的权限控制。
核心字段建议：
- id
- scope
- subject_rules
- purpose_rules
- field_rules
- query_requirements
- resolve_requirements
- audit_requirements
- retention_policy

---
10.10 CommerceEntity
表示对象来源主体、组织或个人身份锚点。
核心字段建议：
- id
- entity_type
- canonical_name
- domains[]
- identity_proofs
- trust_tier
- verification_status
- health_status

---
10.11 ProtocolProfile
表示某节点、对象或绑定在某协议下的兼容信息。
核心字段建议：
- id
- protocol_family
- protocol_version
- profile_role
- compatibility_level

---
10.12 ProtocolMapping
记录外部协议如何映射到 OCP Canonical Model。
核心字段建议：
- id
- protocol_family
- protocol_version
- target_canonical_version
- source_path
- target_field
- transform_rule
transform_rule 仍建议限定为声明式规则，而不是任意脚本。

---
10.13 RawProtocolDocument
保存外部协议原始文档快照，便于调试与审计。

---
10.14 Source / Provenance
记录对象、Descriptor、Entry、Resolve 结果的来源链路。

---
10.15 VerificationRecord
记录域名验证、对象验证、来源验证、人工审核、联邦信任继承等过程。

---
10.16 CatalogFederationPeer & MutationLog
用于联邦节点管理与变更追踪。

---
10.17 QueryAuditRecord
记录查询请求、鉴权信息、策略命中、字段脱敏、Resolve 与远端调用轨迹。

---
11. Search 与 Resolve 设计
11.1 Search 的职责
Search 负责：
- 协商 Query Pack
- 判断 Catalog 是否支持这类查询
- 对符合契约的 CatalogEntry 执行召回
- 权限过滤与字段脱敏
- 排序与解释
- 返回候选摘要，而不是最终执行结果
搜索返回内容应包括
- 候选对象摘要
- 命中原因
- 使用的 Query Pack
- 数据来源
- 权限状态
- 新鲜度
- 是否支持 Resolve
- 是否支持后续动作

---
11.2 Resolve 的职责
Resolve 不再被限定为“价格/库存确认”。
在新模型里，Resolve 负责：
- 将候选对象解析为 ResolvableReference
- 应用当前权限策略
- 返回可见字段
- 返回匹配解释
- 返回动作入口
- 在必要时进行轻量实时确认

Resolve 的关键想象力在于：它回答的不是“这个对象详情是什么”，而是“当前调用方下一步可以对这个对象做什么”。在电商里这可能是打开商品页、加入购物车或直接下单；在本地生活服务里可能是预约；在找工作场景里可能是投递简历；在招聘场景里可能是发送邀约邮件；在 B2B 服务里可能是请求报价或进入采购流程。

因此，Resolve 是发现层与执行层之间的协议边界。Catalog 暴露可执行入口、调用要求与权限状态，但不应接管订单、预约、ATS、CRM、ERP 或审批系统的内部状态机。

Resolve 可做的实时确认包括
- 对象是否仍可访问
- 某些字段是否仍有效
- 某个动作入口是否仍可调用
- 某个对象是否仍满足某种匹配前提
- 商品/服务类场景下的价格、库存、可履约状态确认
Live Check 语义需要泛化
它不能只叫“库存探活”，而应该是更中性的：
- availability_check
- eligibility_check
- access_check
- endpoint_health_check

---
11.3 Search / Resolve 分层理由
这样设计的好处是：
- 搜索层可以更快、更松、更可缓存
- Resolve 层可以更严格、更策略感知
- 对权限化场景非常自然
- 对 Remote-first 联邦更友好
- 对 Agent 更清晰：先发现，再解析，再执行

---
12. Query 协商模型
Catalog 的核心不是一个统一 /search，而是：
一个标准化的查询能力协商入口。
12.1 Catalog 必须公开的查询元信息
- 支持哪些 Query Pack
- 每个 Query Pack 支持哪些对象类型
- 输入 Schema
- 输出 Schema
- explain 能力
- 认证与限流要求
- 是否支持远端调用
- 是否支持权限化字段返回
12.2 典型 Query Pack 示例
ocp.query.keyword.v1
适用于基于关键字与结构化过滤的目录查询。
ocp.query.semantic.v1
适用于文本/向量语义召回。
ocp.query.talent.match.v1
适用于人才与岗位、人才与任务的专有匹配场景。
ocp.query.geo_service_match.v1
适用于地理位置相关的本地服务发现。
12.3 重要原则
OCP 统一的是 Query Contract，不统一底层检索实现。
Catalog 可以使用 BM25、pgvector、专有神经匹配模型、规则引擎或混合策略，只要它对外的 Query Pack 契约一致即可。

---
13. 权限化检索与可见性设计
这是新版 OCP Catalog 的关键增强。
13.1 可见性是字段级而不是对象级单一开关
同一个对象上：
- 标题可公开
- 技能可公开
- 联系方式可受限
- 简历全文只在授权 Resolve 后可见
- 某些合规敏感字段永远不外显
13.2 搜索权限与 Resolve 权限可以不同
- 某对象允许公开搜索摘要
- 但不允许匿名 Resolve
- 或者允许匿名 Resolve，但返回强脱敏版本
- 或者只有受信 Agent 才能获取完整 Reference
13.3 建议支持的权限层级
- public
- catalog_member
- authenticated_agent
- approved_partner
- owner_only
- policy_gated
13.4 建议支持的访问条件
- API key / token
- 域名身份
- agent identity
- use case/purpose
- data handling commitment
- 审计同意
- 来源白名单
13.5 Query Audit
权限化检索必须默认支持审计。
尤其在人才、B2B、医疗、本地服务等场景，查询本身就是敏感行为。

---
14. Remote-first 联邦设计
本版明确采用 Remote-first Federation。
14.1 联邦同步什么
联邦节点之间优先同步：
- CatalogProfile
- DescriptorContract 摘要
- QueryPack 支持信息
- 对象轻量摘要
- 路由元信息
- 来源、信任、新鲜度元信息
- 缓存提示与 TTL
- Mutation Log
14.2 联邦不强制同步什么
默认不强制同步：
- 完整对象原文
- 私有 embedding
- 内部排序模型
- 内部检索索引
- 敏感受限字段
- 私有匹配特征工程
14.3 远端查询模式
Remote-first 模式下，本地节点在发现远端 Catalog 更适合回答某种 Query Pack 时，可以：
- 将请求路由到远端 Catalog
- 获取标准化结果
- 在本地做结果聚合与信任加权
- 保留来源标记与缓存信息
14.4 远端 Resolve 模式
Resolve 默认优先由权威源或源 Catalog 完成。
本地节点可以缓存 ResolvableReference 的短期投影，但不应替代权威源的权限判断。
14.5 缓存策略
联邦缓存应分层：
- Catalog Profile Cache
- Contract Cache
- Search Summary Cache
- Resolve Cache
- Policy-sensitive Cache
受限字段和权限化结果必须避免错误缓存外泄。
14.6 Mutation Log 设计
联邦同步仍建议基于 Append-only Mutation Log。
但在 Remote-first 模式下，Mutation Log 的核心对象不再只是 Offer/Entity，而包括：
- CatalogProfile 变更
- DescriptorContract 变更
- Object Summary 变更
- Policy Projection 变更
- Tombstone
- Route Hint 变更

---
15. 冲突与信任策略
Remote-first 并不意味着没有冲突，冲突主要体现在：
- 多节点对同一对象摘要不一致
- 某对象在不同 Catalog 中的权限投影不同
- 同一来源被多个适配器解释不同
- 某对象被删除但远端缓存未失效
建议的处理原则
15.1 权威源优先
对象提供方或权威 Catalog 的声明优先于第三方投影。
15.2 高信任优先低信任
已验证节点优先于普通爬虫或低信第三方。
15.3 字段级来源优先
身份类字段、策略类字段、健康类字段、可见性类字段应保留字段级来源。
15.4 Tombstone 保留
删除事件必须显式保留，并具有信任等级与生效范围。

---
16. 多协议兼容架构
16.1 兼容目标
OCP Catalog 的目标不是字段级硬兼容 ACP/UCP，而是实现：
- 对象语义兼容
- 查询能力兼容
- Resolve 输出兼容
- 动作绑定兼容
16.2 三层兼容模型
A. Canonical Layer
OCP 自身最小核心语义。
B. Descriptor / Query / Action Layer
行业与场景扩展层，通过 Pack 机制组织。
C. Transport / Binding Layer
REST、A2A、MCP、skill、Webhook 等调用兼容层。
16.3 Adapter 的职责
Adapter 应将外部协议映射到：
- CommercialObject
- DescriptorInstance
- CatalogEntry
- QueryPackBinding
- ResolvableReference
- ActionBinding
而不是把外部协议原始 Schema 强塞进 OCP 内核。

---
17. PostgreSQL 表设计建议
建议的基础表包括：
- catalog_profiles
- descriptor_contracts
- commercial_objects
- descriptor_instances
- catalog_entries
- query_pack_bindings
- resolvable_references
- action_bindings
- visibility_policies
- access_policies
- commerce_entities
- protocol_profiles
- protocol_mappings
- raw_protocol_documents
- source_records
- verification_records
- query_audit_records
- federation_peers
- federation_mutation_logs
索引建议
- B-Tree：对象状态、Catalog ID、类型、更新时间
- GIN：JSONB Descriptor payload
- Full-text：标题、摘要、公开文本字段
- pgvector：CatalogEntry 级向量投影
- 组合索引：catalog_id + object_type + entry_status
- 审计索引：requestor_id + occurred_at

---
18. 搜索系统设计与性能建议
由于不同 Catalog 的检索逻辑可能差异极大，OCP 只规范搜索漏斗的分层思想，不强制实现细节。
建议的搜索漏斗
Step 1：资格预筛
基于对象类型、权限、契约匹配状态、健康状态进行粗筛。
Step 2：主召回
使用 Catalog 私有逻辑进行召回，可为 keyword、semantic、match model、rule engine 或混合策略。
Step 3：策略过滤
在返回前应用 policy gate、字段可见性与访问条件。
Step 4：重排
融合 relevance、trust、freshness、policy score、business score。
Step 5：解释生成
输出命中原因、匹配维度、可见性限制说明、数据来源。
一个重要约束
Catalog 必须能够说明自己“怎么理解这个查询”，哪怕底层实现是私有的。
Explain 不是可选装饰，而是 Agent 可用性的核心部分。

---
19. API 设计建议
19.1 Catalog Profile 暴露
建议通过：
- GET /.well-known/ocp/catalog
- GET /api/v1/catalog/profile
返回：
- 支持对象类型
- 支持 Query Pack
- Descriptor Contract 摘要
- 权限要求
- 联邦模式
- 协议版本
19.2 Contract 查询
- GET /api/v1/catalog/contracts
- GET /api/v1/catalog/contracts/:objectType
用于对象提供方判断自己能否注册。
19.3 Object 注册
- POST /api/v1/catalog/objects/register
用于提交对象最小包络、Descriptor Packs、来源与策略信息。
19.4 Search / Query
- POST /api/v1/catalog/query
建议由 query_pack 驱动，而不是拆成过多固定 endpoint。
请求中包含：
- query_pack
- input_payload
- requestor_context
- purpose_context
- result_window
- explain
- resolve_hint
19.5 Resolve
- POST /api/v1/catalog/resolve
输入：
- 候选对象或 entry 引用
- requestor context
- requested scopes
- require_live_check
输出：
- ResolvableReference
19.6 联邦接口
- GET /api/v1/federation/profile
- GET /api/v1/federation/mutations
- POST /api/v1/federation/query
- POST /api/v1/federation/resolve

---
20. 治理、安全与可观测性
20.1 治理
- 域名与身份验证
- 对象来源验证
- Descriptor Schema 校验
- Query Pack 合规检查
- 反垃圾对象注册
- 黑白名单
- 社区举报
20.2 安全
- API Key / JWT / signed request
- 细粒度 scope
- request signing
- replay protection
- field-level redaction
- secure audit trail
20.3 可观测性
建议重点监控：
- 注册成功率
- 契约匹配失败率
- Descriptor 映射失败率
- 查询成功率
- Resolve 成功率
- 权限拒绝率
- explain 缺失率
- 联邦路由命中率
- 远端 Resolve 延迟
- 来源验证通过率

---
21. 实施路径与阶段规划
Phase 0：语义重构与协议定稿
目标：完成从 Offer-centric 到 Object-centric 的核心重构。
任务：
- 定义 CommercialObject 最小包络
- 定义 Descriptor Pack 机制
- 定义 Descriptor Contract
- 定义 Query Pack
- 定义 ResolvableReference
- 定义 Visibility / Access Policy 核心模型
Phase 1：Catalog Profile 与 Contract 层
目标：Catalog 能声明自己接受什么、支持怎么问。
任务：
- 完成 CatalogProfile
- 完成 DescriptorContract
- 完成 Contract 查询接口
- 完成对象兼容性校验
Phase 2：Object Registry 与注册流程
目标：跑通对象提交、校验、映射、入库、投影生成。
任务：
- CommercialObject
- DescriptorInstance
- CatalogEntry
- 兼容映射规则
- 注册结果状态机
Phase 3：Query Pack 与基础搜索
目标：实现基于 Query Pack 的查询协商与基本搜索返回。
任务：
- query API
- explain 返回
- policy-aware summary
- query audit
Phase 4：Resolve 与动作入口暴露
目标：上线 ResolvableReference 与 Action Binding。
任务：
- resolve API
- live check 泛化机制
- 权限化字段返回
- 动作入口描述
Phase 5：Remote-first 联邦
目标：实现 Profile、Contract、Summary、Mutation Log 联邦。
任务：
- federation profile
- remote query routing
- remote resolve
- cache & trust strategy
Phase 6：协议兼容层
目标：接入 ACP/UCP 等协议适配器。
任务：
- canonical mapping
- raw document retention
- adapter validation
Phase 7：生态扩展与治理
目标：开放 Query Pack / Descriptor Pack 生态。
任务：
- namespace 规范
- pack registry
- versioning policy
- community governance

---
22. 本版最终原则表述
OCP Catalog is not a product-only catalog.
It is a protocol-neutral discovery and query-negotiation layer for commercial objects.
Each Catalog may define its own search, matching, ranking, and explain logic, but must expose them through standard Catalog Profiles, Descriptor Contracts, Query Packs, and Resolvable References.
Commercial objects declare what descriptors they provide.
Catalogs declare what descriptors they require, accept, index, explain, and expose.
Compatibility is established by machine-readable contracts rather than hardcoded industry schemas.
Federation is remote-first:
nodes primarily exchange profiles, contracts, summaries, trust metadata, and routing hints,
while authoritative query and resolve remain close to source catalogs or object providers.
中文版
OCP Catalog 不再是商品目录协议，而是面向通用商业对象的、协议中立的发现与查询协商层。
每个 Catalog 可以拥有自己的搜索、匹配、排序和解释逻辑，但必须通过标准化的 Catalog Profile、Descriptor Contract、Query Pack 与 ResolvableReference 对外暴露其能力边界。
商业对象负责声明自己提供哪些 Descriptor；
Catalog 负责声明自己要求哪些 Descriptor、如何使用这些字段、哪些可以展示、哪些仅可在 Resolve 后展示。
Catalog 与 Object 的兼容性通过可机器判断的契约建立，而不是通过预设行业硬编码模型建立。
联邦模式采用 Remote-first：
节点之间主要交换 Profile、Contract、Summary、Trust Metadata 与 Route Hint，
而权威查询与 Resolve 尽量留在源 Catalog 或对象提供方附近完成。
