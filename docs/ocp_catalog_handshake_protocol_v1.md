# OCP Catalog Handshake Protocol v1.0

## 1. 文档定位

本文档定义 `ocp.catalog.handshake.v1` 的正式协议规范，用于描述 OCP Catalog 与 Provider 之间的最小握手机制。其目标是在不引入复杂联邦同步、交易编排、权限执行细节与行业特定业务逻辑的前提下，建立一套统一、稳定、可扩展的 Catalog 接入基础协议。

重要边界：

`ocp.catalog.handshake.v1` 只定义 **Provider 如何接入某个 Catalog Node**。它不定义 Catalog 如何注册到 OCP Center，也不定义 Catalog Registry / Catalog Discovery Center 的索引和搜索行为。

Catalog 注册到 OCP Center 的握手协议由 `ocp.catalog.center.v1` 定义，详见 `docs/ocp_catalog_center_protocol_v1.md`。

两条链路必须区分：

```text
Provider -> Catalog Node
  使用 ocp.catalog.handshake.v1
  对象：ProviderRegistration、CommercialObject、CatalogEntry、ResolvableReference

Catalog Node -> OCP Center
  使用 ocp.catalog.center.v1
  对象：CatalogRegistration、CatalogProfileSnapshot、CatalogIndexEntry、CatalogRouteHint
```

本协议聚焦以下核心问题：

1. Catalog 如何对外声明自身能力与接入要求。
2. Catalog 如何声明对 Provider 与对象数据的字段契约。
3. Provider 如何与 Catalog 建立或更新接入契约关系。
4. 对象数据如何以统一包络形式表达。
5. 注册握手与真实对象数据同步如何解耦。

本协议不负责以下内容：

* 批量对象数据同步的完整格式标准。
* 联邦节点之间的同步与路由标准。
* 查询请求与 Resolve 请求的完整行业化模型。
* 支付、订单、履约、ATS、CRM、OMS 等执行流程。
* 权限系统与审计模型的完整规范。

---

## 2. 设计目标

### 2.1 最小可握手

协议只定义 Catalog 与 Provider 建立接入关系所需的最小对象与最小流程，不试图覆盖完整业务体系。

### 2.2 注册与数据同步解耦

`ProviderRegistration` 仅用于建立或更新契约关系，不承载批量真实对象数据。真实对象数据必须通过独立同步接口提交，以避免大体量对象集合在握手阶段占用过多内存与计算资源。

### 2.3 通用对象包络

协议不将“商品”作为唯一中心对象，而采用统一的 `CommercialObject` 包络。商品、服务、人才、职位、机会等均可通过相同外层结构表达。

### 2.4 契约可更新

Provider 后续能力升级时，必须能够通过版本化的注册声明更新与 Catalog 的契约关系，而无需重新创建新的 Provider 身份。

### 2.5 可扩展而不失约束

协议允许 Catalog 与 Provider 使用扩展字段、扩展 Pack 和扩展 Descriptor，但必须通过稳定的字段引用规则与契约规则进行声明，避免协议退化为无约束 JSON 交换。

---

## 3. 术语定义

### 3.1 Catalog

Catalog 是一个面向外部提供对象发现、查询能力声明与对象接入契约的节点。Catalog 通过 `CatalogManifest` 对外暴露其可被使用的方式。

### 3.2 Provider

Provider 是向某个 Catalog 提供对象数据的主体。Provider 可以是商户、组织、平台、个人或其他合法主体。

### 3.3 CommercialObject

`CommercialObject` 是 OCP Catalog 中统一的对象包络，表示一个可被 Catalog 接收、索引或进一步解析的业务对象。商品是 `CommercialObject` 的一种实例，而非协议中的唯一特殊类型。

### 3.4 Object Contract

`ObjectContract` 是 Catalog 针对某类对象声明的接入契约，定义该类对象需要提供哪些 Pack、哪些字段、哪些字段是必需的、哪些字段是可选的、哪些字段会被接收但不作为核心索引前提。

### 3.5 Provider Registration

`ProviderRegistration` 是 Provider 向 Catalog 提交的契约建立或契约更新声明，用于表明自身身份、对象供给能力、保证字段与数据同步方式。

### 3.6 Field Reference

`FieldRef` 是字段定位的统一表示方法，用于在协议中唯一标识某个字段。

格式如下：

```text
<namespace_or_pack>#/<json-pointer>
```

示例：

