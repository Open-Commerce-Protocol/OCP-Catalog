# OCP Catalog Registration Protocol v1.0

## 1. 文档定位

本文档定义 **OCP Catalog Registration** 的第一版协议草案，用于描述 **Catalog 如何注册到 OCP Catalog Registration node**，以及用户、Agent 如何通过 OCP Catalog Registration node 发现可用 Catalog。

当前实现仍保留 legacy wire namespace `ocp.catalog.center.v1`、`CenterDiscovery`、`CenterManifest` 和 `center_*` 字段名，以保持兼容。它们只是历史命名，不表示 OCP 协议存在中心权威；本文档后续统一使用 OCP Catalog Registration / registration node 表达这个角色。

本协议解决的是：

```text
Catalog Node
  -> 注册到 OCP Catalog Registration node
  -> Registration node 拉取并校验 CatalogManifest
  -> Registration node 验证 Catalog 身份、健康与查询能力
  -> Registration node 生成 Catalog 索引
  -> 用户或 Agent 在 Registration node 搜索可用 Catalog
  -> Agent 保存 Catalog 到本地
  -> 后续由 Agent 按 Catalog 声明的 Query Capability 调用对应 Catalog
```

本文档不定义 Provider 如何接入 Catalog。Provider 接入 Catalog 仍由 `ocp.catalog.handshake.v1` 定义。

本协议当前兼容 schema package 保存在：

```text
ocp.catalog.center.v1/
```

当前 TypeScript/Zod 运行时 schema 保存在：

```text
packages/center-schema/
```

## 2. 角色边界

### 2.1 OCP Catalog Registration node

OCP Catalog Registration node 是 **Catalog 的 Catalog**，也可以称为 Catalog Registration Registry、Catalog Discovery Node 或 Catalog Router。

OCP Catalog Registration node 负责：

- 接收 Catalog 注册申请。
- 拉取 Catalog 的 discovery document 与 manifest。
- 校验 Catalog 的查询能力、对象契约、端点声明与协议版本。
- 验证 Catalog 运营方对声明域名的控制权。
- 记录 Catalog 的健康状态、验证状态、信任等级与新鲜度。
- 对 Catalog metadata 建索引。
- 为用户或 Agent 提供 Catalog 搜索。
- 返回可被本地保存和后续调用的 Catalog route hint。

OCP Catalog Registration node 默认不负责：

- 存储每个 Catalog 内部完整对象。
- 替代 Catalog 的私有索引引擎。
- 替代 Catalog 的 Query / Resolve 权限判断。
- 替代 Provider 的权威数据源。
- 统一全网交易、支付、履约或业务状态机。

### 2.2 Catalog Node

Catalog Node 是一个可被发现、可被查询、可声明查询能力和对象契约的场景节点。

Catalog Node 负责：

- 暴露 `/.well-known/ocp-catalog`。
- 暴露 `CatalogManifest`。
- 声明支持哪些 object types、descriptor contracts 和 query capabilities。
- 自己实现内部索引、召回、排序、解释与权限过滤。
- 接收 Provider 对象，或通过其他方式构建自己的对象索引。
- 对外提供 `/ocp/query` 和 `/ocp/resolve`。

当前仓库里的第一个真实 Catalog Node 是一个 commerce product catalog，它会：

- 发布 `ocp.commerce.product.search.v1`
- 在 capability 下发布 `ocp.query.keyword.v1`、`ocp.query.filter.v1`
- 在启用 embedding 时额外发布 `ocp.query.semantic.v1`
- 暴露 `supported_query_languages = ["en"]`
- 暴露 `content_languages = ["en"]`

### 2.3 Provider

Provider 是对象的来源方，例如商户、服务商、招聘方、供应商或数据平台。

Provider 通常注册到某个 Catalog Node，而不是注册到 OCP Catalog Registration node。OCP Catalog Registration node 只索引 Catalog 的能力与入口，不直接要求 Provider 同步对象。

### 2.4 Agent / User

Agent 或用户可以：

