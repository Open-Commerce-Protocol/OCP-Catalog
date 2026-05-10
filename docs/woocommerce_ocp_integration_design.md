# WooCommerce OCP Integration Design

> 本文档是 WooCommerce 接入 OCP Catalog / agentic commerce 的设计说明，不表示当前仓库已经内置 WooCommerce 插件。

## 1. 背景与目标

WooCommerce 商家已经在自己的 WordPress / WooCommerce 后台维护商品、变体、价格、库存、配送、优惠、支付方式和订单。OCP 集成的目标不是替代 WooCommerce，而是让这些商家能力可以被 OCP Catalog 和可信 agentic commerce 系统发现、理解、搜索和安全地进入下单流程。

目标能力包括：

- 让 WooCommerce 店铺可以作为 OCP Provider 向一个或多个 Catalog 同步商品对象。
- 让小型商家也可以选择由插件直接暴露一个 merchant-hosted OCP Catalog 入口。
- 将 WooCommerce Product、Variation、Category、Tag、Price、Stock、Shipping Class、Order 映射到 OCP 的商业对象、可购买选项、订单资源和事件。
- 让 agent 通过 OCP 的 discovery / query / resolve / checkout / order 状态接口工作，而不需要理解 WooCommerce 私有 REST API。
- 保持支付信任边界清晰：WooCommerce 插件不实现 Visa VIC、agent 身份认证或卡凭据托管。

## 2. 总架构判断

最合理的长期结构不是“WooCommerce 插件直接集成 Visa”，而是三层：

```text
Agent Layer
  Visa VIC Reference Agent
  User intent / consent / payment instruction

Protocol Layer
  OCP Catalog
  Discovery / query / resolve / checkout / order / event contracts

Merchant Layer
  WooCommerce OCP Plugin
  Product / offer / order / webhook adapter
```

这样 WooCommerce 插件只负责商家侧适配，Visa reference agent 只负责可信购买代理和支付授权，OCP Catalog 负责中间协议。以后接入 Shopify、Magento、自研商城或非 Visa 支付信任层时，不需要重写商家插件和 agent 的核心边界。

## 3. 系统边界

### 3.1 WooCommerce 插件负责什么

WooCommerce OCP Plugin 是商家系统适配器，负责：

- 商品、分类、标签、属性、变体和库存的读取与映射。
- 商品对象同步到目标 OCP Catalog，或在 merchant-hosted 模式下直接暴露 Catalog 能力。
- 暴露 OCP discovery document，例如 `/.well-known/ocp-catalog`；如需兼容更宽泛入口，可额外提供 `/.well-known/ocp` 并指向具体 OCP role。
- 暴露搜索、resolve、checkout session、order status 等 OCP-facing endpoint。
- 监听 WooCommerce webhooks，将商品、库存、订单变化写入 OCP Event Ledger 或同步队列。
- 维护商家 API key、webhook secret、同步游标、重试状态和审计日志。

### 3.2 WooCommerce 插件不负责什么

插件不应该变成 agent runtime，也不应该承担支付信任层：

- 不直接验证 Visa agent 身份。
- 不直接实现 Visa Intelligent Commerce 的用户认证、Payment Instruction 或 agent-specific token 生命周期。
- 不存储用户 card credential。
- 不替代 WooCommerce 的订单、税费、履约、退款、邮件通知和售后工作流。
- 不把 Registration node 当成商品数据库；Registration node 只帮助 agent 找到合适 Catalog。

## 4. 推荐部署形态

### 4.1 Provider Adapter 模式（推荐默认）

```text
WooCommerce Store
-> WooCommerce OCP Plugin
-> ProviderRegistration
-> Object Sync
-> OCP Commerce Catalog
-> Registration node
-> Agent query / resolve
```

插件把 WooCommerce 店铺变成 OCP Provider。目标 Commerce Catalog 负责索引、排序、查询、resolve 和对 Registration node 的注册。这个模式最符合当前 OCP 角色边界，适合多商家、多平台聚合。

### 4.2 Merchant-hosted Catalog 模式（可选）

```text
WooCommerce Store
-> WooCommerce OCP Plugin exposes CatalogManifest / query / resolve
-> Registration node indexes this merchant Catalog
-> Agent calls merchant Catalog directly
```

单店铺可以直接暴露一个轻量 Catalog。此时插件同时扮演 Provider adapter 和 Catalog node，但仍然不能越界到 Visa 或 agent runtime。这个模式适合独立商家快速接入，但多商家聚合、搜索质量、风控和缓存会更难治理。

## 5. OCP 数据模型映射

