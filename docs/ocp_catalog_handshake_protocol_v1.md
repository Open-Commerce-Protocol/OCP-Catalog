# OCP Catalog Handshake Protocol v1.0

## 1. 文档定位

本文档定义 `ocp.catalog.handshake.v1` 的正式协议规范，用于描述 OCP Catalog 与 Provider 之间的最小握手机制。

重要边界：

`ocp.catalog.handshake.v1` 只定义 **Provider 如何接入某个 Catalog Node**。它不定义 Catalog 如何注册到 OCP Catalog Registration node，也不定义 Catalog Registry / Catalog Discovery Node 的索引和搜索行为。

Catalog 注册到 OCP Catalog Registration node 的协议由 `ocp.catalog.center.v1` 定义，详见 `docs/ocp_catalog_registration_protocol_v1.md`。

两条链路必须区分：

```text
Provider -> Catalog Node
  使用 ocp.catalog.handshake.v1
  对象：CatalogManifest、ObjectContract、ProviderRegistration、CommercialObject、RegistrationResult

Catalog Node -> OCP Catalog Registration node
  使用 ocp.catalog.center.v1
  对象：CatalogRegistration、CatalogProfileSnapshot、CatalogIndexEntry、CatalogRouteHint
```

本协议聚焦以下核心问题：

1. Catalog 如何对外声明自身能力与接入要求。
2. Catalog 如何声明对 Provider 与对象数据的字段契约。
3. Catalog 如何声明 provider-facing sync capabilities。
4. Provider 如何与 Catalog 建立或更新接入契约关系。
5. Provider 如何声明自己的 sync capability 偏好与 provider-hosted endpoint。
6. 注册握手与真实对象数据同步如何解耦。

本协议不负责以下内容：

- 批量对象数据同步的完整 payload 标准。
- 联邦节点之间的同步与路由标准。
- 查询请求与 Resolve 请求的完整行业化模型。
- 支付、订单、履约、ATS、CRM、OMS 等执行流程。
- 权限系统与审计模型的完整规范。

---

## 2. 设计目标

### 2.1 最小可握手

协议只定义 Catalog 与 Provider 建立接入关系所需的最小对象与最小流程，不试图覆盖完整业务体系。

### 2.2 注册与数据同步解耦

`ProviderRegistration` 仅用于建立或更新契约关系，不承载批量真实对象数据。真实对象数据必须通过独立同步接口提交。

### 2.3 通用对象包络

协议不将“商品”作为唯一中心对象，而采用统一的 `CommercialObject` 包络。

### 2.4 契约可更新

Provider 后续能力升级时，必须能够通过版本化注册声明更新与 Catalog 的契约关系。

### 2.5 协商主键必须稳定

sync capability negotiation 必须靠稳定的 `capability_id`，不能靠模糊的 transport 字段。

### 2.6 扩展能力必须可容纳

协议要允许 future capabilities，例如 feed pull、API pull、streaming、delta cursor 等，但不能因此让 `v1.0` shape 失去约束。

---

## 3. 术语定义

### 3.1 Catalog

Catalog 是一个对外声明对象接入契约、同步能力、查询能力和访问端点的节点。

### 3.2 Provider

Provider 是向某个 Catalog 提供对象数据的主体。

### 3.3 CommercialObject

`CommercialObject` 是 OCP Catalog 中统一的对象包络。

### 3.4 Object Contract

`ObjectContract` 是 Catalog 针对某类对象声明的接入契约，定义对象的 pack 要求、字段要求和额外字段策略。

### 3.5 Sync Capability

`SyncCapability` 是 Catalog 发布的同步能力对象。

它的主协商键是：

- `capability_id`

它的辅助描述维度是：

- `direction`
- `transport`

其中：

- `direction` 是正式的数据流向类别
- `transport` 是实现形态标签，仅作描述和辅助校验，不参与主协商

### 3.6 Provider Registration

`ProviderRegistration` 是 Provider 向 Catalog 提交的契约建立或契约更新声明，用于表明自身身份、对象供给能力、保证字段和 sync capability 偏好。

### 3.7 Field Reference

`FieldRef` 是字段定位的统一表示方法。

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

---

## 4. 协议对象总览

`ocp.catalog.handshake.v1` 定义以下核心协议对象：

1. `CatalogManifest`
2. `ObjectContract`
3. `ProviderRegistration`
4. `CommercialObject`
5. `RegistrationResult`

补充公共对象：

- `FieldRef`
- `FieldRule`
- `SyncCapability`
- `SelectedSyncCapability`

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