- 先搜索本地已保存的 Catalog。
- 本地没有合适 Catalog 时，再向 OCP Catalog Registration node 搜索 Catalog。
- 保存候选 Catalog 的 profile 和 route hints。
- 后续根据 Catalog 的 query capability 调用该 Catalog 的 `/ocp/query`。

## 3. 与现有协议的关系

`ocp.catalog.handshake.v1` 定义：

```text
Provider -> Catalog
```

OCP Catalog Registration 定义：

```text
Catalog -> OCP Catalog Registration node
```

二者不能混用：

- `ProviderRegistration` 是 Provider 对 Catalog 的能力声明。
- `CatalogRegistration` 是 Catalog 对 OCP Catalog Registration node 的注册声明。
- `CommercialObject` 是 Catalog 内部可索引对象。
- `CatalogIndexEntry` 是 OCP Catalog Registration node 对 Catalog metadata 的本地索引投影。

## 4. 协议对象总览

OCP Catalog Registration 当前兼容 schema 建议定义以下对象：

- `CenterDiscovery`
- `CenterManifest`
- `CatalogRegistration`
- `CatalogRegistrationResult`
- `CatalogProfileSnapshot`
- `CatalogIndexEntry`
- `CatalogVerificationChallenge`
- `CatalogVerificationResult`
- `CatalogHealthSnapshot`
- `CatalogSearchRequest`
- `CatalogSearchResult`
- `CatalogSearchResultItem`
- `CatalogRouteHint`

## 4.1 Endpoint 总览

OCP Catalog Registration node 第一版建议暴露：

```text
GET  /health
GET  /.well-known/ocp-center
GET  /ocp/registration/manifest

POST /ocp/catalogs/register
GET  /ocp/catalogs/:catalogId
GET  /ocp/catalogs/:catalogId/manifest-snapshot
GET  /ocp/catalogs/:catalogId/health
POST /ocp/catalogs/:catalogId/refresh
GET  /ocp/catalogs/:catalogId/verification
POST /ocp/catalogs/:catalogId/verify
POST /ocp/catalogs/:catalogId/token/rotate

POST /ocp/catalogs/search
POST /ocp/catalogs/resolve
```

其中：

- `/ocp/catalogs/register` 用于 Catalog 注册或更新注册声明。
- `/ocp/catalogs/:catalogId/refresh` 用于触发 Registration node 重新拉取 discovery / manifest / health。
- `/ocp/catalogs/:catalogId/verify` 用于执行 DNS TXT 或 HTTPS well-known challenge 校验。
- `/ocp/catalogs/:catalogId/token/rotate` 用于轮换 catalog-specific token。
- `/ocp/catalogs/search` 用于搜索 Catalog metadata。
- `/ocp/catalogs/resolve` 用于把搜索结果解析成可保存的 `CatalogRouteHint`，不是解析商业对象。

具体 Catalog Node 仍应暴露：

```text
GET  /.well-known/ocp-catalog
GET  /ocp/manifest
GET  /ocp/contracts
POST /ocp/query
POST /ocp/resolve
```

Provider 接入 Catalog Node 的 endpoint 仍属于 `ocp.catalog.handshake.v1`，不属于 Registration node 协议。

## 5. Registration node Discovery

OCP Catalog Registration node 应暴露：

```http
GET /.well-known/ocp-center
```

返回 `CenterDiscovery`：

```json
{
  "ocp_version": "1.0",
  "kind": "CenterDiscovery",
  "center_id": "center_ocp_public",
  "center_name": "OCP Public Catalog Registration",
  "center_protocol": "ocp.catalog.center.v1",
  "center_protocol_version": "1.0.0",
  "manifest_url": "https://registration.example.com/ocp/registration/manifest",
  "catalog_registration_url": "https://registration.example.com/ocp/catalogs/register",
  "catalog_search_url": "https://registration.example.com/ocp/catalogs/search"
}
```

## 6. Registration node Manifest

OCP Catalog Registration node 应暴露：

```http
GET /ocp/registration/manifest
```

返回 `CenterManifest`，用于声明 Registration node 的注册、验证、搜索和治理能力：