```text
provider#/display_name
provider#/homepage
system#/updated_at
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

### 3.7 Requirement Level

字段要求等级统一分为三类：

* `required`：必须提供，缺失则不能满足契约。
* `optional`：推荐提供，不是接入前提，但可被 Catalog 使用。
* `accepted`：Catalog 可接收与保存，但不承诺将其纳入核心检索、过滤或排序逻辑。

---

## 4. 协议对象总览

`ocp.catalog.handshake.v1` 定义以下五个核心协议对象：

1. `CatalogManifest`
2. `ObjectContract`
3. `ProviderRegistration`
4. `CommercialObject`
5. `RegistrationResult`

其中：

* `CatalogManifest` 用于 Catalog 的对外声明。
* `ObjectContract` 用于 Catalog 定义对象接入契约。
* `ProviderRegistration` 用于 Provider 建立或更新契约。
* `CommercialObject` 用于统一表达实际对象。
* `RegistrationResult` 用于 Catalog 返回结构化注册结果。

---

## 5. Schema Package 结构

建议将本协议实现组织为如下 Schema Package：

```text
ocp.catalog.handshake.v1/
├── package.json
├── common.schema.json
├── catalog-manifest.schema.json
├── object-contract.schema.json
├── provider-registration.schema.json
├── commercial-object.schema.json
├── registration-result.schema.json
├── pack.ocp.commerce.product.core.v1.schema.json
├── pack.ocp.commerce.price.v1.schema.json
└── pack.ocp.commerce.inventory.v1.schema.json
```

---

## 6. 公共约定

### 6.1 顶层公共字段

所有核心文档对象应包含以下公共字段：

* `ocp_version`
* `kind`
* `id`

含义如下：

* `ocp_version`：协议版本。
* `kind`：文档对象类型。
* `id`：当前文档实例标识符。

### 6.2 字段使用语义

字段可附加 `usage` 用途声明。当前版本建议支持：

* `identity`
* `index`
* `filter`
* `rank`
* `display`
* `resolve`
* `reference`

其中：

* `identity` 表示该字段用于身份识别或主体确认。
* `index` 表示该字段可用于索引构建。
* `filter` 表示该字段可用于筛选。
* `rank` 表示该字段可用于排序或评分。
* `display` 表示该字段可直接向用户展示。
* `resolve` 表示该字段可在 Resolve 阶段参与返回。
* `reference` 表示该字段可用于外部跳转、引用或调用入口构建。

---

## 7. CatalogManifest 规范

### 7.1 目标

`CatalogManifest` 是 Catalog 对外的标准自我声明，用于告诉注册中心、Provider、联邦节点和外部调用方：

* Catalog 的身份信息。
* Catalog 支持的对象类型。
* Catalog 的基础访问端点。
* Catalog 支持的查询能力。
* Catalog 对 Provider 的接入要求。
* Catalog 对不同对象类型的接入契约。

### 7.2 必须包含的字段

`CatalogManifest` 必须至少包含以下字段：

* `ocp_version`
* `kind`
* `id`
* `catalog_id`
* `catalog_name`
* `endpoints`
* `query_capabilities`
* `provider_contract`
* `object_contracts`

### 7.3 endpoints 规范

`endpoints` 必须至少声明以下端点：

* `query`
* `resolve`
* `provider_registration`
* `contracts`
* `object_sync`

其中：

* `query` 用于对象查询。
* `resolve` 用于候选对象解析。
* `provider_registration` 用于 Provider 建立或更新契约。
* `contracts` 用于获取 Catalog 当前定义的对象接入契约。
* `object_sync` 用于真实对象数据同步。

### 7.4 query_capabilities 规范

`query_capabilities` 用于描述 Catalog 的查询能力。每个 capability 至少应声明：

* `capability_id`
* `target_object_types`
* `query_modes`
* `input_fields`

可选声明：

* `searchable_field_refs`
* `filterable_field_refs`
* `sortable_field_refs`
* `supports_explain`
* `supports_resolve`
* `request_schema_uri`

### 7.5 query_modes 规范

当前版本支持的查询模式包括：

* `keyword`
* `filter`
* `semantic`
* `ranking_model`
* `catalog_native`

协议不要求不同 Catalog 共享同一内部检索实现，但要求其通过标准化 manifest 暴露自身查询能力边界。

### 7.6 provider_contract 规范

`provider_contract` 用于声明 Catalog 对 Provider 自身字段的要求。例如：

* `provider#/display_name`
* `provider#/homepage`
* `provider#/contact_email`

Catalog 应使用 `field_rules` 描述这些字段的 requirement 和 usage。

### 7.7 object_contracts 规范

