# Shopify App — 部署交接文档(给部署服务器上的 agent)

> 读者:在**部署服务器**上操作的 agent / 工程师。
> 目标:把 `apps/examples/shopify-app`(一个多租户 Shopify 公共应用)真实部署上线,
> 让 Shopify 商家能一键安装、把商品自动同步进 OCP Catalog。
> 本文自包含——你不需要回看对话历史。

---

## 0. 这是什么 / 你的任务

`shopify-app` 是 Shopify → OCP 的**多租户公共应用(App Store 形态)**:一个进程服务所有安装它的商家。
商家在浏览器点 "Install" → 走 OAuth → app 存下该店的 access token(加密)→ 订阅 webhook →
把该店注册成一个 OCP Provider → 把商品同步进 OCP Catalog。之后商品每次改动经 webhook 增量同步。

**它跟同仓库的 `shopify-provider-app` 的区别**:那个是单租户(token 从 env 读,一个进程一个店);
本 app 是多租户(每店 OAuth token 存 Postgres)。两者都已合并进 upstream main,别动 provider-app。

**你的任务**:在一台能上公网、有域名、网络能直连 Shopify 的服务器上,把本 app 跑起来并通过
Partner Dashboard 配置好,使真实安装流程端到端可用。

代码位置:`apps/examples/shopify-app/`。本仓库是 bun + turbo monorepo。

---

## 1. 必须先知道的关键约束(踩过的坑,别重犯)

1. **网络硬门槛**:OAuth 回调要调 `https://{shop}/admin/oauth/access_token` 换 token。
   某些受限网络(TLS 拦截/代理)会让这个端点报 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`,
   而 GraphQL 端点却正常——**必须用 §3 的 preflight 先验证这台机器能通,否则后面全白搭**。

2. **生产配置防呆**:`SHOPIFY_APP_ENV=production` 或 `SHOPIFY_APP_MOCK=false` 时,代码会**拒绝启动**,
   除非:`SHOPIFY_APP_API_KEY` / `SHOPIFY_APP_API_SECRET` / `SHOPIFY_APP_ADMIN_KEY` /
   `SHOPIFY_APP_CATALOG_API_KEY` 都不是默认 dev 值,且 `SHOPIFY_APP_TOKEN_ENCRYPTION_KEY` 已设
   (见 `apps/examples/shopify-app/src/config.ts` 的 `loadShopifyAppConfig`)。

3. **token 加密 key 格式**:`SHOPIFY_APP_TOKEN_ENCRYPTION_KEY` 必须是 **32 字节**,
   接受 `base64:<...>` / `hex:<...>` 前缀,或裸 base64/hex(刚好 32 字节)。AES-256-GCM。
   生成:`echo "base64:$(openssl rand -base64 32)"`。

4. **Partner Dashboard 两个开关必须设对**(当前代码的事实,不是 toml 里写的目标值):
   - **嵌入应用(embedded)= 关**。`/app` 目前是静态 HTML 状态页,没有 App Bridge,勾了会在 admin iframe 里跑不起来。
   - **使用旧版安装流程(legacy install flow)= 开**。代码实现的是经典 OAuth 授权码流程
     (`/auth` → 跳转授权 → `/auth/callback` 换 token),不是 Shopify managed install。

5. **URL 一致性**:Partner 后台的 App URL / Redirect URL 必须和 `SHOPIFY_APP_URL` 派生值完全一致。
   代码里 `redirectUri = SHOPIFY_APP_URL + "/auth/callback"`。`SHOPIFY_APP_URL` 填**裸域名,不带 /app**。

6. **API 版本**:`SHOPIFY_APP_API_VERSION=2026-04`。注意 2026-04 已移除 `ProductVariant.weight/weightUnit`
   (代码已适配,别加回去)。

7. **app 自带后台 worker**:进程内有个 job worker(`SHOPIFY_APP_WORKER_ENABLED` 默认 true)跑同步/重试,
   不需要单独起 worker 进程。

---

## 2. 组件与依赖(部署需要这些一起在)

| 组件 | 作用 | 端口 |
|---|---|---|
| Postgres (pgvector) | 存 install / 加密 token / oauth state / webhook 事件 / sync job | 5432(docker 映射) |
| OCP Catalog (`commerce-catalog-api`) | 同步目标——商品最终进这里 | 4000 |
| **shopify-app**(本体) | OAuth + webhook + 嵌入页 + 同步 worker | 4420 |
| 反向代理(Caddy/nginx) | 443 → 4420,提供 HTTPS | 443 |

> catalog 可以跑在同机,也可以指向已有的 catalog 部署(改 `SHOPIFY_APP_CATALOG_BASE_URL`)。

**Postgres 里本 app 用到的 5 张表**(`bun run db:migrate` 自动建):
`shopify_app_installations`、`shopify_app_tokens`(加密 token)、`shopify_app_oauth_states`、
`shopify_app_webhook_events`(webhook 事件账本)、`shopify_app_sync_jobs`(同步 job 队列)。

---

## 3. 阶段 0 —— 第一道闸:网络能否换 token

登上服务器先跑(过不了这关就换机器):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://mds0my-wh.myshopify.com/admin/oauth/access_token \
  -H 'content-type: application/json' -d '{}'
```
`400` 或 `401` = ✅ 通(端点可达,只是没带参数,正常)。卡住 / SSL 错 / 超时 = ❌ 这台机器出网被限,换。