```json
{
  "ocp_version": "1.0",
  "kind": "CenterManifest",
  "center_id": "center_ocp_public",
  "center_name": "OCP Public Catalog Registration",
  "supported_protocols": [
    "ocp.catalog.center.v1",
    "ocp.catalog.handshake.v1"
  ],
  "catalog_registration": {
    "registration_modes": ["open_intake", "invite_only"],
    "default_status": "pending_verification",
    "requires_domain_verification": true,
    "requires_https": true
  },
  "catalog_search_capabilities": [
    {
      "capability_id": "registration.catalog.keyword.v1",
      "query_modes": ["keyword", "filter"],
      "filter_fields": [
        "query_pack",
        "verification_status",
        "trust_tier",
        "domain",
        "tag"
      ],
      "supports_explain": true
    }
  ]
}
```

## 7. CatalogRegistration

Catalog Node 向 OCP Catalog Registration node 注册时提交 `CatalogRegistration`。

Endpoint：

```http
POST /ocp/catalogs/register
```

最小请求：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogRegistration",
  "id": "catreg_demo_commerce_1",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "registration_version": 1,
  "updated_at": "2026-04-20T00:00:00.000Z",
  "homepage": "https://catalog.example.com",
  "well_known_url": "https://catalog.example.com/.well-known/ocp-catalog",
  "claimed_domains": ["catalog.example.com"],
  "intended_visibility": "public",
  "tags": ["commerce", "product", "retail"]
}
```

字段说明：

- `center_id`：目标 OCP Catalog Registration node。
- `catalog_id`：Catalog Node 自己声明的稳定 ID，必须与 `CatalogManifest.catalog_id` 一致。
- `registration_version`：Catalog 对 Registration node 的注册版本。
- `well_known_url`：Registration node 用于拉取 Catalog discovery document 的入口。
- `claimed_domains`：Catalog 声称控制的域名集合。
- `intended_visibility`：希望被 Registration node 公开索引的范围。
- `tags`：Registration node 建索引用的轻量场景标签。

可选字段：

- `operator`：Catalog 自愿提供的运营方身份元数据，可用于展示、审计或治理，但不应成为注册成功的前提条件。

## 8. CatalogRegistrationResult

Registration node 返回 `CatalogRegistrationResult`：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogRegistrationResult",
  "id": "catregres_01",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "status": "pending_verification",
  "effective_registration_version": 1,
  "manifest_fetch_status": "fetched",
  "verification_status": "challenge_required",
  "health_status": "unknown",
  "indexed": false,
  "warnings": [],
  "verification_challenges": [
    {
      "challenge_id": "catchal_01",
      "challenge_type": "dns_txt",
      "domain": "catalog.example.com",
      "name": "_ocp-center.catalog.example.com",
      "value": "ocp-center-verification=center_ocp_public:abc123",
      "expires_at": "2026-04-21T00:00:00.000Z"
    }
  ]
}
```

`status` 取值：

- `accepted_indexed`：已验证并进入 Registration node 索引。
- `accepted_pending_verification`：注册已记录，但尚未验证，默认不进入公开索引。
- `accepted_limited`：可进入弱索引，但部分能力或验证缺失。
- `rejected`：无法注册。
- `stale_ignored`：低版本或重复版本被记录但不覆盖 active 状态。

当前仓库里的默认 local/dev 主路径一般会比这个通用模型更直接：

- 注册成功
- manifest 抓取成功
- Catalog 进入 indexed 状态
- 后续可通过 refresh / token rotation 维持状态

## 9. 注册握手流程

### 9.1 标准流程

```text
Catalog Operator
  -> POST /ocp/catalogs/register
OCP Catalog Registration node
  -> 拉取 Catalog /.well-known/ocp-catalog
  -> 拉取 Catalog /ocp/manifest
  -> 校验 discovery 与 manifest
  -> 生成 verification challenge
Catalog Operator
  -> 完成 DNS TXT 或 HTTPS well-known challenge
OCP Catalog Registration node
  -> 验证域名控制权
  -> 执行 health probe
  -> 生成 CatalogProfileSnapshot
  -> 生成 CatalogIndexEntry
  -> Catalog 进入 searchable index
```