`object_contracts` 是该 Catalog 当前支持的对象接入契约集合。每个元素必须为一个合法的 `ObjectContract`。

---

## 8. ObjectContract 规范

### 8.1 目标

`ObjectContract` 用于定义某个 Catalog 对某类对象的最低接入要求及字段使用方式。

### 8.2 必须包含的字段

`ObjectContract` 必须至少包含：

* `contract_id`
* `object_type`
* `field_rules`

### 8.3 Pack 声明

`ObjectContract` 可通过以下字段定义对象的 Pack 要求：

* `required_packs`
* `optional_packs`
* `compatible_packs`

其中：

* `required_packs` 表示对象必须包含的 Pack。
* `optional_packs` 表示对象可选携带的 Pack。
* `compatible_packs` 表示某个标准 Pack 允许被哪些兼容 Pack 替代。

### 8.4 field_rules 规范

`field_rules` 是对象契约的核心。每条规则至少应包含：

* `field_ref`
* `requirement`

可选字段包括：

* `usage`
* `accepted_aliases`
* `note`

通过这些规则，Catalog 可以明确表达：

* 哪些字段是必需字段。
* 哪些字段是可选字段。
* 哪些字段只是接收但不作为正式索引前提。
* 这些字段在 Catalog 中如何被使用。

### 8.5 registration_modes 规范

`registration_modes` 用于描述该类对象允许通过何种方式进入 Catalog。当前版本支持：

* `feed_url`
* `api_pull`
* `push_api`

### 8.6 additional_fields_policy 规范

Catalog 可通过 `additional_fields_policy` 指定对未声明字段的处理策略：

* `allow`
* `ignore`
* `reject`

---

## 9. ProviderRegistration 规范

### 9.1 目标

`ProviderRegistration` 用于 Provider 与 Catalog 建立或更新接入契约关系。

### 9.2 明确边界

`ProviderRegistration` 不承载真实大规模对象集合。
该对象仅用于表达：

* Provider 身份
* 接入目标 Catalog
* 当前契约版本
* 将要提供的对象类型
* 保证提供的字段
* 数据同步方式

### 9.3 必须包含的字段

`ProviderRegistration` 必须至少包含：

* `ocp_version`
* `kind`
* `id`
* `catalog_id`
* `provider`
* `registration_version`
* `updated_at`
* `object_declarations`

### 9.4 provider 字段

`provider` 至少应声明：

* `provider_id`
* `entity_type`
* `display_name`
* `homepage`

建议声明：

* `contact_email`
* `domains`

### 9.5 registration_version 规范

`registration_version` 是整数且必须大于等于 1。

其作用如下：

* 标识该注册声明的版本。
* 支持 Provider 后续能力升级后的契约更新。
* 使 Catalog 能区分“重复注册”和“更新契约”。

### 9.6 updated_at 规范

`updated_at` 用于记录该注册声明的提交时间或更新时间。
在版本比较时，`registration_version` 是主依据，`updated_at` 用于审计与辅助判断。

### 9.7 object_declarations 规范

`object_declarations` 是 Provider 对不同对象类型供给能力的声明集合。每项至少应包含：

* `object_type`
* `provided_packs`
* `guaranteed_fields`
* `delivery`

### 9.8 guaranteed_fields 规范

`guaranteed_fields` 表示 Provider 对某个对象类型作出的强承诺：

一旦声明某字段为 guaranteed，该 Provider 在该注册版本下提交的该类型对象，均应保证包含这些字段。

如果实际同步对象缺失这些字段，Catalog 可：

* 拒收单个对象。
* 将该对象判定为不满足契约。
* 在严重情况下拒绝当前版本的注册生效。

### 9.9 optional_fields 规范

`optional_fields` 表示 Provider 当前能够提供、但不保证对所有对象恒定存在的字段。

### 9.10 delivery 规范

`delivery` 用于说明对象数据的同步方式。当前版本支持：

* `feed_url`
* `api_pull`
* `push_api`

如果使用 `feed_url`，可附带 `feed_url` 与 `sync_interval_hint`。

---

## 10. ProviderRegistration 更新规则

### 10.1 唯一识别原则

Catalog 应至少使用以下组合识别一个 Provider 的注册关系：

* `catalog_id`
* `provider.provider_id`

### 10.2 更新判定原则

若新提交的 `ProviderRegistration` 满足：

* `catalog_id` 相同
* `provider_id` 相同
* `registration_version` 更大

则 Catalog 应将其视为一次契约更新，而非重复注册。

### 10.3 全量重提原则

每次更新注册声明时，Provider 应提交完整的、可独立解释的 `ProviderRegistration`，而不是只提交差异补丁。