| WooCommerce 概念 | OCP 映射 | 说明 |
| --- | --- | --- |
| Store | Provider / Merchant Profile | `provider_id` 应稳定，不随站点域名短期变化而变化。 |
| Product | `CommercialObject` / Catalog item | 商品标题、描述、品牌、图片、URL、状态进入 product descriptor pack。 |
| Simple Product | Single purchasable Offer | 可直接购买的 SKU。 |
| Variable Product | Product family | 父商品表达商品组，Variation 表达实际可购买 SKU。 |
| Variation | Offer / purchasable SKU | 颜色、尺码、规格、SKU、价格、库存和图片应落到可购买选项。 |
| Category / Tag | Taxonomy descriptor | 用于搜索过滤、商品理解和分类展示。 |
| Attribute / Attribute Term | Product option descriptor | 既可用于展示，也可用于 variant matching。 |
| Regular / Sale Price | Price descriptor | 建议保留币种、当前价、原价、促销有效期。 |
| Stock Status / Quantity / Backorders | Inventory descriptor | 用于 agent 判断是否可购买、是否需要替代品。 |
| Shipping Class / Zone hints | Fulfillment constraint | 不应在 Catalog 内完整复制配送引擎，但应暴露配送约束摘要。 |
| Cart | Checkout session | Cart 是执行态，不是 CatalogEntry。 |
| Order | OCP order resource | 映射订单号、状态、金额、履约状态、可执行动作。 |
| WooCommerce webhook | EventLedger event | 商品/库存/订单变化进入同步与审计流。 |

## 6. 对外协议面

### 6.1 Discovery

Merchant-hosted Catalog 模式至少暴露：

```text
GET /.well-known/ocp-catalog
GET /ocp/catalog
```

`/.well-known/ocp-catalog` 返回最小 discovery document，指向 Catalog manifest、query endpoint、resolve endpoint 和可选 checkout endpoint。`/ocp/catalog` 返回更完整的商家 Catalog profile、支持的 query packs、对象类型、action bindings 和政策摘要。

Provider Adapter 模式下，插件不一定需要对公网暴露 Catalog query endpoint，但仍应能读取目标 CatalogManifest，并提交 `ProviderRegistration` 和 Object Sync。

### 6.2 Query / Resolve

推荐暴露：

```text
POST /ocp/search
POST /ocp/resolve
```

如果实现要与当前 OCP wire naming 保持一致，也可以将 `POST /ocp/search` 作为 `POST /ocp/query` 的 commerce-friendly alias。关键是不要让 agent 直接依赖 WooCommerce `/wp-json/wc/v3/products` 的私有形状。

Search 返回轻量商品结果：

```json
{
  "kind": "CatalogQueryResult",
  "catalog_id": "woo_acme_catalog",
  "items": [
    {
      "entry_id": "centry_woo_123_456",
      "object_type": "product",
      "title": "Merino Wool Runner - Navy",
      "summary": "Lightweight everyday shoe",
      "attributes": {
        "brand": "Acme",
        "amount": 89,
        "currency": "USD",
        "availability_status": "in_stock",
        "primary_image_url": "https://store.example/wp-content/uploads/shoe.jpg"
      }
    }
  ]
}
```

Resolve 返回权威详情和下一步动作：

```json
{
  "kind": "ResolvableReference",
  "entry_id": "centry_woo_123_456",
  "object_id": "woocommerce://store.example/products/123/variations/456",
  "title": "Merino Wool Runner - Navy",
  "visible_attributes": {
    "sku": "MWR-NAVY-10",
    "amount": 89,
    "currency": "USD",
    "availability_status": "in_stock"
  },
  "action_bindings": [
    {
      "action_id": "view_product",
      "action_type": "url",
      "url": "https://store.example/product/merino-wool-runner/?attribute_size=10"
    },
    {
      "action_id": "create_checkout",
      "action_type": "api",
      "url": "https://store.example/ocp/checkout/create",
      "method": "POST"
    }
  ]
}
```

### 6.3 Checkout / Order

推荐最小执行接口：

```text
POST /ocp/checkout/create
GET /ocp/orders/{id}
POST /ocp/orders/{id}/actions
```

`checkout/create` 接收经过用户确认的购买意图、商品行项目、配送选项和外部支付信任上下文。它可以创建 WooCommerce pending order 或 checkout session，但不应该让 agent 提供原始卡号。

示例：

```json
{
  "kind": "OcpCheckoutCreateRequest",
  "catalog_id": "woo_acme_catalog",
  "merchant_id": "woo_store_acme",
  "items": [
    {
      "entry_id": "centry_woo_123_456",
      "quantity": 1,
      "selected_options": {
        "size": "10",
        "color": "navy"
      }
    }
  ],
  "constraints": {
    "max_total_amount": 100,
    "currency": "USD",
    "ship_to_country": "US",
    "expires_at": "2026-05-10T12:00:00.000Z"
  },
  "payment_context": {
    "type": "external_authorized_instruction",
    "provider": "visa_vic",
    "instruction_id": "pi_123"
  }
}
```

### 6.4 WebMCP / REST 工具

如果店铺前端希望让浏览器页面直接暴露 agent 工具，可以额外提供 WebMCP tools：

