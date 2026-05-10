# Visa VIC Reference Agent + OCP Catalog Design

> 本文档描述一个 reference agent 如何结合 Visa Intelligent Commerce 与 OCP Catalog 完成可信 agentic checkout。它是架构设计说明，不表示当前仓库已经实现 Visa 集成。

## 1. 背景与目标

Visa Intelligent Commerce（VIC）的核心定位是为 agentic commerce 提供支付信任能力：为 agent 提供 agent-specific payment token，并确保 agent 的购买行为、支付凭证请求和授权结果符合用户已认证的指令。Visa 还提供 Remote Model Context Protocol（MCP）Server，用作应用与 VIC APIs、Visa Token Service（VTS）和 Visa Developer Platform（VDP）服务之间的桥接层。

OCP Catalog 的职责不同。OCP 负责让 agent 找到合适的 Catalog、查询商品或商业对象、resolve 选中对象，并获得下一步动作入口。它不应该变成支付认证网络，也不应该直接替代 Visa 的 token、authentication、Payment Instruction 和 transaction control 能力。

Reference Agent 的目标是证明：

- 用户可以用自然语言表达购买意图。
- Agent 可以通过 OCP Catalog 发现和比较商家商品。
- Agent 在下单前必须请求用户确认具体约束。
- 用户确认后，agent 获得受限 Payment Instruction，而不是拿到用户卡号。
- VIC / VTS / Visa MCP Server 提供支付信任与凭证能力。
- Agent 使用 OCP checkout 与商家完成订单创建，并回传订单状态。

## 2. 总架构判断

正确的边界是三层：

```text
Agent Layer
  Visa VIC Reference Agent
  User intent / consent / payment instruction

Protocol Layer
  OCP Catalog
  Search / resolve / checkout / order / event contracts

Merchant Layer
  WooCommerce, Shopify, Magento, custom commerce systems
  Product / offer / order / webhook adapters
```

Reference Agent 不依赖 WooCommerce。它依赖 OCP 的协议能力。WooCommerce、Shopify、Magento 或自研商城只要能通过 OCP 暴露商品、checkout 和订单状态，就可以被同一个 reference agent 使用。

## 3. 系统边界

### 3.1 Reference Agent 负责什么

Reference Agent 是购买代理和支付信任编排层，负责：

- 理解用户购买意图和约束。
- 查询 OCP Catalog Registration node 或本地 Catalog cache。
- 调用目标 Catalog 的 query / resolve。
- 向用户展示候选商品、价格、库存、配送和不确定点。
- 请求用户确认购买约束。
- 生成或提交 Payment Instruction 请求。
- 调用 Visa MCP Server / VIC / VTS 能力获取受限支付上下文。
- 使用 OCP checkout 创建商家订单。
- 查询订单状态并回传给用户。
- 把关键动作写入 audit / event ledger。

### 3.2 Reference Agent 不负责什么

Reference Agent 不应该：

- 自己托管商家的商品数据库。
- 伪造商品价格、库存或配送承诺。
- 在没有用户确认的情况下创建支付指令。
- 获取或保存用户原始卡号。
- 直接修改 WooCommerce / Shopify / Magento 私有订单表。
- 绕过 OCP resolve / checkout，直接构造商家内部 API 请求。

## 4. 关键角色

- **User**：表达购买意图，确认约束，认证 Payment Instruction。
- **Reference Agent**：负责搜索、比较、解释、请求确认和编排 checkout。
- **OCP Catalog Registration Node**：帮助 agent 找到合适 Catalog；不存储全量商品。
- **OCP Catalog Merchant / Catalog Node**：负责商品查询、resolve、checkout action 和订单状态。
- **Visa VIC**：提供 agent-specific token、Payment Instruction、transaction controls 和 commerce signals。
- **Visa MCP Server**：把应用或 agent workflow 接到 VIC / VTS / VDP 能力。
- **Payment Token / Instruction Service**：给 agent 返回受限、可验证的支付上下文。
- **Audit / Event Ledger**：记录用户指令、agent 决策、支付授权、checkout 和订单结果。

## 5. 主流程

```text
User intent
-> Agent searches OCP Catalog Registration node or local Catalog cache
-> Agent selects target Catalog
-> Agent queries OCP Catalog
-> Agent resolves candidate products
-> Agent presents options and uncertainty to User
-> User confirms product, merchant, amount, delivery, expiry and substitution policy
-> Agent requests authenticated Payment Instruction
-> VIC validates agent / user / payment context
-> Agent retrieves constrained payment credential or authorization context
-> Agent creates checkout with OCP merchant endpoint
-> Merchant creates order and returns status
-> Agent reports result to User
-> Agent submits commerce signals / audit events
```

