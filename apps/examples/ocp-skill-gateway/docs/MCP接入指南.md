# OCP Skill MCP 接入指南

把 OCP Skill Gateway 暴露给 **Claude Desktop / Cursor / Codex CLI** 等 MCP 客户端用。

> 一句话:不另起 MCP server。复用 `apps/ocp-mcp-server/`,
> 它已经加了 `skill_search` / `skill_deeplink` 两个工具,
> 内部 fan-out 到本 gateway 的 `/skill/*`。

---

## 1. 架构

```
   Claude Desktop / Cursor / Codex
              │  (MCP over HTTP, JSON-RPC)
              ▼
   ocp-mcp-server  http://localhost:4300/mcp
              │
              │   skill_search  ──► POST /skill/search
              │   skill_deeplink ──► POST /skill/deeplink
              ▼
   ocp-skill-gateway  http://localhost:4330
              │
              │   /ocp/query  /ocp/resolve
              ▼
   OCP Catalog Nodes
   (alimama / jdunion / pdd / ...)
```

ocp-mcp-server 同时保留了 6 个 OCP 协议层工具(`search_catalogs` / `query_catalog` / `resolve_catalog_entry` 等),
适合需要做 Registration 节点发现的高级流程;
新加的 `skill_search` / `skill_deeplink` 是给"买东西"这种日常 LLM 场景准备的扁平接口。

---

## 2. 启动本地三件套

```bash
# Terminal 1: 下游 catalog(mock 即可)
bun run --cwd apps/examples/jdunion-catalog-api start

# Terminal 2: skill-gateway
env \
  SKILL_GATEWAY_API_KEYS=sk_mcp_001 \
  SKILL_GATEWAY_CATALOGS='[{"id":"cat_jdunion","name":"JD Union","base_url":"http://localhost:4320"}]' \
  bun apps/examples/ocp-skill-gateway/src/index.ts

# Terminal 3: ocp-mcp-server
env \
  OCP_MCP_SKILL_GATEWAY_URL=http://localhost:4330 \
  OCP_MCP_SKILL_GATEWAY_KEY=sk_mcp_001 \
  bun apps/ocp-mcp-server/src/index.ts
```

健康检查:

```bash
curl http://localhost:4320/health     # jdunion
curl http://localhost:4330/health     # gateway
curl -X POST http://localhost:4300/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -oE '"name":"[^"]+"'
```

应该能看到 8 个 tools:6 个 OCP + `skill_search` + `skill_deeplink`。

---

## 3. 客户端配置示例

### 3.1 Claude Desktop

文件:`~/Library/Application Support/Claude/claude_desktop_config.json`(macOS)
或 `%APPDATA%\Claude\claude_desktop_config.json`(Windows)。

```json
{
  "mcpServers": {
    "ocp-catalog": {
      "url": "http://localhost:4300/mcp",
      "transport": "http"
    }
  }
}
```

公网部署时把 `localhost:4300` 换成你的 HTTPS 域名(平台要求 TLS)。

### 3.2 Cursor

`Settings → MCP → Add new MCP server`:

```json
{
  "ocp-catalog": {
    "url": "http://localhost:4300/mcp"
  }
}
```

### 3.3 Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.ocp-catalog]
url = "http://localhost:4300/mcp"
```

或在 stdio 模式下:

```toml
[mcp_servers.ocp-catalog]
command = "bun"
args = ["apps/ocp-mcp-server/src/index.ts"]
cwd = "/path/to/OCP-Catalog"
env = { OCP_MCP_SKILL_GATEWAY_URL = "http://localhost:4330", OCP_MCP_SKILL_GATEWAY_KEY = "sk_mcp_001" }
```

> ⚠️ 当前 `apps/ocp-mcp-server/` 默认走 HTTP transport,
> 想用 stdio 需要再加一个入口。M2 再加。

---

## 4. 工具速查

| 工具 | 何时用 | 入参 |
|---|---|---|
| `skill_search` | 用户要找/买某个商品 | `query` 必填,`page` / `page_size` 可选 |
| `skill_deeplink` | 拿 `skill_search` 返回的 `entry_ref` 换购买链接 | `catalog_id` + `entry_ref` 必填,`sub_id` 可选 |
| `find_and_query_catalog` | 用户要先了解"有哪些 catalog 可选" | OCP 协议层流程 |
| `search_catalogs` | 同上,但需要看 registration 节点 | 同上 |
| `query_catalog` / `resolve_catalog_entry` / `inspect_catalog` | 高级:precise catalog 控制 | 同上 |
| `describe_ocp_catalog` | 解释 OCP Catalog 是什么 | — |

---

## 5. 调试技巧

- MCP 服务器日志写到 stderr,看 `/tmp/mcp.log` 或终端
- skill-gateway 的 telemetry 在 `GET /dashboard/recent` 能查最近调用
- 工具调用失败一般是 401(`OCP_MCP_SKILL_GATEWAY_KEY` 没和 gateway 的 `SKILL_GATEWAY_API_KEYS` 对上)
  或下游 catalog 没起来(`/dashboard/catalogs` 看每个 catalog 的 ping 状态)

---

## 6. 公网部署 checklist

| 项 | 说明 |
|---|---|
| HTTPS | Claude Desktop / Cursor 都强制 TLS,先用 cloudflare tunnel / ngrok |
| 域名备案(国内场景) | 国内 IM 客户端做集成时可能要求备案域名 |
| `OCP_MCP_SKILL_GATEWAY_KEY` | 不能写死在客户端配置里。M2 改成 OAuth / 用户登录态 |
| Skill API Key 轮换 | M2 切到 DB 后,gateway 这边可以热切;客户端不需要改 |

---

## 7. 下一步

- [ ] M2:为 ocp-mcp-server 加 stdio transport(Claude Desktop 默认走 stdio 更稳)
- [ ] M2:把 `OCP_MCP_SKILL_GATEWAY_KEY` 换成"用户登录态 → 派生短期 token"模式
- [ ] M3:加 `skill_compare` / `skill_recommend` 两个工具,和 OpenAPI 派对齐