- `ocp_catalog_search`
- `ocp_checkout_create`
- `ocp_order_status`
- `ocp_order_action`

这些工具应该只是 OCP endpoint 的页面代理，不应把 WooCommerce 内部 admin API 暴露给页面 agent。

## 7. 状态流

```text
Catalog Sync
-> Discovery
-> Search
-> Resolve
-> Checkout Intent
-> User / Payment Instruction Confirmed
-> Order Created
-> Payment Pending / Paid / Failed
-> Fulfillment
-> Completed / Cancelled / Refunded
```

关键约束：

- Search / Resolve 是发现层。
- Checkout / Order 是执行层。
- Payment Instruction 属于 agent / payment trust layer。
- WooCommerce 仍然是订单和履约的权威状态机。

## 8. 同步与事件

WooCommerce 官方 REST API v3 是当前推荐的新集成入口，使用 `/wp-json/wc/v3/` 路径，并提供 products、variations、categories、tags、shipping classes、orders、refunds、payment gateways 等资源。插件应优先复用 WooCommerce 数据模型和 hooks，而不是直接读取数据库表。

同步策略：

- 首次安装后执行全量商品同步。
- 商品、变体、价格、库存、图片、分类变更时增量同步。
- 商品下架时将对象标记为 inactive 或 tombstone，而不是静默删除。
- 订单创建、支付、取消、退款、履约变化写入 Event Ledger。
- 同步失败进入重试队列，超过阈值后提示商家修复授权或数据问题。

WooCommerce webhooks 可以在订单、商品、优惠券、客户等对象新增、更新、删除或购买发生时触发，并支持 secret 生成请求签名。插件应使用 webhook signature 校验和幂等事件 ID 防止重复处理。

## 9. 安全与权限

最小安全要求：

- 商家安装插件时生成或录入 OCP provider credential。
- Catalog sync API 使用签名请求或短期 token。
- WooCommerce REST API key 只授予插件所需最小权限。
- Webhook 使用 secret 签名，事件处理必须幂等。
- Agent allowlist / policy 只控制 agent 能否使用 OCP checkout，不应泄漏 WooCommerce admin 权限。
- PII 最小化：Search 不返回收货地址、邮箱、电话；Resolve 只返回完成用户任务所需字段。
- Checkout 前必须重新验证价格、库存、税费和配送约束。
- 所有 agent-initiated checkout、order action、退款或取消请求进入 audit log。

## 10. 风险与异常

- Catalog 中的价格或库存可能过期，checkout 前必须重新计算。
- 变体选择可能不完整，例如用户只说“黑色鞋子”但没有尺码。
- WooCommerce 插件生态复杂，其他插件可能改变价格、税费、库存或 checkout 字段。
- 多币种、多仓、多配送区域会使 Catalog 摘要与最终 checkout 存在差异。
- Agent 可能选择错误商品或误解用户约束，必须有用户确认和可审计指令。
- 支付授权失败时，应保留 pending order 的可恢复路径或自动取消策略。

## 11. 非目标

- 不实现 Visa 支付认证。
- 不直接存储 card credential。
- 不把 WooCommerce 插件做成通用 agent runtime。
- 不把 OCP Catalog 做成 WooCommerce admin 的替代品。
- 不要求所有 WooCommerce 店铺暴露完全相同的商品字段；差异通过 descriptor packs 和 query capability 声明。

## 12. 实施阶段

### Phase 1：只读商品发现

- 插件读取 WooCommerce products、variations、categories、tags、prices、stock。
- 映射为 `CommercialObject` 并同步到目标 Catalog。
- 支持 query / resolve / view_product。

### Phase 2：可购买动作

- Resolve 返回 `create_checkout` action binding。
- 插件实现 checkout session / pending order 创建。
- Checkout 前重新校验价格、库存、配送与税费。

### Phase 3：订单状态与事件

- 实现 `GET /ocp/orders/{id}`。
- 商品、库存、订单、退款通过 webhook 同步到 Event Ledger。
- Agent 可以查询订单状态，但敏感动作需要用户授权。

### Phase 4：支付信任层组合

- 与 Visa VIC reference agent 或其他支付信任层组合。
- Checkout 请求只接收受限 payment instruction / token context。
- WooCommerce 继续通过自身 payment gateway 或外部 PSP 完成真实支付处理。

## References

- OCP Catalog Registration Protocol: `docs/ocp_catalog_registration_protocol_v1.md`
- OCP Catalog Handshake Protocol: `docs/ocp_catalog_handshake_protocol_v1.md`
- Shopify Provider 示例: `apps/ocp-protocol-docs-web/src/content/locales/zh/examples/shopify-provider.md`
- WooCommerce REST API v3: https://developer.woocommerce.com/docs/apis/rest-api/v3/
- WooCommerce Webhooks: https://woocommerce.com/document/webhooks/
