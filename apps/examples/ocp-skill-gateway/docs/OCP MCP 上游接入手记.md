# OCP MCP 上游接入手记 — 2026-05-28

> 把 skill-gateway 的上游数据源从「本地 3 个 mock catalog」切到 `ocp.deeplumen.io/mcp`(OCP 注册中心官方 MCP server),Coze 端零变更。

## 触发场景

- Coze Bot 测试时 `skill_compare` 报「主机找不到」 → 发现 cloudflare quick tunnel URL 漂了。
- 顺便发现:**领导说的 ocp.deeplumen.io 就是 OCP 注册中心,内置 alimama 真返佣 catalog**,我们一直用 mock 是浪费。
- 同时 alimama 导购权限审批没下来 — 那就别等了,直接走注册中心的 alimama affiliate catalog。

## 架构变化

```
之前:  Coze ─HTTP→ skill-gateway ─HTTP→ 本地 3 mock(jdunion/pdd/alimama)
之后:  Coze ─HTTP→ skill-gateway ─MCP→  ocp.deeplumen.io/mcp ─→ 3 真 catalog
                                                                  ├─ cat_alimama_affiliate(真淘宝联盟)
                                                                  ├─ cat_shopify_global(真 Shopify 商品)
                                                                  └─ cat_local_dev(注册中心自带 dev)
```

**Coze 插件页一个字段不用动**,HTTP 契约完全保持。差别是 gateway 从「fan-out 到本地 mock」变成「fan-out 到 MCP 注册中心」。

## MCP server 的工具集

`ocp.deeplumen.io/mcp` 暴露 6 个工具(MCP `tools/list`):

| 工具 | 用途 | 我们映射到 |
|---|---|---|
| `describe_ocp_catalog` | 概念解释 | (没用) |
| `search_catalogs` | 列已注册 catalog + route_hint + health | `pingCatalogs` / fan-out 前置 |
| `inspect_catalog` | 看某 catalog 的 query packs / 字段 | (没用) |
| `query_catalog` | 在某 catalog 里查 entries | `fanoutSearch` 内部并行调用 |
| `resolve_catalog_entry` | 把 entry 解析成可点击 URL | `resolve` |
| `find_and_query_catalog` | 一站式 server 端选 catalog + 查 | **没用**(见下文) |

### 为什么没用 `find_and_query_catalog`

第一版 broker 用的就是它,一句话搞定。**但它是 server 端 keyword 匹配选 1 个最优 catalog**,我们填 `catalog_query="commerce product catalog"` 时被路到了空的 `cat_local_dev`(因为它的描述字段里有 "Commerce product Catalog" 字样),真正有数据的 `cat_alimama_affiliate` 反而被略过。

解决方案:自己 fan-out。`search_catalogs` 列所有健康 catalog(60s 缓存)→ 并行 `query_catalog` 每一个 → 合并结果。也顺便恢复了"跨平台覆盖"这个 LLM Agent 真正需要的特性。

## 实现要点(代码侧)

### 1. Broker 接口抽取

`src/broker/client.ts` 之前是个具体类,现在拆成:

```ts
export interface BrokerClient {
  readonly catalogs: CatalogEntry[];
  fanoutSearch(opts): Promise<FanoutSearchResult>;
  resolve(opts): Promise<ResolveResult>;
  pingCatalogs(): Promise<PingResult[]>;
}

export class LocalCatalogsBrokerClient implements BrokerClient { ... }
```

新增 `src/broker/ocp-mcp-client.ts`:`class OcpMcpBrokerClient implements BrokerClient`。

routes 全部依赖接口,完全不感知具体实现。

### 2. config 双开关

```ts
SKILL_GATEWAY_UPSTREAM:   'ocp_mcp' | 'local_catalogs'   // default 'ocp_mcp'
SKILL_GATEWAY_OCP_MCP_URL: string                         // default 'https://ocp.deeplumen.io/mcp'
```

`app.ts` 按 env 选 broker。`SKILL_GATEWAY_CATALOGS` env 在 `ocp_mcp` 模式下完全不用填(默认空数组)。

### 3. MCP JSON-RPC 调用细节

MCP Streamable HTTP 协议要求 `Accept: application/json, text/event-stream`,缺这个 header 会 406。

`tools/call` 的响应壳:

```json
{
  "result": {
    "content": [{ "type": "text", "text": "<JSON 字符串>" }]
  }
}
```

`content[0].text` 是 JSON 字符串,要 `JSON.parse` 一次才能拿到结构化数据。

### 4. resolve 的字段命名陷阱

OCP 1.0 spec 里 ResolveResponse 的动作列表叫 `action_bindings`,但 `ocp.deeplumen.io/mcp` 的 `resolve_catalog_entry` 返回的字段叫 `actions`。两个字段都兜底找一下:

```ts
const actions =
  Array.isArray(inner?.actions) ? inner.actions :
  Array.isArray(inner?.action_bindings) ? inner.action_bindings :
  [];
const urlAction =
  actions.find(a => a?.action_id === 'buy_now' && a?.entrypoint?.url) ??
  actions.find(a => a?.action_type === 'url' && a?.entrypoint?.url);
```