### 9.2 版本更新规则

Registration node 使用以下组合识别一个 Catalog 注册关系：

```text
center_id + catalog_id
```

若新提交的 `registration_version` 大于 active version，且 manifest 校验通过，则视为 Catalog 注册更新。

若新提交的版本小于或等于 active version：

- 应记录 registration attempt。
- 不应覆盖 active CatalogProfileSnapshot。
- 返回 `stale_ignored` 或 `accepted_pending_verification`，并说明 active version。

### 9.3 Manifest 拉取规则

Registration node 必须通过 `well_known_url` 拉取 Catalog discovery document，再通过 discovery 中的 `manifest_url` 拉取完整 `CatalogManifest`。

Registration node 不应只信任注册请求中直接提交的 manifest snapshot。

最小校验：

- `well_known_url` 必须是 HTTPS，localhost/dev 环境可例外。
- discovery 中的 `catalog_id` 必须等于 `CatalogRegistration.catalog_id`。
- manifest 中的 `catalog_id` 必须等于 discovery 中的 `catalog_id`。
- manifest 必须声明 `query` endpoint。
- manifest 必须声明至少一个 query capability。
- manifest endpoint URL 必须是合法 URL。
- endpoint 域名必须在 `claimed_domains` 内，或由 manifest 明确声明为授权外部域名。

## 10. Catalog 身份验证

Catalog 注册不能只靠自声明。Registration node 至少应支持以下验证方式之一。

验证通过前，Registration node 可以保存 registration record 和 manifest snapshot，但默认不得进入公开 `catalog_index_entries`。验证通过后，Registration node 才应将 Catalog 标记为 `verified`，生成或激活 `CatalogIndexEntry`，并签发 catalog-specific token。

### 10.1 DNS TXT Challenge

Registration node 返回：

```json
{
  "challenge_type": "dns_txt",
  "domain": "catalog.example.com",
  "name": "_ocp-center.catalog.example.com",
  "value": "ocp-center-verification=center_ocp_public:abc123"
}
```

Catalog Operator 在 DNS 中添加 TXT 记录。Registration node 验证通过后记录 `CatalogVerificationResult`。

### 10.2 HTTPS Well-Known Challenge

Registration node 返回：

```json
{
  "challenge_type": "https_well_known",
  "url": "https://catalog.example.com/.well-known/ocp-center-verification/center_ocp_public.json",
  "token": "abc123"
}
```

Catalog 需要返回：

```json
{
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "token": "abc123"
}
```

### 10.3 Signed Manifest

后续可支持 Catalog 使用私钥签名 manifest。Registration node 通过已验证的 public key 校验签名。

MVP 阶段可以先实现 DNS TXT 或 HTTPS well-known challenge。

### 10.4 Verification Endpoint

Registration node 应提供：

```http
POST /ocp/catalogs/:catalogId/verify
```

请求：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogVerificationRequest",
  "challenge_id": "catchal_01"
}
```

如果不传 `challenge_id`，Registration node 可以尝试验证该 Catalog 的全部 pending challenges。

返回：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogVerificationResult",
  "id": "catverres_01",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "verification_status": "verified",
  "indexed": true,
  "verified_domains": ["catalog.example.com"],
  "failed_challenges": [],
  "catalog_access_token": "oct_once_visible_token",
  "message": "Catalog verified, indexed, and catalog-specific token issued."
}
```

`catalog_access_token` 只在首次签发或显式轮换时返回一次。Registration node 不应保存明文 token，只保存不可逆 hash。

### 10.5 Verification Records

Registration node 应提供调试查询：

```http
GET /ocp/catalogs/:catalogId/verification
```

返回当前 Catalog 的 challenge 记录、状态、过期时间和验证时间。该接口后续可以加权限控制，MVP 可公开用于调试。

## 11. CatalogProfileSnapshot

Registration node 对已拉取并校验的 CatalogManifest 生成 `CatalogProfileSnapshot`。