## 6. CatalogManifest 规范

### 6.1 目标

`CatalogManifest` 是 Catalog 对外的标准自我声明。

它必须告诉 Provider：

- Catalog 的身份
- Catalog 的公开 endpoint
- Catalog 的 query capability
- Catalog 对 Provider 的字段要求
- Catalog 对 Provider 开放的 sync capability 集合
- Catalog 支持的对象契约

### 6.2 provider_contract 规范

`provider_contract` 应至少包含：

- `field_rules`
- `sync_capabilities`

其中：

- `field_rules` 描述 Provider 自身字段要求
- `sync_capabilities` 描述 Catalog 愿意协商的同步能力

### 6.3 SyncCapability 规范

`sync_capabilities[*]` 至少应声明：

- `capability_id`
- `direction`
- `transport`
- `sync_model`
- `mutation_semantics`

可选声明：

- `description`
- `batching`
- `cursoring`
- `streaming`
- `auth`
- `endpoint_contract`
- `metadata`

示例：

```json
{
  "capability_id": "ocp.push.batch",
  "description": "Provider pushes batched product objects to the catalog sync API.",
  "direction": "provider_to_catalog",
  "transport": "http_push",
  "sync_model": {
    "snapshot": true,
    "delta": false,
    "stream": false
  },
  "mutation_semantics": {
    "upsert": true,
    "delete": true
  },
  "batching": {
    "enabled": true,
    "max_items": 100,
    "max_bytes": 1048576
  },
  "cursoring": {
    "enabled": false
  },
  "streaming": {
    "enabled": false
  },
  "auth": {
    "schemes": ["x-api-key"]
  },
  "endpoint_contract": {
    "hosted_by": "catalog",
    "path_hint": "/ocp/objects/sync",
    "required_endpoint_fields": []
  },
  "metadata": {}
}
```

### 6.4 Query capability 规范

`query_capabilities` 仍通过 `query_packs` 暴露主要查询契约。

本协议只约束 Catalog 如何声明自己的 query contract，不约束 Catalog 内部必须按哪种对象分类、索引分桶或场景模型执行 query。

协议层主要冻结的是：

- 哪些 query endpoint 可用
- 哪些 query capability 可用
- 接受哪些输入字段
- 哪些字段可 filter / search / sort
- request schema 在哪里

---

## 7. ObjectContract 规范

### 7.1 目标

`ObjectContract` 用于定义 Catalog 对某类输入契约的最低接入要求和字段使用方式。

### 7.2 必须包含的字段

`ObjectContract` 必须至少包含：

- `required_fields`

可选声明：

- `optional_fields`
- `additional_fields_policy`

### 7.3 required_fields 规范

`required_fields[*]` 支持两种形状：

- 单个 `FieldRef`
- `FieldRef[]`，表示“这一组字段至少命中一个”

这使得 contract 可以直接按字段定义兼容条件，而不要求 Provider 理解额外的 pack 集合。

### 7.4 additional_fields_policy 规范

Catalog 可通过 `additional_fields_policy` 指定对未声明字段的处理策略：

- `allow`
- `ignore`
- `reject`

### 7.5 明确边界

`ObjectContract` 不再承载：

- `registration_modes`
- sync mode
- transport choice

这些语义统一移到 capability negotiation 层。

### 7.6 当前仓库里的真实 commerce contract