alimama 的 `resolve` 返回两个 action:`buy_now`(`s.click.taobao.com/...` 带 PID 归因)和 `buy_with_coupon`(`uland.taobao.com/coupon/...` 也带 PID)。优先选 `buy_now`。

### 5. catalog 列表 60s 缓存

`OcpMcpBrokerClient.listHealthyCatalogs()` 缓存 `search_catalogs` 结果 60 秒。否则每次 `/skill/search` 都要先 `search_catalogs` → 再 N× `query_catalog`,延迟 +1s。

## 验证结果

`bun run smoke:skill-gateway` 现在跑 **12/12 全过**(对接 `http://localhost:4330` 直跑):

```
✓ Step 1a: GET /health                upstream=ocp_mcp
✓ Step 1b: GET /openapi.yaml          5 ops
✓ Step 2:  GET /dashboard/catalogs    3 catalogs all healthy
✓ Step 3a/b: 鉴权 401 双场景
✓ Step 4:  POST /skill/search         total=6, catalogs with items: 2/3
✓ Step 5:  /skill/deeplink alimama    https://s.click.taobao.com/t?...
✓ Step 5:  /skill/deeplink shopify    https://cn.bellman.com/cart/...
✓ Step 5e: unknown catalog 优雅返回
✓ Step 6a: /skill/compare             10 items 按价升序
✓ Step 6b: /skill/recommend           5 items 全在 budget_max=300 内
✓ Step 7:  /skill/order               501 占位
```

### 实测真返佣 URL 样本

`/skill/search` 后跟 `/skill/deeplink` 拿到的真链接(都带 affiliate 归因参数):

- **Alimama**:`https://s.click.taobao.com/t?e=m%3D2%26s%3D...&union_lens=lensId%3AMAPI%40...`
- **Shopify**:`https://cn.bellman.com/cart/51140775543079:1`(直跳商品加车页)

## 已知简化 / TODO

- `query_catalog` 当前只用了 `query` + `limit` + `offset`,没用 `query_pack` / `filters`。注册中心的 catalog 支持 `ocp.query.semantic.v1`,后面可以加语义检索开关。
- `route_hint` 缓存里没做版本号校验,如果上游 catalog 重启换了 snapshot_id 我们要等 60s 才感知。可接受。
- `LocalCatalogsBrokerClient` 仍然保留,用 `SKILL_GATEWAY_UPSTREAM=local_catalogs` 切回去 — 离线开发或者注册中心挂了时的兜底路径。
- 没有重试 / 熔断 / 限流。MCP server 一旦异常会反映在 per_catalog 错误字段里。

## 启动命令(新)

最小启动(只配一个 API key 就够了,upstream 默认就是 `ocp_mcp`):

```bash
SKILL_GATEWAY_API_KEYS=sk_dev_demo_001 \
  bun apps/examples/ocp-skill-gateway/src/index.ts
```

启动日志变成:

```
[ocp-skill-gateway] listening on http://localhost:4330, upstream=ocp_mcp(https://ocp.deeplumen.io/mcp), api_keys=1
```

切回本地 mock:

```bash
SKILL_GATEWAY_UPSTREAM=local_catalogs \
  SKILL_GATEWAY_CATALOGS='[{"id":"cat_jdunion","name":"JD Union","base_url":"http://localhost:4320"}, ...]' \
  SKILL_GATEWAY_API_KEYS=sk_dev_demo_001 \
  bun apps/examples/ocp-skill-gateway/src/index.ts
```

## 对 Coze / 其它平台的影响

| 平台 | 影响 |
|---|---|
| Coze 国内版 | **零变更**,HTTP 契约不动,插件 URL 仍是 cloudflare tunnel(或未来的稳定域名) |
| ChatGPT Custom GPT Actions | 同上,response schema 已经在上一轮补齐为它准备过 |
| 元器 / 百炼 / 文心 / Dify | 同上 |
| 直连 MCP(未来) | 假如 Coze 国内版未来开放 MCP 接入,可以让 Bot 直接打 `ocp.deeplumen.io/mcp`,我们 gateway 这层就不需要了。但 ChatGPT Actions / 元器 / 百炼 这些非 MCP 平台仍需要 gateway 适配。 |

## 关键 takeaway

1. **`find_and_query_catalog` 的"一站式"省不掉 fan-out**:keyword 匹配选不准,跨平台覆盖是必需的,只能我们自己列 catalog + 并行查。
2. **MCP server 字段名跟 OCP spec 不完全一致**:resolve 用 `actions` 不是 `action_bindings`。接公开 MCP server 时一定要先 raw 探一遍,不能照着 OCP spec 写。
3. **Streamable HTTP MCP 的 Accept header 是必须的**:Accept: application/json, text/event-stream 缺一个就 406。
4. **catalog 缓存必加**:不然 fan-out 每次都要先 `search_catalogs`,延迟翻倍。
5. **导购权限审批不影响接入**:`ocp.deeplumen.io` 的 `cat_alimama_affiliate` 已经是真返佣 catalog,我们当 MCP 客户端调用,真 PID 归因链接由注册中心 mint,我们不需要自己拿 alimama 资质。
