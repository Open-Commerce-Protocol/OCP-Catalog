# ocp.catalog.handshake.v1

`ocp.catalog.handshake.v1` 定义的是 `Provider -> Catalog Node` 的最小握手层。

它负责回答三件事：

1. 这个 Catalog 是谁，暴露了哪些入口
2. 这个 Catalog 接受什么对象契约
3. Provider 如何声明自己的对象供给能力

它不负责冻结完整的 sync/query/resolve payload，也不负责 Center 注册、联邦路由或交易流程。

## Scope

这个包当前冻结的对象包括：

- `CatalogManifest`
- `ObjectContract`
- `ProviderRegistration`
- `CommercialObject`
- `RegistrationResult`
- `FieldRef`
- `FieldRule`
- commerce product descriptor packs

文件结构：

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

## Boundary

这个包**不**冻结：

- `ObjectSyncRequest` / `ObjectSyncResult`
- `CatalogQueryRequest` / `CatalogQueryResult`
- `ResolveRequest` / `ResolvableReference`
- auth / payment / fulfillment / federation

当前仓库里的这些运行时对象仍由 `packages/ocp-schema` 维护，后续可以拆成：

- `ocp.catalog.sync.v1`
- `ocp.catalog.query.v1`
- `ocp.catalog.resolve.v1`

## CatalogManifest

`CatalogManifest` 的职责是让 Provider 和 Agent 知道：

- Catalog 的 identity
- 公开 endpoint
- 接受哪些对象契约
- 暴露哪些查询能力

### Query Capability Structure

当前结构里，查询能力的主表达方式是：

- `query_packs`

而不是顶层 `query_modes`。

也就是说，Catalog 告诉调用方“怎么搜”的主信息是：

```text
query_capabilities[*].query_packs[*]
```

每个 query pack 可以声明：

- `pack_id`
- `description`
- `query_modes`
- `request_schema_uri`
- `metadata`

其中：

- `query_modes` 是某个 `query_pack` 的执行提示
- `metadata` 是统一的可选扩展对象，用于承载语言提示、语义提示、实现提示等额外信息

### Why This Shape

这个结构的意图是：

- 固定协议主轴：`query_packs`
- 避免把所有实现提示抬成顶层必填字段
- 给语言、embedding、filter hints 留出稳定扩展位

例如，一个 capability 可以在 `metadata` 中暴露：

- `query_hints.supported_query_languages`
- `query_hints.content_languages`
- `query_hints.filter_fields`
- `semantic_search.enabled`

这些都属于附加提示，不属于最小握手闭环的硬要求。

## ObjectContract

`ObjectContract` 定义 Catalog 对某类对象的接入要求。

它回答：

- 支持什么 `object_type`
- 必需哪些 `required_packs`
- 哪些 `optional_packs` 可选
- 哪些字段必须满足
- 支持哪些 `registration_modes`

在当前仓库中，第一个场景 contract 是 commerce product contract。

## ProviderRegistration

`ProviderRegistration` 是 Provider 的版本化声明。

更新规则：

- key 为 `catalog_id + provider.provider_id`
- Provider 通过提交完整的新 `ProviderRegistration` 更新声明
- 新版本必须提高 `registration_version`
- `updated_at` 用于审计，不用于版本优先级判断

## CommercialObject

`CommercialObject` 是共享对象包络。

这个包只冻结对象的最小通用结构：

- `object_id`
- `object_type`
- `provider_id`
- `title`
- `summary`
- `status`
- `source_url`
- `descriptors`

它用于让 Catalog 能够校验 pack 和建立本地投影，但不冻结完整 sync API。

## RegistrationResult

`RegistrationResult` 是 Provider registration 的结构化反馈。

它至少会表达：

- `status`
- `effective_registration_version`
- `matched_contract_ids`
- `warnings`
- `missing_required_fields`

## FieldRef

字段引用格式：

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

## Discovery

Catalog 应公开：

```http
GET /.well-known/ocp-catalog
```

well-known 至少应指向：

- manifest
- contracts
- provider registration
- object sync
- query
- resolve

## Relationship To Center

这个包只处理：

```text
Provider -> Catalog Node
```

Catalog 注册到 Center 使用的是：

- `ocp.catalog.center.v1`

详见：

- [../ocp.catalog.center.v1/README.md](../ocp.catalog.center.v1/README.md)
- [../docs/ocp_catalog_handshake_protocol_v1.md](../docs/ocp_catalog_handshake_protocol_v1.md)