示例：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogProfileSnapshot",
  "id": "catsnap_01",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "catalog_name": "Demo Commerce Catalog",
  "description": "Product and service discovery catalog.",
  "homepage": "https://catalog.example.com",
  "well_known_url": "https://catalog.example.com/.well-known/ocp-catalog",
  "manifest_url": "https://catalog.example.com/ocp/manifest",
  "query_capabilities": [
    {
      "capability_id": "ocp.commerce.product.search.v1",
      "query_packs": [
        {
          "pack_id": "ocp.query.keyword.v1",
          "query_modes": ["keyword", "hybrid"]
        },
        {
          "pack_id": "ocp.query.filter.v1",
          "query_modes": ["filter", "hybrid"]
        },
        {
          "pack_id": "ocp.query.semantic.v1",
          "query_modes": ["semantic", "hybrid"]
        }
      ],
      "supports_explain": true,
      "supports_resolve": true
    }
  ],
  "object_contract_summaries": [
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
      ]
    }
  ],
  "verification_status": "verified",
  "health_status": "healthy",
  "trust_tier": "verified_domain",
  "freshness": {
    "manifest_fetched_at": "2026-04-20T00:00:00.000Z",
    "health_checked_at": "2026-04-20T00:01:00.000Z"
  }
}
```

Registration node 保存的是 profile snapshot，不是 Catalog 内部完整对象数据库。

## 12. CatalogIndexEntry

`CatalogIndexEntry` 是 OCP Catalog Registration node 对 Catalog 的本地搜索投影。

建议字段：

```text
id
center_id
catalog_id
catalog_name
description
homepage
manifest_url
well_known_url
supported_query_modes
supported_query_packs
supports_resolve
tags
domains
verification_status
trust_tier
health_status
freshness_status
search_projection
explain_projection
active_snapshot_id
created_at
updated_at
```

`search_projection` 可包含：

- Catalog 名称。
- 描述。
- tags。
- query capability names。
- object contract summaries。
- domain。
- optional operator display name。

## 13. Catalog Search

Endpoint：

```http
POST /ocp/catalogs/search
```

请求：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogSearchRequest",
  "query": "commerce catalog for travel headphones under 150",
  "filters": {
    "query_pack": "ocp.commerce.product.search.v1",
    "supports_resolve": true,
    "verification_status": "verified"
  },
  "limit": 20,
  "explain": true
}
```

支持的 MVP filters：

- `query_pack`
- `supports_resolve`
- `verification_status`
- `trust_tier`
- `health_status`
- `domain`
- `tag`