当前仓库已经落地的 commerce catalog，真实最低接入 contract 是：

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title",
    "ocp.commerce.price.v1#/currency",
    "ocp.commerce.price.v1#/amount"
  ],
  "optional_fields": [
    "ocp.commerce.product.core.v1#/summary",
    "ocp.commerce.product.core.v1#/brand",
    "ocp.commerce.product.core.v1#/category",
    "ocp.commerce.product.core.v1#/sku",
    "ocp.commerce.product.core.v1#/product_url",
    "ocp.commerce.product.core.v1#/image_urls",
    "ocp.commerce.inventory.v1#/availability_status",
    "ocp.commerce.inventory.v1#/quantity"
  ],
  "additional_fields_policy": "allow"
}
```

这说明当前示例已经不再把“只有 title 的对象”视为足够的 commerce 基线。

---

## 8. ProviderRegistration 规范

### 8.1 目标

`ProviderRegistration` 用于 Provider 与 Catalog 建立或更新接入契约关系。

### 8.2 明确边界

`ProviderRegistration` 不承载真实大规模对象集合。

### 8.3 必须包含的字段

`ProviderRegistration` 必须至少包含：

- `ocp_version`
- `kind`
- `id`
- `catalog_id`
- `provider`
- `registration_version`
- `updated_at`
- `object_declarations`

### 8.4 object_declarations 规范

`object_declarations[*]` 至少应包含：

- `guaranteed_fields`
- `sync`

Catalog 对 `object_declarations[*]` 的匹配必须基于：

- `guaranteed_fields`
- `required_fields`

也就是说，在协议层，Provider 只要其声明满足某个 `ObjectContract` 的必需字段要求，就可以完成握手匹配。

### 8.5 为什么只做字段级握手匹配

这里的设计重点不是弱化契约，而是收紧协议边界。

握手层的目标是判断：

- Provider 是否能满足 Catalog 的最低字段要求
- 双方是否存在共同可用的 sync capability

协议层不要求 Provider 先采用某种统一对象类型命名，也不要求 Catalog 暴露自己的内部索引分桶、query 主分类或场景模型。

这样设计有三个原因：

- 字段要求是 Catalog 真正可验证的接入条件
- 字段匹配不依赖双方预先共享 taxonomy 或 pack 命名体系
- Catalog 可以保留自己的运行时分类、projection 和索引实现，而不把这些内部结构上升为协议约束

因此，字段级握手表达的是“是否满足接入契约”，不是“对象在语义上属于哪一类”。

### 8.6 sync 声明面

`sync` 当前应包含：

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

这里没有：

- `supported_capabilities`
- `disallowed_capabilities`

如果 capability 没出现在这两个 capability 列表中，它就不参与协商。

### 8.7 provider_endpoints 规范

`provider_endpoints` 是 endpoint map。

`v1.0` shape 应为：

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

`v1.0` 不应使用 bare string endpoint。

这样可稳定容纳未来字段，例如：

- auth override
- content type
- refresh hint
- checksum url
- webhook callback
- delta cursor bootstrap endpoint

### 8.8 guaranteed_fields 规范

一旦字段被声明为 guaranteed，Provider 在该注册版本下提交的该类契约对象均应保证包含这些字段。

### 8.9 当前仓库里的真实 provider 声明

当前仓库中的默认 commerce provider 会声明：

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`
- `ocp.commerce.product.core.v1#/product_url`

也就是说，provider 默认会比 catalog 最低门槛更强，主动保证一个可 resolve 的商品详情入口。

---

## 9. RegistrationResult 规范

### 9.1 目标

`RegistrationResult` 是 Catalog 对 `ProviderRegistration` 的结构化响应。

### 9.2 必须包含的字段

`RegistrationResult` 必须至少包含：

- `ocp_version`
- `kind`
- `id`
- `status`
- `catalog_id`

### 9.3 建议返回字段

建议返回：

- `provider_id`
- `matched_object_contract_count`
- `effective_registration_version`
- `selected_sync_capability`
- `missing_required_fields`
- `warnings`
- `message`

### 9.4 selected_sync_capability 规范

`selected_sync_capability` 应明确返回：

- `capability_id`
- `reason`

示例：

```json
{
  "selected_sync_capability": {
    "capability_id": "ocp.push.batch",
    "reason": "provider_preferred_and_supported_by_catalog"
  }
}
```

### 9.5 当前仓库里的真实成功路径

当前默认 commerce provider 与 commerce catalog 的成功返回通常会是：

- `status = accepted_full`
- `matched_object_contract_count = 1`
- `selected_sync_capability.capability_id = "ocp.push.batch"`
- `warnings = []`

`accepted_limited` 仍然是协议层允许的状态，但不再是当前默认 example 想要展示的主路径。

---

## 10. 协商算法

对每个 `object_declaration`：

1. Catalog 遍历自身公开的 `ObjectContract`
2. 校验 declaration 是否满足某个 contract 的 `required_fields`
3. 若 `required_fields[*]` 为单个 `FieldRef`，则必须命中该字段
4. 若 `required_fields[*]` 为 `FieldRef[]`，则该组字段至少命中一个
5. 从 `CatalogManifest.provider_contract.sync_capabilities` 中筛出可协商的 capability
6. 计算交集：
   - catalog `sync_capabilities[*].capability_id`
   - provider `sync.preferred_capabilities + sync.avoid_capabilities_unless_necessary`
7. 优先选择 `preferred_capabilities`
8. 只有没有 preferred match 时，才使用 `avoid_capabilities_unless_necessary`
9. 若 capability 的 `endpoint_contract.required_endpoint_fields` 非空，则检查 provider 是否在 `provider_endpoints` 中声明了这些 endpoint
10. 返回 `selected_sync_capability`