## 6. 用户授权模型

Reference Agent 必须把自然语言意图转成明确、可审计、可拒绝的授权约束。至少包括：

| 约束 | 示例 | 设计要求 |
| --- | --- | --- |
| Max amount | `max_total_amount = 120 USD` | 包含商品、税费、配送费和可接受浮动。 |
| Merchant scope | `merchant_id in ["woo_acme"]` | 不允许 agent 换到未确认商家。 |
| Product scope | `entry_id = centry_123` 或 `category = running_shoes` | 精确商品和宽泛类别要区分。 |
| Quantity | `quantity = 1` | 超出数量必须重新确认。 |
| Delivery constraints | `ship_to_country = US`, `arrive_before` | 配送地址和时间约束不得隐式扩大。 |
| Expiry time | `expires_at` | 过期后必须重新认证。 |
| One-time vs reusable | `usage = one_time` | 默认一次性；复用必须显式确认。 |
| Substitution policy | `no_substitution` / `same_brand_only` | 缺货替代不能由 agent 自行扩大。 |
| Cancellation policy | `cancel_if_price_changes` | 价格、库存或配送变化时的行为必须明确。 |

Payment Instruction 应该是结构化对象，而不是自由文本：

```json
{
  "kind": "PaymentInstruction",
  "instruction_id": "pi_123",
  "user_id": "user_abc",
  "agent_id": "visa_reference_agent",
  "merchant_scope": ["merchant_woo_acme"],
  "product_scope": [
    {
      "catalog_id": "commerce_catalog_public",
      "entry_id": "centry_woo_123_456",
      "quantity": 1
    }
  ],
  "constraints": {
    "max_total_amount": 120,
    "currency": "USD",
    "expires_at": "2026-05-10T12:00:00.000Z",
    "substitution_policy": "no_substitution"
  },
  "authentication": {
    "method": "passkey",
    "status": "authenticated"
  }
}
```

## 7. 支付与信任模型

不要把模型写成“agent 拿用户卡去买”。正确模型是：

```text
User authenticates instruction
-> Agent receives constrained payment instruction context
-> VIC / VTS provides agent-specific token or payment credential context
-> Merchant receives verifiable payment / authorization result
-> Visa controls validate merchant, amount and instruction alignment
-> Every action is auditable
```

Visa 官方说明中，VIC 提供 agent-specific payment token provisioning、用户认证、Payment Instructions、controls 和 commerce signals；Payment Instruction 用于确保支付凭证请求匹配用户已认证指令，并让 VisaNet 授权与原始指令保持一致。Reference Agent 应只持有受限指令和 token context，而不是底层 card credential。

Trusted Agent Protocol 进一步解决 merchant visibility 问题：让商家能区分可信 agent 与恶意 bot，并通过面向商家、用途和时间绑定的签名提高透明度和安全性。OCP checkout 可以把这种 trusted-agent context 作为商家可验证的请求上下文之一。

## 8. 与 OCP 的接口

Reference Agent 应依赖 OCP 抽象，而不是依赖某个商家平台：

- `ocp_catalog_search`
- `ocp_catalog_resolve`
- `ocp_checkout_create`
- `ocp_order_status`
- `ocp_order_action`

如果 agent 通过 MCP 访问 OCP Catalog，则底层可以映射为：

- `search_catalogs`：先找应该使用哪个 Catalog。
- `inspect_catalog`：读取 Catalog 支持的 query packs、约束和能力。
- `query_catalog`：在选定 Catalog 中检索商品或商业对象。
- `resolve_catalog_entry`：解析候选结果，获取详情和 action bindings。
- `find_and_query_catalog`：用于普通购物意图的快捷组合入口，但不能替代 checkout 前的 resolve 和用户确认。

Checkout 请求应引用 OCP resolve 得到的 entry / action，而不是让 agent 自己拼商家 URL：

```json
{
  "kind": "OcpCheckoutCreateRequest",
  "catalog_id": "commerce_catalog_public",
  "entry_refs": [
    {
      "entry_id": "centry_woo_123_456",
      "quantity": 1,
      "resolved_action_id": "create_checkout"
    }
  ],
  "user_confirmed_constraints": {
    "max_total_amount": 120,
    "currency": "USD",
    "expires_at": "2026-05-10T12:00:00.000Z"
  },
  "payment_context": {
    "provider": "visa_vic",
    "instruction_id": "pi_123",
    "agent_token_reference": "agt_tok_ref_456"
  },
  "audit_context": {
    "agent_id": "visa_reference_agent",
    "conversation_id": "conv_789",
    "user_confirmation_event_id": "evt_confirm_001"
  }
}
```

