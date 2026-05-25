# Shopify OCP Catalog Integration Design

## 1. 背景与目标

Shopify 2026 年推出的 [Shopify Catalog](https://shopify.dev/docs/agents/catalog) 给 AI agent 提供了两种入口：

- **Global Catalog**：跨所有 Shopify 商家的统一商品库，端点 `https://catalog.shopify.com/api/ucp/mcp`
- **Storefront Catalog**：单店铺级别的入口，端点 `https://{storeDomain}/api/ucp/mcp`

两者都基于 Model Context Protocol（MCP）over HTTP（JSON-RPC 2.0 信封），并自称实现 "UCP Catalog capability standard"，与 OCP Catalog 的设计目标高度重叠。

本集成的目标是把 Shopify Catalog 作为一种"上游商品源"接入 OCP Catalog 生态，**不本地落库、不预同步**，对外完整暴露 OCP Catalog 协议（`/ocp/manifest` / `/ocp/query` / `/ocp/resolve` / 等），内部把请求实时翻译给 Shopify 的 MCP 端点，再把返回结构 mapper 成 OCP CommercialObject / ResolvableReference。

定位是一个 **realtime proxy 型 Catalog Node**，参照已合并的 `apps/examples/alimama-catalog-api/`（"Real-time affiliate catalog backed by Alimama/Taobao Union APIs"）。

非目标：

- **不**实现 Provider 注册/同步流程（manifest 中故意省略）
- **不**承担 Visa VIC 或 agent 身份信任
- **不**做 Shopify 后端 admin 操作（订单、库存写入等）

---

## 2. Shopify Catalog 协议关键事实

### 2.1 端点与协议层

| 维度 | Global Catalog | Storefront Catalog |
|---|---|---|
| 端点 | `https://catalog.shopify.com/api/ucp/mcp` | `https://{storeDomain}/api/ucp/mcp` |
| 传输 | HTTP + JSON-RPC 2.0（MCP） | 同左 |
| 工具 | `search_catalog`, `lookup_catalog`, `get_product` | 同左 |
| 覆盖范围 | 全 Shopify 商家 | 单店铺 |
| Filter 支持 | `ships_to`, `available` | 几乎没有（仅 `query`） |
| Lookup 上限 | 50 IDs | 10 IDs |
| 分页 | 文档未说明 | `pagination.{cursor, has_next_page, total_count}` |
| ID 格式 | `gid://shopify/p/{upid}`、`gid://shopify/ProductVariant/{id}` | `gid://shopify/Product/{id}`、`gid://shopify/ProductVariant/{id}` |
| 鉴权 | Agent profile（well-known URL，无需 API key 可基础调用，trust tier 决定能力） | 同左 |

### 2.2 MCP 三件套的 I/O 形状

**search_catalog** 请求：
```json
{ "catalog": { "query": "organic cotton sweater",
               "filters": { "ships_to": {"country":"US"}, "available": true } } }
```

**lookup_catalog**（按 ID 批量取）请求：
```json
{ "catalog": { "ids": ["gid://shopify/p/7f3a2b8c1d9e", ...],
               "context": {"address_country":"US"} } }
```

**get_product**（单品 + 变体选择）请求：
```json
{ "catalog": { "id": "gid://shopify/p/7f3a2b8c1d9e",
               "selected": [{"name":"Color","label":"Black"}],
               "preferences": ["Color","Size"] } }
```

**统一响应信封**（JSON-RPC 2.0）：
```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "structuredContent": {
      "ucp": {
        "version": "2026-04-08",
        "capabilities": {
          "dev.ucp.shopping.catalog.search": [{"version":"2026-04-08"}],
          "dev.shopify.catalog.global":      [{"version":"2026-04-08"}]
        }
      },
      "products": [ /* Product 数组 */ ],
      "pagination": { "cursor":"...", "has_next_page":true, "total_count":123 }  // 仅 storefront
    }
  }
}
```

### 2.3 Product / Variant 字段（关键映射依据）

```jsonc
{
  "id": "gid://shopify/p/{upid}",
  "title": "string",
  "description": { "html": "string" },          // get_product 可能返 {plain}
  "url": "string",
  "categories": [{"value":"string","taxonomy":"string"}],
  "price_range": {
    "min": {"amount": <int>, "currency":"USD"},
    "max": {"amount": <int>, "currency":"USD"}
  },
  "media": [{"type":"image","url":"...","alt_text":"..."}],
  "options": [{"name":"Color","values":[{"label":"Black"}]}],
  "variants": [{
    "id": "gid://shopify/ProductVariant/{id}",
    "sku":"...","title":"...",
    "price": {"amount":<int>,"currency":"USD"},
    "checkout_url": "string",                    // ★ 这是 OCP resolve action 的核心来源
    "condition": ["new"|"secondhand"],
    "eligible": {"native_checkout": true},
    "availability": {"available":true,"status":"in_stock","running_low":false},
    "requires": {"shipping":true,"selling_plan":false,"components":false},
    "options": [{"name":"Color","label":"Black"}],
    "tags": ["..."],
    "seller": {"name":"...","id":"gid://shopify/Shop/{id}","domain":"...","url":"...","links":[...]}
  }],
  "rating": {"value":4.6,"scale_max":5,"count":120}
}
```

**重要观察**：

1. 价格用整数 `amount`（推测是 minor units，例如美分），需要保留并在 mapper 内换算或加 note 字段。
2. `variants[].checkout_url` 直接给出可结账 URL — 这是把 `ResolvableReference.action_bindings[].entrypoint.url` 接出来的最关键字段。
3. `variants[].eligible.native_checkout` 标识是否能由 Shopify 自身完成 checkout（高 trust tier agent 才能直接走 native checkout MCP；OCP-Catalog 暴露层无需关心这一区别，仅记录在 attributes 里）。
4. `seller` 字段在 Global 模式才有意义 — 标识对应的 Shopify 商家。

### 2.4 鉴权模型

- Shopify 通过"Agent profile"识别调用方。Profile 是托管在 well-known URL 的 JSON 文档，每次 UCP 请求里通过 meta 引用它。
- Catalog 工具属于最低 trust tier，"keyless"即可访问（受较低限速）。
- 申请 API key 可提速率。提速途径仅对 authenticated profile 开放。
- Cart MCP / Checkout MCP（**非本次接入范围**）需要更高 trust tier。

### 2.5 限速与缓存

- 官方文档没有明确数字。"Keyless catalog access doesn't support rate limit increases"。
- 实践假设：免费层每分钟数十次量级；生产部署需要在 OCP Catalog Node 内增加请求缓存或本地短期 cache（per query 哈希 5–60 秒 TTL），并支持限速回压。

---

## 3. OCP Catalog ↔ Shopify 翻译规则

### 3.1 协议映射总览

| OCP 端点 | OCP 动作 | Shopify 对应工具 | 是否单次 RPC |
|---|---|---|---|
| `GET /.well-known/ocp-catalog` | discovery | —（本地生成） | — |
| `GET /ocp/manifest` | 能力声明 | —（本地生成） | — |
| `GET /ocp/health` | 健康 | 探活：`search_catalog{query:""}` | 是 |
| `GET /ocp/contracts` | 对象契约 | —（本地静态） | — |
| `POST /ocp/query` | 关键词/过滤搜索 | `search_catalog` | 1:1 |
| `POST /ocp/resolve` | 详情 + action | `get_product` + 选择 variant | 1:1（必要时 1:2，先 search 后 get） |

### 3.2 Query 映射

| OCP `CatalogQueryRequest` 字段 | 处理方式 | Shopify `search_catalog.catalog` |
|---|---|---|
| `query` (≤500 字符) | passthrough | `query` |
| `filters.in_stock_only` | 翻为 `available:true` | `filters.available` |
| `filters.category` | Shopify 不接受任意 category 过滤，落入 `policy_summary.rejected_filters` + warning | — |
| `filters.brand` | 同上，rejected | — |
| `filters.currency` | Storefront 单店铺隐含；Global 可写入 `context.address_country` 间接表达 | — |
| `filters.min_amount` / `max_amount` | Shopify 不支持，rejected + warning | — |
| `filters.sku` | 走 `lookup_catalog`（不同分支） | — |
| `limit` | OCP `1..50` → Shopify 默认（约 10） | 仅 storefront：用 `pagination.cursor` 反向推导 |
| `offset` | Storefront 用 cursor；Global 文档未提供；先实现"仅首页"，再考虑游标 ↔ offset 桥接 | — |
| `explain` | 写入 OCP 返回 `explain[]` | — |

**反方向（Shopify product → OCP `CatalogEntryMatch`）**：

```ts
catalogEntryMatch = {
  entry: {
    kind: 'CatalogEntry',
    catalog_id: catalogId,
    entry_id: `entry_shopify_${global ? 'global' : storeDomain}_${productUpid}`,
    provider_id: 'shopify_global' | `shopify_storefront_${storeDomain}`,
    object_id: stripGid(product.id),     // 'p/7f3a...'
    object_type: 'product',
    title: product.title,
    summary: htmlToPlainText(product.description.html).slice(0, 200),
    attributes: {
      ...productCoreV1(product),
      price: priceV1(product.price_range),
      inventory: inventoryV1(product.variants),
      media: product.media,
      rating: product.rating,
      categories: product.categories,
      source_id: 'shopify_global' | 'shopify_storefront',
      source_object_id: product.id,
      variant_count: product.variants.length,
      has_native_checkout: product.variants.some(v => v.eligible?.native_checkout),
    },
  },
  score: 1.0,                           // Shopify 未提供 score；用相对位置或固定 1.0
  explain: ['Mapped from Shopify search_catalog response.'],
};
```

### 3.3 Resolve 映射

OCP `ResolveRequest{ entry_id }` →

1. 从 `entry_id` 反解 product UPID
2. 调 Shopify `get_product` 取完整 variants（如请求里带 `selected`/`preferences`，可在 Resolve 输入里通过 OCP `context` 传入并透传给 Shopify）
3. 构造 `ResolvableReference`：

```ts
{
  ocp_version: '1.0',
  kind: 'ResolvableReference',
  id: `resolve_${uuid}`,
  catalog_id: cfg.CATALOG_ID,
  entry_id: req.entry_id,
  commercial_object_id: `obj_shopify_${productUpid}`,
  object_id: productUpid,
  object_type: 'product',
  provider_id: 'shopify_global' | `shopify_storefront_${storeDomain}`,
  title: product.title,
  visible_attributes: {
    source_id: ...,
    selected_options: product.selected,
    available_variants: product.variants.length,
    rating: product.rating,
  },
  access: {
    visibility: 'public',
    permission_state: 'granted',
    redacted_fields: [],
    policy_notes: [
      'Shopify checkout URLs may expire or change once inventory state changes.',
      'Higher-trust agents can invoke Shopify checkout MCP directly; this node only exposes URL action bindings.',
    ],
  },
  live_checks: [{
    check_id: 'shopify_variant_availability',
    status: anyAvailable ? 'passed' : 'failed',
    checked_at: now,
    summary: `${product.variants.filter(v=>v.availability?.available).length}/${product.variants.length} variants available`,
  }],
  action_bindings: product.variants
    .filter(v => v.availability?.available && v.checkout_url)
    .map(v => ({
      action_id: `action_${stripGid(v.id)}`,
      action_type: 'url',
      label: v.title || 'Buy on Shopify',
      description: v.sku ? `SKU ${v.sku}` : undefined,
      entrypoint: { url: v.checkout_url, method: 'GET' },
      auth_requirements: {},
      requires_user_confirmation: true,
    })),
  freshness: { resolved_at: now },
  expires_at: nowPlusMinutes(15),
}
```

### 3.4 Pack 选用

复用 OCP 现有标准 packs：

- `ocp.commerce.product.core.v1` ← `title / description / url / categories / media`
- `ocp.commerce.price.v1` ← `price_range`（amount + currency；统一约定 amount 单位）
- `ocp.commerce.inventory.v1` ← `variants[].availability.{available,status,running_low}` 聚合
- 自由扩展 attributes：`rating`、`seller`、`variants_summary`、`has_native_checkout`、`shopify_options`

**暂不**新增 OCP 标准 pack；本次接入纯做映射层。如未来要把"variant + 多选项"作为 OCP 的一等概念，再单独提 RFC。

### 3.5 Manifest 关键字段

```jsonc
{
  "ocp_version": "1.0",
  "kind": "CatalogManifest",
  "catalog_id": "shopify_global" | "shopify_storefront_<storeDomain>",
  "catalog_name": "Shopify Global Catalog (OCP bridge)",
  "description": "Realtime OCP Catalog Node backed by Shopify Catalog MCP. Does not persist products; forwards search and product detail in real time and surfaces Shopify checkout URLs as OCP action bindings.",
  "registry_visibility": "public",
  "endpoints": { "health":..., "query":..., "resolve":..., "contracts":... },
  "query_capabilities": [{
    "capability_id": "ocp.shopify.product.search.v1",
    "name": "Shopify product search",
    "description": "Search Shopify Global/Storefront catalog in real time.",
    "query_packs": [{
      "pack_id": "ocp.query.keyword.v1",
      "description": "Keyword search against Shopify search_catalog tool.",
      "query_modes": ["keyword","filter"]
    }]
  }],
  // 故意没有 sync_capabilities / provider_registration（与 alimama 一致）
}
```

---

## 4. 实现模块设计

### 4.1 目录结构（参照 `apps/examples/alimama-catalog-api/`）

```
apps/examples/shopify-catalog-api/
├─ package.json                    # 新 workspace 包 @ocp-catalog/shopify-catalog-api
├─ tsconfig.json
├─ README.md
├─ src/
│  ├─ index.ts                     # bun + Elysia 启动入口
│  ├─ app.ts                       # 路由装配
│  ├─ config.ts                    # SHOPIFY_CATALOG_MODE / STORE_DOMAIN / AGENT_PROFILE_URL
│  ├─ shopify/
│  │  ├─ mcp-client.ts             # ★ 包装 @modelcontextprotocol/sdk client transport
│  │  ├─ tool-search.ts            # search_catalog 调用 + 输入校验
│  │  ├─ tool-lookup.ts            # lookup_catalog 调用
│  │  ├─ tool-get-product.ts       # get_product 调用
│  │  ├─ types.ts                  # zod 描述 Shopify product/variant 响应
│  │  └─ types.smoke.ts            # 真实响应快照测试
│  ├─ catalog/
│  │  ├─ manifest.ts               # discovery + manifest builder（参照 alimama）
│  │  ├─ health.ts                 # /ocp/health：探活打 search_catalog{query:""}
│  │  ├─ contracts.ts              # 对象契约：声明用的 pack 列表
│  │  ├─ query-service.ts          # OCP query → Shopify search_catalog → mapper
│  │  └─ resolve-service.ts        # OCP resolve → Shopify get_product → mapper
│  ├─ http/
│  │  └─ admin.ts                  # 可选：/admin/probe-query, /admin/stats
│  └─ mapper/
│     ├─ product-to-object.ts      # Shopify product → OCP CommercialObject (descriptors)
│     ├─ variant-to-action.ts      # variant.checkout_url → ActionBinding
│     ├─ filter-bridge.ts          # OCP filters ↔ Shopify filters + reject/warn 收集
│     └─ price.ts                  # amount minor-unit 换算
└─ tests/
   ├─ query-service.test.ts        # mock MCP client，验证 mapper + policy_summary
   ├─ resolve-service.test.ts
   ├─ mapper.test.ts
   ├─ filter-bridge.test.ts
   └─ fixtures/                    # 录制几条 Shopify MCP 响应 JSON（mock 用）
```

并行：

- `scripts/validate-shopify-mvp.ts` — 端到端：discovery → manifest → contracts → health → keyword query → resolve（参照 `scripts/validate-channel-mvp.ts` 与 `apps/examples/alimama-catalog-api/scripts/validate-*`）
- `package.json` root 加：`"shopify:catalog:api": "bun run --cwd apps/examples/shopify-catalog-api start"`、`"validate:shopify-mvp": "bun scripts/validate-shopify-mvp.ts"`

### 4.2 MCP Client 模型

仓库已用 `@modelcontextprotocol/sdk@^1.29.0`（`apps/ocp-mcp-server/`）。我们作为 client 用同一 SDK，挑选 `StreamableHttpClientTransport`（或等价 fetch transport）。

```ts
// shopify/mcp-client.ts（草案）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHttpClientTransport } from '@modelcontextprotocol/sdk/client/streamable-http.js';

export class ShopifyCatalogClient {
  private client: Client;
  constructor(private cfg: { endpoint: string; agentProfileUrl?: string; apiKey?: string }) {
    const transport = new StreamableHttpClientTransport(new URL(cfg.endpoint), {
      requestInit: {
        headers: {
          ...(cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {}),
          // 'X-Agent-Profile': cfg.agentProfileUrl,   // 实际 header 名待 Shopify 文档确认
        },
      },
    });
    this.client = new Client({ name: 'ocp-catalog-shopify-bridge', version: '0.1.0' }, { capabilities: {} });
    void this.client.connect(transport);
  }

  async search(input: { query: string; filters?: Record<string, unknown> }) {
    return this.client.callTool({ name: 'search_catalog', arguments: { catalog: input } });
  }

  async lookup(ids: string[], context?: Record<string, unknown>) {
    return this.client.callTool({ name: 'lookup_catalog', arguments: { catalog: { ids, context } } });
  }

  async getProduct(id: string, opts?: { selected?: Array<{name:string;label:string}>; preferences?: string[] }) {
    return this.client.callTool({ name: 'get_product', arguments: { catalog: { id, ...opts } } });
  }
}
```

> ⚠️ `X-Agent-Profile` 的实际 header 名 Shopify 文档未明示，需要看 Negotiate-and-Authenticate 子页面 / 跑通 trial 后确认。先用占位实现 + env 变量留口子。

### 4.3 关键运行时 flag（env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `SHOPIFY_CATALOG_MODE` | `global` | `global` \| `storefront` |
| `SHOPIFY_STORE_DOMAIN` | — | `storefront` 模式必填，例如 `mystore.myshopify.com` |
| `SHOPIFY_AGENT_PROFILE_URL` | — | Agent profile 的 well-known URL |
| `SHOPIFY_API_KEY` | — | 可选；为了申请更高速率 |
| `SHOPIFY_CATALOG_PUBLIC_BASE_URL` | `http://localhost:4101` | 自身对外的 base URL，构建 discovery/manifest 用 |
| `SHOPIFY_CATALOG_ID` | `shopify_global_local_dev` | OCP catalog_id |
| `SHOPIFY_CATALOG_PORT` | `4101` | Bun/Elysia 端口（避开 channel `4001`、alimama 默认） |
| `SHOPIFY_CACHE_TTL_MS` | `30000` | 简易内存缓存防过快重复请求 |

---

## 5. 实施阶段

### Phase 0 — 准备（不动代码，0.5 day）

- 申请/准备一个 Shopify dev store 或确认 Global Catalog keyless 可用。
- 准备一份"agent profile" 静态 JSON 文档（用 GitHub Pages 或 docs-web 托管即可），先占位。
- 录两份真实响应（search_catalog + get_product）作 fixture，存到 tests/fixtures/。

### Phase 1 — Skeleton（1 day）

- 复制 alimama 包结构，重命名为 shopify-catalog-api。
- 写 `config.ts`、`index.ts`、`app.ts` 起到能 `bun run` 起服务（路由全部返回 stub）。
- 写 `mcp-client.ts` 仅做"连得通 + callTool 能跑"的最小版。

### Phase 2 — Query 通路（1–2 day）

- 实现 `search_catalog` → `CatalogEntryMatch` 完整映射（mapper.test.ts + query-service.test.ts）
- 用 fixture 跑通单元测试，再用真 endpoint 做一次 end-to-end smoke。
- 处理 OCP filter ↔ Shopify filter 的 reject + warning，落到 `policy_summary`。

### Phase 3 — Resolve 通路（1 day）

- 实现 `get_product` → `ResolvableReference` 映射，重点是 `action_bindings` 从 `variants[].checkout_url` 派生。
- 处理 entry_id ↔ shopify gid 双向转换。
- `live_checks` 用 availability 聚合。

### Phase 4 — Discovery / Manifest / Health / Contracts（0.5 day）

- `/.well-known/ocp-catalog` + `/ocp/manifest` + `/ocp/health` + `/ocp/contracts` 全部跑通。
- 写 `scripts/validate-shopify-mvp.ts`。
- 接入根 `package.json` 的 npm scripts、`.env.example` 补段、README。

### Phase 5 — 限速与缓存（0.5 day）

- 引入简易内存 LRU + TTL 缓存（per tool + 入参哈希）。
- 限速：在 client 层加同 endpoint 并发上限和最小间隔。
- 把 `cache_hit` 写进 `explain[]` 便于排查。

### Phase 6 — 文档 + PR 准备（0.5 day）

- README + `docs/shopify_ocp_catalog_integration_design.md`（即本文）持续更新到与代码一致。
- 提交一个独立 PR 到 upstream，**不与 channel 分支耦合**。

总工时估计：**4–5 个工作日**（不含拿 Shopify dev store 的等待时间）。

---

## 6. 风险与开放问题

### 6.1 协议风险

1. **`X-Agent-Profile` header 名 / 协议细节未知**。需要在拿到 dev store 后跑通一次 negotiate-and-authenticate 流程。如果 Shopify 要求 mTLS / signed profile，工作量翻倍。
2. **限速没有公开数字**。如果免费层只有几个 req/min，OCP 直接代理会被立刻打满，需要做更激进的本地缓存或 fail-soft。
3. **Cursor 分页 vs OCP offset**。Storefront 是游标分页，OCP query 是 offset。需要在 query-service 里做"游标 ↔ offset 映射"（短期方案：仅支持首页 + warning；长期：维护一个游标缓存表）。
4. **Global Catalog 文档未明示分页参数**。如果只能返默认条数，要在 manifest 里降低 `query_capabilities` 中的 max limit。
5. **`amount` 单位**。文档示例写 `"amount":<integer>`，强烈怀疑是 minor units（美分），但未明说。需要 fixture 验证一次。

### 6.2 协议适配选择

1. **不实现 cart/checkout MCP**。OCP resolve.action_bindings 只暴露 `checkout_url`，让上层 agent 自行决定是 redirect 用户还是调 Shopify Checkout MCP。理由：trust tier、PCI/scope 都不属于 catalog 节点。
2. **Variant 粒度选择**：Shopify 的"product 有多个 variant"在 OCP 里没有一等表达。当前设计是：query 返回 product 级；resolve 返回 product，并把多个 variant 转成多条 action_binding。如果上游 agent 要 per-variant ranking，需另开 RFC。
3. **Global vs Storefront 是单实例两模式还是双实例**：建议**单实例**，由 `SHOPIFY_CATALOG_MODE` env 决定运行模式。manifest.catalog_id 上能区分即可。

### 6.3 OCP 侧改动

本接入**不需要改 `packages/ocp-schema`**，也不需要改 `packages/catalog-core`。`channel-catalog-scenario` 分支里加进 `visibleAttributes` 的 `__` 前缀过滤约定对 shopify 接入也兼容（用不到也无害）。

唯一可能要小改的：`catalogQueryFiltersSchema`（`packages/ocp-schema/src/index.ts:389`）目前是 `.strict()`，如果想把 Shopify 特有的 `ships_to: {country}` 表达到 filter 里，就要么走 `country` 这个已有字段（如果存在）/ 要么扩展。短期保守做法：用现有 `currency` + 我们自己的 `country`（不存在则 rejected）来跑通，再讨论是否给 OCP 加一个 `ships_to`。

### 6.4 与 Visa / Cart / Order MCP 的关系

Shopify 还有 Cart MCP / Checkout MCP / Order MCP。本次集成 **只接 Catalog**。Cart/Checkout/Order 涉及高 trust tier、PCI 边界、对账，应在独立的"Shopify 高级 agent"或 OCP Trust Layer 项目里做，单独立 design doc。

---

## 7. 待回答的产品/技术决策

接入正式开工前需要确认：

1. **目标模式**：先做 Global Catalog 还是 Storefront Catalog？（推荐 Global，覆盖面更大，没有店铺申请门槛）
2. **Agent profile 托管**：放在哪？OCP-Catalog 自带的 `ocp-protocol-docs-web` 是否方便挂一份 well-known 静态文件？
3. **Catalog_id 命名规范**：上游 alimama 用 `alimama_taobao_union`。Shopify 我们用 `shopify_global` 还是更具体 `shopify_global_ocp_bridge_v1`？影响 PR 评审。
4. **Variant 暴露策略**：是否在 query 返回里就把 variants 摊平？还是只在 resolve 里返？（默认建议后者，保持 query 轻量。）
5. **要不要在 search 路径加 LLM 二次重排**：Shopify 的 `score` 文档未给，我们暂用固定值。是否后续接入 embedding 服务做重排？
6. **缓存策略**：内存够吗？是否需要 Redis？MVP 内存 LRU 应足够。

---

## 8. 与现有 channel/招商 实现的关系

`apps/channel-catalog-api/` 是 DB-backed、有 provider 注册和对象同步的 catalog。Shopify 接入是 realtime proxy，二者**没有共享代码面**，只共享 `packages/catalog-core`、`packages/ocp-schema`、`packages/config`、`packages/db`（仅 inventory v1 schema 引用，不写库）。

因此当前分支 `feat/shopify-catalog` 从 `upstream/main` 独立分出，与 `feat/channel-catalog-scenario-rebased` 互不依赖，便于独立提 PR。

---

## 9. 下一步行动清单

短期（拿到本文 sign-off 后）：

- [ ] 决策 §7 六个问题，至少 1/2/3
- [ ] 申请 Shopify dev store 或确认 keyless Global Catalog 可用
- [ ] Phase 0：录 fixture
- [ ] Phase 1：搭骨架
- [ ] Phase 2–4：跑通 query/resolve/manifest 端到端
- [ ] 提交 PR 到 upstream（独立于 channel 分支）

中期：

- [ ] Cache + 限速完善
- [ ] 把 Shopify 真实场景加进 `apps/examples/ocp-webmcp-mcp-demo-web` 的 demo 列表
- [ ] 如果用户量上来，评估是否需要把 `score` 用 embedding 重新排序

长期（不在本设计范围内，仅备忘）：

- 接 Cart/Checkout MCP，做带 Visa VIC 的可信下单 demo
- 把 Shopify variant 模型作为 OCP 一等表达提 RFC