---

## 4. 阶段 1 —— 装运行环境(全新 Ubuntu/Debian)

```bash
# bun
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc
# docker(给 Postgres)
curl -fsSL https://get.docker.com | sh
# Caddy(自动 HTTPS 反代)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
已装的跳过。Node 路线也行(≥22.12),但仓库脚本默认 bun。

---

## 5. 阶段 2 —— 代码 + 数据库

```bash
git clone https://github.com/echo636/OCP-Catalog.git
cd OCP-Catalog
~/.bun/bin/bun install

docker compose up -d postgres          # pgvector 镜像,见 docker-compose.yml
# 等 ~5s 就绪
~/.bun/bin/bun run db:migrate          # 建全部表(含 shopify_app_*)

# 验证 shopify 表都在
docker exec ocp-catalog-postgres psql -U ocp -d ocp_catalog -c "\dt shopify_app*"
# 期望看到 5 张:installations / tokens / oauth_states / webhook_events / sync_jobs
```
> 若 `db:migrate` 因 pgvector 扩展报错,先手动:
> `docker exec ocp-catalog-postgres psql -U ocp -d ocp_catalog -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"` 再重跑。

---

## 6. 阶段 3 —— 起 OCP Catalog(同步目标)

同机起(简单):
```bash
~/.bun/bin/bun run commerce:catalog:api    # 监听 4000,正式用 pm2/systemd 守护(见 §9)
curl -s localhost:4000/health              # {"ok":true,"service":"commerce-catalog-api",...}
```
或指向已有 catalog:跳过,§7 把 `SHOPIFY_APP_CATALOG_BASE_URL` 指过去,并核对 `SHOPIFY_APP_CATALOG_ID`
与 `SHOPIFY_APP_CATALOG_API_KEY` 与那个 catalog 一致。

> catalog 的搜索索引是异步 worker(~30s 一轮),所以"同步完到能搜到"有几十秒延迟,属正常。

---

## 7. 阶段 4 —— 配 env + 起 shopify-app

需要先有 Partner app 的 **Client ID / Client secret**(§8 步骤拿)。
```bash
ADMIN_KEY=$(openssl rand -hex 16)
ENC_KEY="base64:$(openssl rand -base64 32)"
echo "ADMIN_KEY=$ADMIN_KEY"     # 记下,/admin/* 维护接口要用

SHOPIFY_APP_MOCK=false \
SHOPIFY_APP_ENV=production \
SHOPIFY_APP_API_KEY=<CLIENT_ID> \
SHOPIFY_APP_API_SECRET=<CLIENT_SECRET> \
SHOPIFY_APP_URL=https://<你的域名> \
SHOPIFY_APP_API_VERSION=2026-04 \
SHOPIFY_APP_ADMIN_KEY=$ADMIN_KEY \
SHOPIFY_APP_TOKEN_ENCRYPTION_KEY=$ENC_KEY \
SHOPIFY_APP_CATALOG_BASE_URL=http://localhost:4000 \
SHOPIFY_APP_CATALOG_ID=cat_local_dev \
SHOPIFY_APP_CATALOG_API_KEY=dev-api-key \
~/.bun/bin/bun run shopify:app          # 监听 4420
```