这样可以：

* 降低 Catalog 的 merge 复杂度。
* 避免 patch 语义分歧。
* 简化审计与回放。
* 保持协议实现一致性。

### 10.4 能力增强场景

当 Provider 后续系统升级并开始提供更多字段时，例如新增：

```text
ocp.commerce.product.core.v1#/video_urls
```

应通过新的 `registration_version` 重新提交完整 `ProviderRegistration`，以更新 `guaranteed_fields`、`optional_fields` 或 `provided_packs`。

---

## 11. CommercialObject 规范

### 11.1 目标

`CommercialObject` 是 Catalog 中统一的对象数据包络，用于表达任意可被接收、索引或后续解析的业务对象。

### 11.2 必须包含的字段

`CommercialObject` 必须至少包含：

* `ocp_version`
* `kind`
* `id`
* `object_id`
* `object_type`
* `provider_id`
* `title`
* `descriptors`

### 11.3 通用语义

* `object_id` 是对象在 Provider 侧的标识。
* `object_type` 表示对象类型，例如 `product`。
* `provider_id` 指明该对象的提供方。
* `title` 是对象最基本的展示标题。
* `descriptors` 是对象的结构化描述集合。

### 11.4 descriptors 规范

`descriptors` 至少包含一个元素。每个 descriptor 必须包含：

* `pack_id`
* `data`

可选包含：

* `schema_uri`

协议不强制将所有业务字段平铺到 `CommercialObject` 顶层，而要求将业务字段组织进对应的 Pack 中，以保持对象外层协议稳定性。

### 11.5 商品的协议表达

商品不是“独立于协议的任意 JSON”，而是：

* `object_type = "product"` 的 `CommercialObject`
* 通过 `ocp.commerce.product.core.v1`
* `ocp.commerce.price.v1`
* `ocp.commerce.inventory.v1`

等 Pack 承载实际商品数据。

---

## 12. RegistrationResult 规范

### 12.1 目标

`RegistrationResult` 是 Catalog 对 `ProviderRegistration` 的结构化响应，用于告诉 Provider 注册结果与契约匹配情况。

### 12.2 必须包含的字段

`RegistrationResult` 必须至少包含：

* `ocp_version`
* `kind`
* `id`
* `status`
* `catalog_id`

### 12.3 status 取值

当前版本支持：

* `accepted_full`
* `accepted_limited`
* `rejected`
* `pending_verification`

### 12.4 可选字段

建议返回：

* `provider_id`
* `matched_contract_ids`
* `effective_registration_version`
* `missing_required_fields`
* `warnings`
* `message`

### 12.5 结果解释

* `accepted_full`：完全满足当前 Catalog 接入要求。
* `accepted_limited`：部分满足，可建立关系，但能力受限。
* `rejected`：无法满足最低契约要求。
* `pending_verification`：需要进一步人工或自动验证后生效。

---

## 13. 商品 Pack 规范

当前版本定义三个示例性商品 Pack：

1. `ocp.commerce.product.core.v1`
2. `ocp.commerce.price.v1`
3. `ocp.commerce.inventory.v1`

### 13.1 ocp.commerce.product.core.v1

该 Pack 用于表达商品核心属性。建议包含：

* `title`
* `summary`
* `brand`
* `category`
* `sku`
* `product_url`
* `image_urls`
* `video_urls`
* `attributes`

其中 `title` 为必需字段。

### 13.2 ocp.commerce.price.v1

该 Pack 用于表达价格。建议包含：

* `currency`
* `amount`
* `list_amount`
* `price_type`

其中 `currency` 与 `amount` 为必需字段。

### 13.3 ocp.commerce.inventory.v1

该 Pack 用于表达库存与可售状态。建议包含：

* `availability_status`
* `quantity`

其中 `availability_status` 为必需字段。

---

## 14. .well-known 发现约定

### 14.1 目标

为便于注册中心、Provider 与外部调用方发现 Catalog，协议定义一个轻量发现入口：

```http
GET /.well-known/ocp-catalog
```

### 14.2 返回内容

该接口应返回一个轻量 discovery document，用于提供：

* `catalog_id`
* `catalog_name`
* `handshake_package`
* `handshake_package_version`
* `manifest_url`
* `contracts_url`
* `provider_registration_url`
* `object_sync_url`
* `query_url`
* `resolve_url`

### 14.3 约定原则

* `.well-known/ocp-catalog` 仅用于发现，不承载完整接入契约。
* 完整契约应通过 `manifest_url` 与 `contracts_url` 获取。
* 发现文档应尽量轻量、可缓存、可快速读取。