## 9. 状态机

```text
IntentCaptured
-> CatalogSelected
-> CandidatesPresented
-> UserConfirmed
-> PaymentInstructionAuthenticated
-> PaymentContextRetrieved
-> CheckoutCreated
-> MerchantOrderPendingPayment
-> Paid
-> FulfillmentPending
-> Fulfilled
```

失败或分支状态：

```text
UserRejected
InstructionExpired
VICRejected
CatalogResultStale
PriceChanged
OutOfStock
CheckoutFailed
PaymentFailed
Cancelled
RefundRequested
Refunded
```

## 10. Audit / Event Ledger

每个关键动作都应记录事件：

- 用户原始意图摘要。
- Catalog search / query / resolve 请求和结果摘要。
- Agent 推荐给用户的候选商品。
- 用户确认的完整约束。
- Payment Instruction 认证结果。
- VIC / VTS 返回的 token reference 或 authorization context reference。
- Checkout create 请求和商家响应。
- Order status 更新。
- 异常、取消、退款或争议处理事件。

Ledger 中不应存储完整卡号、敏感认证材料或超过业务需要的 PII。对外展示时应使用引用 ID 和最小可解释摘要。

## 11. 风险与异常处理

### 11.1 Agent hallucination

Agent 不能凭空承诺商品、价格、配送或售后。所有可购买信息必须来自 Catalog query / resolve 或商家 checkout 重新计算。

### 11.2 商品信息过期

Search 结果只是候选摘要。Checkout 前必须调用 resolve 或 merchant validation 重新确认价格、库存、税费和配送。

### 11.3 价格变化

如果最终总价超过用户授权的 `max_total_amount` 或浮动范围，必须停止并重新请求用户确认。

### 11.4 库存变化

缺货时必须遵守 substitution policy。默认不允许 agent 自行替代。

### 11.5 用户授权过期

Payment Instruction 过期后不能复用。Agent 应回到确认流程。

### 11.6 VIC 拒绝授权

Agent 应向用户解释授权失败的高层原因，并提供重新认证或更改约束的路径；不应降级为让 agent 直接收集卡号。

### 11.7 Merchant checkout 失败

Agent 应保留 checkout failure event，向用户说明是否已创建 pending order、是否扣款、是否需要人工处理。

### 11.8 Refund / cancellation

取消和退款应作为 OCP order action 暴露，由商家订单系统和支付网络执行。Agent 只能在用户授权范围内发起动作。

## 12. 非目标

- Reference Agent 不实现 WooCommerce 插件。
- Reference Agent 不成为商家商品数据库。
- OCP Catalog 不实现 Visa tokenization。
- Visa VIC 不负责 OCP Catalog 的商品索引或 query ranking。
- Agent 不持有或存储用户原始卡凭据。
- `find_and_query_catalog` 不能被当成“自动购买”工具；购买必须经过 resolve、用户确认和 Payment Instruction。

## 13. 实施阶段

### Phase 1：只读购物助手

- Agent 使用 OCP search / query / resolve 找商品。
- 展示候选结果和不确定点。
- 不创建订单，不请求支付。

### Phase 2：受限 checkout intent

- Agent 让用户确认商品、商家、金额、配送和过期时间。
- 生成结构化 Payment Instruction draft。
- 不实际支付。

### Phase 3：VIC sandbox 集成

- Agent 通过 Visa MCP Server 调用 VIC sandbox 能力。
- 获取受限 payment credential reference。
- 调用 OCP checkout 创建 pending order。

### Phase 4：订单状态与审计闭环

- Agent 查询 `ocp_order_status`。
- 提交 commerce signals / audit events。
- 支持取消、退款、异常恢复路径。

## 14. References

- Visa Intelligent Commerce overview: https://developer.visa.com/capabilities/visa-intelligent-commerce/overview
- Visa Trusted Agent Protocol overview: https://developer.visa.com/capabilities/trusted-agent-protocol/overview
- OCP Catalog Registration Protocol: `docs/ocp_catalog_registration_protocol_v1.md`
- OCP Catalog Handshake Protocol: `docs/ocp_catalog_handshake_protocol_v1.md`