### env 完整参考(来自 `src/config.ts`)

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `SHOPIFY_APP_API_KEY` | ✅生产 | dev 占位 | Partner app Client ID |
| `SHOPIFY_APP_API_SECRET` | ✅生产 | dev 占位 | Client secret(OAuth + webhook HMAC 都用它) |
| `SHOPIFY_APP_URL` | ✅ | localhost:4420 | 公网裸域名,不带 /app |
| `SHOPIFY_APP_PORT` | | 4420 | 监听端口 |
| `SHOPIFY_APP_SCOPES` | | read_products,read_inventory,read_locations,read_product_listings | |
| `SHOPIFY_APP_API_VERSION` | | 2026-04 | |
| `SHOPIFY_APP_ENV` | | development | 设 production 触发防呆校验 |
| `SHOPIFY_APP_TOKEN_ENCRYPTION_KEY` | ✅生产 | — | 32 字节 base64:/hex: |
| `SHOPIFY_APP_ADMIN_KEY` | ✅生产 | dev 占位 | /admin/* 鉴权 |
| `SHOPIFY_APP_MOCK` | | false | true=读 fixtures 不联网(本地测) |
| `SHOPIFY_APP_SYNC_ON_INSTALL` | | true | 装好立即跑全量同步 |
| `SHOPIFY_APP_WORKER_ENABLED` | | true | 进程内 job worker |
| `SHOPIFY_APP_CATALOG_BASE_URL` | | localhost:4000 | 目标 catalog |
| `SHOPIFY_APP_CATALOG_ID` | | cat_local_dev | 目标 catalog id |
| `SHOPIFY_APP_CATALOG_API_KEY` | ✅生产 | dev-api-key | catalog 的 x-api-key |
| `DATABASE_URL` | | postgres://ocp:ocp@localhost:5432/ocp_catalog | |

验证起来了:`curl -s localhost:4420/health` → `{"ok":true,"service":"shopify-app","mock":false,...}`。

---

## 8. 阶段 5 —— Partner Dashboard 建 app + 拿凭据 + 配 URL

> 账号:用拥有 dev store **COFFEECONCEPT**(`mds0my-wh.myshopify.com`)的那个 Partner 账号
> (登录邮箱 `fangcosmo88@gmail.com`)。dev store 必由某 Partner 账号创建,所以账号已存在。

1. partners.shopify.com → **Apps → Create app → Create app manually** → 起名 `OCP Provider Adapter`。
2. 复制 **Client ID** + **Client secret** → 填 §7 的 env。
3. **App setup**,用真实域名填(必须和 `SHOPIFY_APP_URL` 一致):

| 字段 | 值 |
|---|---|
| 应用 URL (App URL) | `https://<你的域名>/app` |
| **嵌入应用** | **关(不勾)** |
| **使用旧版安装流程** | **开(勾)** |
| Webhook API 版本 | `2026-04` |
| 权限范围 | `read_products,read_inventory,read_locations,read_product_listings` |
| 重定向 URL | `https://<你的域名>/auth/callback` |

4. Webhook 订阅(`shopify.app.toml` 已声明;也可 `shopify app deploy` 推,或后台手填),全部指向你的域名:
   - `products/create`,`products/update`,`products/delete` → `/webhooks/products`
   - `app/uninstalled` → `/webhooks/app/uninstalled`
   - `customers/data_request` → `/webhooks/compliance/customers-data-request`
   - `customers/redact` → `/webhooks/compliance/customers-redact`
   - `shop/redact` → `/webhooks/compliance/shop-redact`

---

## 9. 阶段 6 —— Caddy 反代 + TLS + 进程守护

DNS 先加一条 A 记录:`<你的域名>` → 服务器公网 IP。然后:
```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
<你的域名> {
    reverse_proxy localhost:4420
}
EOF
sudo systemctl reload caddy
curl -s https://<你的域名>/health     # 应返回 shopify-app health
```

进程守护(别用 `&`,断开就停)。pm2 示例:
```bash
npm i -g pm2
pm2 start --name ocp-catalog --interpreter ~/.bun/bin/bun -- run commerce:catalog:api
# shopify-app 带一堆 env,写个 start.sh 包起来再 pm2 start ./start.sh
pm2 save && pm2 startup
```

---

## 10. 阶段 7 —— 安装 + 验证端到端

浏览器开(注意是 agent 演示场景,这步需要人在浏览器点同意):
```
https://<你的域名>/auth?shop=mds0my-wh.myshopify.com
```
→ Shopify 授权页 → **Install** → app 自动:校验 query HMAC(hex)+ state → code 换 token →
加密存 `shopify_app_tokens` → 订阅 webhook → 注册 OCP provider(`shopify_app_mds0my_wh`)→
enqueue 全量同步(worker 后台跑)→ 跳 `/app` 状态页。

验证:
```bash
# 1. 安装落库
docker exec ocp-catalog-postgres psql -U ocp -d ocp_catalog -A -F'|' \
  -c "SELECT shop_domain,status,active_registration_version FROM shopify_app_installations;"
#   mds0my-wh.myshopify.com|active|1

# 2. token 已加密存储(不是明文)
docker exec ocp-catalog-postgres psql -U ocp -d ocp_catalog -A -F'|' \
  -c "SELECT shop_domain,left(access_token_ciphertext,8) FROM shopify_app_tokens;"
#   应看到 v1:....(密文,不是 shpat_)

# 3. 商品进了 catalog(等 ~30-60s 索引)
docker exec ocp-catalog-postgres psql -U ocp -d ocp_catalog -A -F'|' \
  -c "SELECT count(*) FROM commercial_objects WHERE provider_id='shopify_app_mds0my_wh';"

# 4. 管理接口看状态(用 §7 记下的 ADMIN_KEY)
curl -s https://<你的域名>/admin/status/mds0my-wh.myshopify.com -H "x-admin-key: $ADMIN_KEY"
```

### 不走浏览器的快速验证(可选)
OAuth 同意必须人工点,但安装后的链路可用 admin 接口直接驱动(适合冒烟测试,需要一个有效 token):
```bash
curl -XPOST https://<域名>/admin/installations/seed -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"shop_domain":"mds0my-wh.myshopify.com","access_token":"shpat_<有效token>"}'
curl -XPOST https://<域名>/admin/register/mds0my-wh.myshopify.com -H "x-admin-key: $ADMIN_KEY"
curl -XPOST https://<域名>/admin/sync/full/mds0my-wh.myshopify.com -H "x-admin-key: $ADMIN_KEY"
```

---

## 11. 故障排查(已知失败模式)

| 现象 | 原因 / 处理 |
|---|---|
| app 启动即报错 "must be set in production" | §1.2 防呆:某个 key 还是 dev 默认值,或没给 ENC_KEY |
| `/auth/callback` 报 invalid_hmac | Partner 后台的 client secret 和 env `SHOPIFY_APP_API_SECRET` 不一致 |
| `/auth/callback` 报 invalid_state | state nonce 过期/丢失(`shopify_app_oauth_states` 有 TTL),重新从 `/auth` 走 |
| 换 token 报 SSL/cert 错 | §3 没过——这台机器出网被拦,换机器 |
| 装完商品没进 catalog | catalog 没起 / `SHOPIFY_APP_CATALOG_*` 配错 / 等索引 60s;查 `/admin/status/:shop` 的 last_run |
| Shopify 报 redirect_uri mismatch | Partner 后台 Redirect URL ≠ `SHOPIFY_APP_URL`+`/auth/callback`,或带了多余斜杠 |
| 嵌入页在 admin 里空白 | "嵌入应用"误勾了——本 app 无 App Bridge,要关掉 |
| `ProductVariant.weight` GraphQL 错 | API 版本不是 2026-04 适配版;确认代码是最新 main |

调试日志:app 的 stdout 有结构化日志;`/admin/status/:shop` 返回 `last_run`(类型/状态/错误)。

---

## 12. 不在范围内 / 已知缺口(别误以为坏了)

- **嵌入式 Polaris/App Bridge UI 没做**。`/app` 只是静态状态页,够内测,但**过不了 App Store 审核**
  (审核要求真嵌入式 UI)。要上架需补这块前端。
- **数据看板没做**。"浏览量/转换/退货"需要额外的归因链路(resolve URL 盖章 + orders/refunds webhook +
  `read_orders` scope),当前 scope 和代码都没有。详见对话记录里的需求分析,属于独立项目。
- **当前每店只挂 1 个 catalog**(`SHOPIFY_APP_CATALOG_ID` 单值)。多 catalog 需扩数据模型。

---

## 13. 凭据安全

- 别把 client secret / token encryption key / admin key 提交进 git。用服务器的 secret 管理或 env 文件(`chmod 600`)。
- COFFEECONCEPT 之前给过的 `shpat_...` 是 ~24h 短期 token,**大概率已过期**;真实安装会经 OAuth 重新换发,不用旧的。
- `SHOPIFY_APP_TOKEN_ENCRYPTION_KEY` 一旦用于加密了线上 token,**不要更换**(换了解不开已存的密文)。轮换需配套迁移。

---

## 14. 一句话给接手 agent

先跑 §3 的 preflight 确认网络能换 token;过了就按 §4→§10 顺序走;
卡住先查 §11。核心不变量:**embedded=off + legacy install=on + URL 三处一致 + 生产 4 个 key 非默认 + 32 字节加密 key**。