---

## 15. 最小 Endpoint 规范

### 15.1 GET /.well-known/ocp-catalog

用途：Catalog 发现入口。
返回：轻量 discovery document。

### 15.2 GET /ocp/manifest

用途：获取完整 `CatalogManifest`。
返回：`CatalogManifest`

### 15.3 GET /ocp/contracts

用途：获取当前 Catalog 定义的全部对象契约。
返回：对象契约列表。
实现上可支持按 `object_type` 筛选。

### 15.4 POST /ocp/providers/register

用途：建立或更新 Provider 与 Catalog 的契约关系。
请求：`ProviderRegistration`
返回：`RegistrationResult`

### 15.5 POST /ocp/objects/sync

用途：真实对象数据同步接口。
该接口必须与注册握手解耦，不应复用 `ProviderRegistration` 承载对象数据。

本协议版本要求 `CatalogManifest` 声明该 endpoint 的存在，但不在 `ocp.catalog.handshake.v1` 中冻结完整对象同步请求格式。对象同步格式可在后续独立包中定义，例如 `ocp.catalog.sync.v1`。

### 15.6 POST /ocp/query

用途：对象查询。
本协议版本仅要求 Catalog 在 manifest 中声明其查询能力边界，不冻结完整查询请求体模型。

### 15.7 POST /ocp/resolve

用途：候选对象解析。
本协议版本仅要求 Catalog 在 manifest 中说明是否支持 resolve，不冻结完整 resolve 语义。

---

## 16. 注册与同步边界

### 16.1 握手阶段

握手阶段的唯一目标是建立契约关系，而不是同步业务数据。

### 16.2 同步阶段

真实对象数据必须走独立同步接口，以支持：

* 批量同步
* 分页或分批提交
* 流式处理
* 内存受控
* 单批失败重试
* 对象级接收与拒绝统计

### 16.3 实现建议

即使在简单实现中，也应避免将大型 SKU 列表、商品全集或对象全集直接塞入注册请求中。

---

## 17. 兼容性与演进

### 17.1 版本字段

所有核心对象必须携带 `ocp_version`。

### 17.2 包版本

Schema Package 应独立携带自己的版本，例如：

```json
"package_name": "ocp.catalog.handshake.v1",
"version": "1.0.0"
```

### 17.3 前向扩展

协议允许在不破坏既有核心字段的前提下增加：

* 新的 object_type
* 新的 Pack
* 新的 query capability
* 新的同步模式
* 新的可选字段

### 17.4 破坏性变更

若需要改变核心字段语义、删除关键字段、改变 requirement 机制或改变顶层对象结构，应通过新的 package major version 发布。

---

## 18. 本版协议的边界结论

`ocp.catalog.handshake.v1` 是 OCP Catalog 的最小接入协议。其职责边界如下：

### 18.1 本版负责

* Catalog 对外声明能力
* Catalog 对对象和 Provider 声明契约
* Provider 建立或更新注册关系
* 对象的统一包络表达
* 注册与同步的解耦
* 最小发现与最小 endpoint 约定

### 18.2 本版暂不负责

* 大规模对象同步协议细节
* 权限控制与审计细节
* 联邦同步协议
* 查询与 Resolve 的完整业务语义
* 执行动作协议

---

## 19. 最终原则表述

`ocp.catalog.handshake.v1` defines the minimal handshake layer between an OCP Catalog and a Provider.

A Catalog declares its discoverability, endpoints, query capabilities, provider requirements, and object contracts through `CatalogManifest`.

A Provider establishes or updates its contract with a Catalog through a versioned `ProviderRegistration`.

Actual business objects are expressed through a unified `CommercialObject` envelope.

Registration and object data delivery are strictly decoupled. Handshake establishes contract state; object sync delivers real data through a dedicated synchronization endpoint.

### 中文版本

`ocp.catalog.handshake.v1` 定义了 OCP Catalog 与 Provider 之间的最小握手层。

Catalog 通过 `CatalogManifest` 声明自己的发现方式、访问端点、查询能力、Provider 接入要求与对象契约。

Provider 通过带版本的 `ProviderRegistration` 与 Catalog 建立或更新契约关系。

真实业务对象通过统一的 `CommercialObject` 包络表达。

注册与对象数据同步严格解耦：握手只建立契约状态，真实数据必须通过独立同步接口提交。

如果需要，下一步可以继续在这份正式协议文档的基础上补充一份附录，专门列出五个核心 schema 的完整 JSON Schema 定义。
