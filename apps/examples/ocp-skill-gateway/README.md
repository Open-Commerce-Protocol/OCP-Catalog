# OCP Skill Gateway

把 OCP 注册中心(默认 `ocp.deeplumen.io/mcp`)的 catalog 能力统一包装成
**LLM Agent 平台可调用的 Skill**,并提供给学生/运营的**数据看板**。

> 目标:在 Coze、腾讯元器、阿里百炼、文心智能体 上架同一份 OpenAPI;
> 让学生开发者基于这些 skill 构建 Agent → 带来订单 → 走分润。

完整设计与节奏见 [docs/技术实现路径.md](docs/技术实现路径.md)。
上游接入实现见 [docs/OCP MCP 上游接入手记.md](docs/OCP%20MCP%20上游接入手记.md)。

## 快速启动

```bash
# 1. 最小启动(默认上游 = ocp.deeplumen.io/mcp,真实数据,无需配 catalog 列表)
SKILL_GATEWAY_API_KEYS=sk_dev_demo_001 \
  bun apps/examples/ocp-skill-gateway/src/index.ts

# 2. 健康检查
curl http://localhost:4330/health
# {"ok":true,"upstream":"ocp_mcp","upstream_url":"https://ocp.deeplumen.io/mcp",...}

# 3. 试搜(出 alimama / shopify 真实数据)
curl -X POST http://localhost:4330/skill/search \
  -H 'content-type: application/json' \
  -H 'X-Skill-Key: sk_dev_demo_001' \
  -d '{"query":"耳机","page_size":3}'

# 4. 拿 OpenAPI(给 Coze 等平台导入用)
curl http://localhost:4330/openapi.yaml
```

## 上游切换

| Env | 默认 | 说明 |
|---|---|---|
| `SKILL_GATEWAY_UPSTREAM` | `ocp_mcp` | `ocp_mcp` = 走 ocp.deeplumen.io/mcp(真实 alimama / shopify);`local_catalogs` = 走本地 mock |
| `SKILL_GATEWAY_OCP_MCP_URL` | `https://ocp.deeplumen.io/mcp` | 仅 `ocp_mcp` 模式生效 |
| `SKILL_GATEWAY_CATALOGS` | `[]` | 仅 `local_catalogs` 模式必填 |

## 路由分层

| 路径 | 谁调 | 鉴权 | 出现在 OpenAPI |
|---|---|---|---|
| `/skill/search` 等 | LLM(经平台插件) | `X-Skill-Key` Header | ✅ |
| `/dashboard/*` | 学生/运营浏览器 | M1 无,M2 加 session | ❌ |
| `/admin/*` | 内部 | M2 加 | ❌ |
| `/health` `/openapi.yaml` | 公共 | 无 | — |

## Skill 列表(M1)

| Endpoint | 状态 | 说明 |
|---|---|---|
| `POST /skill/search` | ✅ | 跨 catalog 并行搜商品 |
| `POST /skill/deeplink` | ✅ | 生成带返佣购买链接 |
| `POST /skill/compare` | ✅ | 比价 |
| `POST /skill/recommend` | ✅ | 按预算/类目推荐 |
| `POST /skill/order` | ⏳ M2 | 订单/佣金查询 |

## Dashboard API(M1)

| Endpoint | 说明 |
|---|---|
| `GET /dashboard/summary` | 首页卡片汇总 |
| `GET /dashboard/catalogs` | 已上架 catalog 列表 + ping 状态 |
| `GET /dashboard/skill-stats` | 各 skill 调用次数 |
| `GET /dashboard/recent` | 最近调用流水 |

## 本地联调建议

PDD 默认端口和 skill-gateway 冲突 (都用 4330),需要把 PDD 改到 4340:

```bash
# Terminal 1: JD Union (mock 模式, :4320)
bun run --cwd apps/examples/jdunion-catalog-api start

# Terminal 2: PDD (mock 模式, :4340)
PDD_CATALOG_PORT=4340 bun run --cwd apps/examples/pdd-catalog-api start

# Terminal 3: Alimama (mock 模式, :4310)
bun run --cwd apps/examples/alimama-catalog-api start

# Terminal 4: Skill Gateway (:4330)
env \
  SKILL_GATEWAY_API_KEYS=sk_dev_demo_001 \
  SKILL_GATEWAY_CATALOGS='[{"id":"cat_jdunion","name":"JD Union","base_url":"http://localhost:4320"},{"id":"cat_pdd","name":"PDD","base_url":"http://localhost:4340"},{"id":"cat_alimama","name":"Alimama","base_url":"http://localhost:4310"}]' \
  bun apps/examples/ocp-skill-gateway/src/index.ts

# 试调
curl -X POST http://localhost:4330/skill/search \
  -H 'content-type: application/json' \
  -H 'X-Skill-Key: sk_dev_demo_001' \
  -d '{"query":"蓝牙耳机","page_size":5}'
```

## 回归 smoke

[scripts/skill-gateway-smoke.ts](../../../scripts/skill-gateway-smoke.ts) 覆盖 13 个检查点:
/health → /openapi.yaml 结构 → /dashboard/catalogs → 鉴权 401 → fan-out → 每个 catalog deeplink → /skill/{compare,recommend,order}。

```bash
SKILL_GATEWAY_SMOKE_KEY=sk_dev_demo_001 bun run smoke:skill-gateway
```

## 公网暴露(给平台审核用)

用 cloudflare quick tunnel 把 `localhost:4330` 暴露成 `https://*.trycloudflare.com`,
零配置零账号。详见 [docs/公网暴露手记.md](docs/公网暴露手记.md)。

```bash
cloudflared tunnel --url http://localhost:4330 --no-autoupdate
# 拿到 URL 后重启 gateway,SKILL_GATEWAY_PUBLIC_BASE_URL 填进去
```

## 下一步(Week 2)

- [x] 跑通 search + deeplink 本地链路
- [x] 验证 OpenAPI spec 合规 (swagger-parser 通过)
- [x] 多 catalog fan-out + 失败隔离自测通过
- [x] cloudflared quick tunnel 暴露 HTTPS,公网 smoke 13/13 通过
- [x] 在 Coze 个人开发者后台导入 OpenAPI 试上架(豆包 1.8 Bot 端到端跑通)
- [x] 落 [docs/Coze上架手记.md](docs/Coze上架手记.md)
- [x] 补齐 `skill_compare` / `skill_recommend` 的 response schema(为 ChatGPT GPT Actions 铺路)
- [x] **上游切到 ocp.deeplumen.io/mcp 注册中心**(alimama / shopify 真实数据,smoke 12/12 过) — [手记](docs/OCP%20MCP%20上游接入手记.md)
- [ ] Coze Bot 端用新上游重测 compare / recommend / deeplink
- [ ] ChatGPT Custom GPT Actions 试上架
- [ ] `scripts/mcp-skill-smoke.ts` 验证 MCP server fan-out