如果交集为空，则该 declaration 不可用。

### 10.1 明确原则

真正协商靠 `capability_id`，不是靠 `transport`。

`transport` 只能用于：

- 描述实现形态
- 辅助 schema / lint 校验
- 给实现方提供额外提示

---

## 11. 当前仓库映射

当前仓库里的 commerce provider/catalog 示例主链路应映射为：

```text
ProviderRegistration.guaranteed_fields
  includes title + price.currency + price.amount + product_url
  -> Catalog matches the commerce ObjectContract
  -> Catalog 选择 ocp.push.batch
  -> RegistrationResult.selected_sync_capability = ocp.push.batch
  -> Provider 调用 /ocp/objects/sync 发送 batch sync
  -> Catalog 将对象投影成带价格、图片、库存和 quality tier 的商品搜索条目
```

也就是说，当前真实实现已经完成的是：

- `ocp.push.batch`

而不是 `feed_url pull`、`pull.api` 或 `streaming`。

---

## 12. 预留能力与实现要求

### 12.1 `ocp.feed.url`

协议语义：

- Catalog 从 Provider 暴露的 feed URL 拉取快照

Catalog 侧需要实现：

- feed fetcher
- refresh scheduler
- checksum / etag / last-modified 处理
- 全量快照替换或幂等 upsert 逻辑
- 拉取失败重试与审计

Provider 侧需要实现：

- `provider_endpoints.feed_url.url`
- 可稳定访问的 feed document
- 可选 checksum / refresh hint / auth override

### 12.2 `ocp.pull.api`

协议语义：

- Catalog 主动调用 Provider API 拉取对象

Catalog 侧需要实现：

- provider API client
- 鉴权管理
- 分页或游标拉取
- bootstrap 与增量更新状态存储

Provider 侧需要实现：

- 稳定的 pull API
- bootstrap endpoint
- cursor / page token 协议
- 错误码与限流约定

### 12.3 `ocp.streaming`

协议语义：

- Provider 持续向 Catalog 输出变更流

Catalog 侧需要实现：

- stream session 管理
- checkpoint / cursor restore
- 幂等消费
- 断线重连和 replay

Provider 侧需要实现：

- stream endpoint 或 webhook/event channel
- checkpoint 协议
- replay window
- event ordering / dedupe 语义

这些能力在实现完成前，不应出现在当前运行时示例的 manifest 中。

---

## 13. 最小 Endpoint 规范

### 13.1 GET /.well-known/ocp-catalog

返回轻量 discovery document。

### 13.2 GET /ocp/manifest

返回 `CatalogManifest`。

### 13.3 GET /ocp/contracts

返回 `ObjectContract` 列表。

### 13.4 POST /ocp/providers/register

请求：`ProviderRegistration`  
返回：`RegistrationResult`

### 13.5 POST /ocp/objects/sync

用于真实对象数据同步。

本协议要求 `CatalogManifest` 声明该 endpoint 的存在，但不在 `ocp.catalog.handshake.v1` 中冻结完整对象同步 payload。

### 13.6 与运行时 schema 的关系

当前仓库中，完整的运行时 payload 仍由 `packages/ocp-schema` 维护，包括：

- `ObjectSyncRequest` / `ObjectSyncResult`
- `CatalogQueryRequest` / `CatalogQueryResult`
- `ResolveRequest` / `ResolvableReference`

也就是说，`ocp.catalog.handshake.v1` 在当前阶段只冻结“Catalog 如何声明接入与能力”，而不冻结 query/sync/resolve 的完整运行时消息体。

---

## 14. 兼容性与演进

### 14.1 前向扩展

协议允许在不破坏核心字段的前提下增加：

- 新的 object_type
- 新的 Pack
- 新的 query capability
- 新的 sync capability
- 新的 provider endpoint 字段

### 14.2 破坏性变更

若需要改变核心字段语义、删除关键字段、改变 requirement 机制或改变顶层对象结构，应通过新的 major version 发布。

---

## 15. 最终原则表述

`ocp.catalog.handshake.v1` defines the minimal handshake layer between an OCP Catalog and a Provider.

A Catalog declares its endpoints, object contracts, query capabilities, provider field requirements, and provider-facing sync capabilities through `CatalogManifest`.

A Provider establishes or updates its contract with a Catalog through a versioned `ProviderRegistration`.

Sync capability negotiation matches on `capability_id`, not on `transport`.

Registration and object data delivery are strictly decoupled: handshake establishes contract state; real object data flows through a dedicated sync endpoint or a separately implemented provider-facing transport.