返回：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogSearchResult",
  "id": "catsearch_01",
  "center_id": "center_ocp_public",
  "result_count": 1,
  "items": [
    {
      "catalog_id": "catalog_demo_commerce",
      "catalog_name": "Demo Commerce Catalog",
      "description": "Product and service discovery catalog.",
      "score": 0.91,
      "matched_query_capabilities": ["ocp.commerce.product.search.v1"],
      "verification_status": "verified",
      "trust_tier": "verified_domain",
      "health_status": "healthy",
      "route_hint": {
        "catalog_id": "catalog_demo_commerce",
        "manifest_url": "https://catalog.example.com/ocp/manifest",
        "query_url": "https://catalog.example.com/ocp/query",
        "resolve_url": "https://catalog.example.com/ocp/resolve",
        "supported_query_modes": ["keyword", "filter", "semantic", "hybrid"],
        "supported_query_packs": [
          "ocp.commerce.product.search.v1"
        ],
        "auth_requirements": {
          "query": "none",
          "resolve": "none"
        },
        "cache_ttl_seconds": 86400
      },
      "explain": [
        "Catalog supports commerce product search and resolve.",
        "Catalog domain is verified."
      ]
    }
  ]
}
```

## 14. CatalogRouteHint

`CatalogRouteHint` 是 Agent 可以保存到本地的最小可调用信息。

它不是永久授权凭证，不应包含 secret。

建议字段：

```text
catalog_id
catalog_name
manifest_url
query_url
resolve_url
supported_query_modes
supported_query_packs
auth_requirements
verification_status
trust_tier
health_status
cache_ttl_seconds
snapshot_id
snapshot_fetched_at
```

Agent 使用 route hint 的方式：

```text
1. 保存 route hint 到本地 catalog cache。
2. 后续查询前按 TTL 判断是否需要刷新 manifest。
3. 根据 manifest/query capability 构造对应 Catalog 的 query request。
4. 直接调用源 Catalog 的 query endpoint。
5. 如需解析结果，调用源 Catalog 的 resolve endpoint。
```

## 15. Registration node 是否代查远端 Catalog

MVP 阶段，OCP Catalog Registration node 只做 Catalog discovery，不强制做远端 query broker。

建议分两层：

### 15.1 Catalog Search

```text
用户/Agent -> Registration node -> 搜 Catalog metadata -> 返回 route hints
```

这是 Registration node 的核心职责。

### 15.2 Federation Query Broker

```text
用户/Agent -> Registration node -> Registration node 代为路由多个 Catalog -> 聚合对象结果
```

这是后续能力。它涉及权限传递、结果归一化、远端失败隔离、缓存和信任加权，不应作为第一版 Registration node 的必要能力。

## 16. 安全与治理

### 16.1 注册入口是否需要 API Key

Catalog 初次注册可以采用 open intake，但 open intake 不等于直接进入公开索引。

MVP 建议：

- `POST /ocp/catalogs/register` 可以对公网开放。
- 未验证 Catalog 默认 `accepted_pending_verification`。
- 未验证 Catalog 不进入公开搜索结果，或只进入低信任隔离索引。
- 注册入口必须有 rate limit、body size limit、domain allow/deny policy。
- refresh/update 操作必须要求 catalog-specific token、signed manifest 或重新验证。

### 16.2 Catalog 更新凭证

Catalog 通过验证后，Registration node 可以签发 catalog-specific token。

该 token 只能用于：

- refresh 当前 `catalog_id`。
- 更新 registration metadata。
- 查看自己的 verification/health 状态。

不能用于：

- 修改其他 Catalog。
- 注入 Catalog 搜索结果。
- 绕过 manifest 拉取与校验。

MVP token 传递方式：

```http
x-catalog-token: oct_...
```

Registration node 必须只保存 token hash，例如 SHA-256 hash。明文 token 只在以下场景返回：

- Catalog 注册在 local/dev 自动验证并直接入索引。
- Catalog verification 首次通过。
- Catalog token 显式轮换。

### 16.2.1 Catalog Refresh

Registration node 应提供：

```http
POST /ocp/catalogs/:catalogId/refresh
```

该接口必须要求 `x-catalog-token`。

Refresh 必须重新执行：

- 拉取 `well_known_url`。
- 拉取 manifest。
- 校验 `catalog_id`。
- 校验 endpoint / query capabilities。
- 执行 health probe。
- 写入新的 `CatalogManifestSnapshot`。
- 更新 `CatalogIndexEntry`。

返回：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogRefreshResult",
  "id": "catrefresh_01",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "status": "refreshed",
  "snapshot_id": "catsnap_02",
  "health_status": "healthy",
  "indexed": true,
  "warnings": []
}
```

### 16.2.2 Catalog Token Rotation

Registration node 应提供：

```http
POST /ocp/catalogs/:catalogId/token/rotate
```

该接口必须要求当前有效 `x-catalog-token`。

返回：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogTokenRotationResult",
  "id": "cattoken_01",
  "center_id": "center_ocp_public",
  "catalog_id": "catalog_demo_commerce",
  "catalog_access_token": "oct_new_once_visible_token",
  "token_issued_at": "2026-04-21T00:00:00.000Z"
}
```

轮换成功后，旧 token 必须立即失效。

### 16.3 身份核验底线

Registration node 至少要记录：

- verification method。
- verified domain。
- verification timestamp。
- challenge id。
- manifest snapshot id。
- optional operator contact。
- source IP / user agent。

### 16.4 搜索治理

Registration node 搜索默认只返回：

- `verified`
- `healthy` 或最近健康状态可接受
- `public` visibility

调用方可以显式请求 `pending` 或 `limited`，但结果必须带明显 trust/explain 信息。

## 17. 数据模型建议

第一版 Registration node 建议新增独立表，不复用 Provider/Object 表：

```text
registered_catalogs
  id
  center_id
  catalog_id
  active_registration_id
  active_registration_version
  active_snapshot_id
  status
  verification_status
  health_status
  trust_tier
  catalog_access_token_hash
  token_issued_at
  homepage
  well_known_url
  claimed_domains
  operator (optional)
  created_at
  updated_at

catalog_registration_records
  id
  center_id
  catalog_id
  registration_version
  status
  registration_payload
  result_payload
  source_ip
  user_agent
  created_at

catalog_manifest_snapshots
  id
  center_id
  catalog_id
  registration_id
  manifest_url
  discovery_payload
  manifest_payload
  manifest_hash
  query_capabilities
  object_contract_summaries
  created_at

catalog_index_entries
  id
  center_id
  catalog_id
  active_snapshot_id
  entry_status
  catalog_name
  description
  tags
  domains
  supported_query_modes
  supported_query_packs
  supports_resolve
  verification_status
  trust_tier
  health_status
  search_projection
  explain_projection
  created_at
  updated_at

catalog_verification_records
  id
  center_id
  catalog_id
  challenge_type
  challenge_payload
  status
  verified_domain
  verified_at
  expires_at
  created_at

catalog_health_checks
  id
  center_id
  catalog_id
  checked_url
  status
  latency_ms
  error
  checked_at

catalog_search_audit_records
  id
  center_id
  request_payload
  result_count
  requester_key_hash
  created_at
```

## 18. 第一版验收标准

第一版 OCP Catalog Registration node 完成应满足：

- Catalog 可以提交 `CatalogRegistration`。
- Registration node 可以拉取 Catalog `.well-known/ocp-catalog`。
- Registration node 可以拉取并校验 `CatalogManifest`。
- Registration node 可以生成 domain verification challenge。
- 完成验证后 Catalog 可进入 active/indexed 状态。
- Registration node 可以生成 `CatalogProfileSnapshot`。
- Registration node 可以生成 `CatalogIndexEntry`。
- 用户或 Agent 可以通过 `/ocp/catalogs/search` 搜索 Catalog。
- 搜索结果返回 `CatalogRouteHint`。
- route hint 不包含 secret。
- Registration node 不同步 Catalog 内部完整对象。
- Registration node 不替代源 Catalog 的 Query / Resolve 权限判断。

## 19. 推荐实施顺序

```text
Step 1: 定义 Registration node schema 和类型
Step 2: 新增 OCP Catalog Registration node DB 表
Step 3: 实现 Registration node discovery / manifest
Step 4: 实现 CatalogRegistration 接收
Step 5: 实现 well-known + manifest fetcher
Step 6: 实现 manifest validation
Step 7: 实现 DNS/HTTPS verification challenge
Step 8: 实现 CatalogProfileSnapshot builder
Step 9: 实现 CatalogIndexEntry builder
Step 10: 实现 CatalogSearch
Step 11: 用现有 apps/examples/commerce-catalog-api 注册为第一个 demo Catalog
Step 12: 新增 validate-Registration node 脚本
```

## 20. 最终原则

OCP Catalog Registration node 发现和索引的是 Catalog，不是 Provider，也不是所有商业对象。

Catalog 自己负责对象索引和查询能力实现。

OCP Catalog Registration node 负责让用户和 Agent 找到“应该问哪个 Catalog”，并提供可信、可解释、可缓存的 route hint。

Provider 的对象同步仍发生在具体 Catalog 内部，而不是默认发生在 OCP Catalog Registration node。

在当前仓库里，这意味着：

- Registration node 搜索的是 commerce catalog 这种“节点能力”
- Catalog 内部才真正承载商品对象、价格、库存、排序和 resolve
- 用户侧 agent 先决定“用哪个 catalog”，再决定“该 catalog 里的哪个商品更合适”
