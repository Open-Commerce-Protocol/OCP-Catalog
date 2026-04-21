# OCP Catalog Demo Workspace

这个仓库实现了一个可运行的 OCP Catalog Phase 1 工作区，不是只有协议草图。

当前已经具备三条真实运行链路：

```text
Catalog -> Center
  Catalog 注册到 OCP Center
  Center 拉取 manifest
  Center 建立 catalog 索引和 route hint

Provider -> Catalog
  Provider 发现 Catalog
  Provider 注册到 Catalog
  Catalog 选择 sync capability
  Provider 分批同步对象
  Catalog 校验、入库、建索引

User / Agent -> Center -> Catalog
  用户侧 agent 先查本地 catalog profile
  缺失时到 Center 找 catalog
  用户确认后保存本地 profile
  agent 再对 Catalog query / resolve
```

## 当前运行单元

从运行和部署角度看，这个 monorepo 当前可以收敛成 5 个核心服务：

```text
1. ocp-center-api
   Catalog Registry / Discovery Center

2. commerce-catalog-api
   第一个 Catalog 实现，负责 registration / sync / query / resolve

3. commerce-provider
   由 commerce-provider-api + commerce-provider-admin-web 组成
   负责商品源数据管理、注册和同步

4. ocp-user-demo
   由 ocp-user-demo-api + ocp-user-demo-web 组成
   负责用户侧 agent 体验

5. ocp-protocol-docs-web
   协议文档站，纯静态前端
```

也就是说，仓库里虽然有 7 个 `apps/*` 目录，但其中有两组本质上是配套单元：

- `commerce-provider-api` + `commerce-provider-admin-web`
- `ocp-user-demo-api` + `ocp-user-demo-web`

## 仓库结构

```text
apps/
  commerce-catalog-api/        第一个 Catalog 实现，场景为 commerce product catalog
  commerce-provider-api/       商品 Provider API，负责注册和同步到 Catalog
  commerce-provider-admin-web/ Provider 管理台
  ocp-center-api/              OCP Center / Catalog Registry
  ocp-user-demo-api/           用户侧 agent backend
  ocp-user-demo-web/           用户侧 demo UI

packages/
  ocp-schema/                  Provider <-> Catalog 协议 schema
  center-schema/               Catalog <-> Center 协议 schema
  catalog-core/                Catalog 最小编排内核
  center-core/                 Center 最小编排内核
  auth-core/                   auth helpers
  config/                      配置加载
  db/                          Drizzle schema 和 migrations
  shared/                      通用错误和工具
```

架构边界说明见 [docs/repo-architecture.md](./docs/repo-architecture.md)。

## 当前实现了什么

### 1. OCP Center

- Catalog 注册
- manifest snapshot 持久化
- catalog health / verification / refresh
- catalog search
- route hint 返回
- Center 侧索引字段抽取

### 2. Commerce Catalog

- discovery / manifest / contracts
- Provider registration versioning
- Provider active contract state
- sync capability negotiation
- object sync
- CommercialObject / DescriptorInstance / CatalogEntry 持久化
- query
  - keyword
  - filter
  - hybrid
  - semantic
- explain
- resolve 到 `ResolvableReference`

### 3. Commerce Provider

- `commerce-provider-api`
  - 商品后台 CRUD
  - seed demo products
  - register 到 catalog
  - publish-to-catalog
    - 先注册并协商 selected sync capability
    - 再按当前 active registration version 分批同步
  - sync run 审计
- `commerce-provider-admin-web`
  - Provider 管理台
  - 商品维护
  - register / publish / sync run 查看

### 4. User Demo

- `ocp-user-demo-api`
  - 真正接入 agent backend，不是只在前端写规则
  - agent 不直接把 tool raw output 返回给用户
  - agent 先消化 Center / Catalog 的返回，再转述给用户
  - 默认不自动保存 catalog profile 到本地
  - 支持多轮 refinement
- `ocp-user-demo-web`
  - 用户侧 demo UI
  - 承载对话、catalog profile 和记忆、结果展示与 resolve

### 5. Protocol Docs

- `ocp-protocol-docs-web`
  - OCP Catalog 协议文档站
  - 中英文内容
  - schema 片段展示
  - API endpoint 示例
  - 仓库实现映射

实现总览见 [docs/implementation-overview.md](./docs/implementation-overview.md)。

## 当前示例 Catalog 是什么

当前仓库里的第一个 Catalog 是一个 commerce product catalog。

它的目标不是做通用 marketplace，而是作为 OCP Catalog 的第一个垂直场景实现，承载：

- `object_type = product`
- commerce descriptor packs
- 商品搜索和 resolve
- Provider 注册与内容同步

这里的 `object_type = product` 是当前 catalog 运行时场景标签，不再是 handshake 协议里 provider registration 的匹配前提。

它的 profile 和 query capability 当前会声明：

- 支持的 query modes：`keyword`、`filter`、`hybrid`
- 开启 embedding 时还支持：`semantic`
- 支持的 query packs：
  - `ocp.commerce.product.search.v1`
  - `ocp.query.keyword.v1`
  - `ocp.query.filter.v1`
  - 可选 `ocp.query.semantic.v1`
- `supported_query_languages: ["en"]`
- `content_languages: ["en"]`

provider-facing sync capability 当前会声明：

- `ocp.push.batch`

之所以显式声明英文能力，是因为当前 catalog 内的样例商品内容主要是英文；用户侧 agent 会在需要时把中文购物意图转换成英文检索短语，再调用 catalog。

## 索引和检索机制

当前 commerce catalog 不是只有一张表加 `LIKE`。

索引链路是：

```text
CommercialObject
  -> scenario projection
  -> CatalogEntry
  -> structured filter columns
  -> search_text
  -> optional embedding rows
```

当前检索机制包括：

- 结构化过滤下推到 DB
  - `object_type`
  - `provider_id`
  - `category`
  - `brand`
  - `currency`
  - `availability_status`
- keyword 检索基于 `search_text`
- hybrid 检索会融合 keyword 和 semantic 分数
- semantic 检索使用 `pgvector`
  - `embedding_vector_pg`
  - HNSW ANN shortlist
  - exact cosine rerank

也就是说，当前语义检索已经不是“把所有向量拉回应用层再全量算 cosine”，而是：

```text
ANN shortlist -> exact cosine rerank -> final merge/rank
```

具体实现细节见 [docs/implementation-overview.md](./docs/implementation-overview.md)。

## 快速开始

### 依赖

- Bun `1.3.12`
- PostgreSQL
- `pgvector` extension

### 初始化

```bash
bun install
bun run db:migrate
```

配置参考 [.env.example](./.env.example)。

### 启动完整本地链路

```bash
bun run center:api
bun run commerce:catalog:api
bun run commerce:provider:api
bun run user:demo:api
```

如果要打开两个前端：

```bash
bun run commerce:provider:admin
bun run user:demo
bun run protocol:docs
```

默认地址：

- Catalog API: `http://localhost:4000`
- Center API: `http://localhost:4100`
- Provider API: `http://localhost:4200`
- User Demo API: `http://localhost:4230`
- Provider Admin Web: `http://localhost:4210`
- User Demo Web: `http://localhost:4220`
- Protocol Docs Web: `http://localhost:5173`（若端口被占用会顺延）

## 按服务启动

如果你不需要整套链路，可以按 5 个服务视角选择性启动：

### 1. 只启动协议文档站

```bash
bun run --cwd apps/ocp-protocol-docs-web build
bun run protocol:docs
```

`ocp-protocol-docs-web` 是纯静态站，不依赖后端服务。

### 2. 只启动 Catalog + Center

```bash
bun run center:api
bun run commerce:catalog:api
```

适合验证 `Catalog -> Center` 注册与发现链路。

### 3. 启动 Provider 配套单元

```bash
bun run commerce:provider:api
bun run commerce:provider:admin
```

适合维护商品、注册到 Catalog、执行同步。

### 4. 启动 User Demo 配套单元

```bash
bun run user:demo:api
bun run user:demo
```

适合验证用户侧 agent 对 OCP Catalog 的消费链路。

## 验证脚本

```bash
bun run validate:mvp
bun run validate:center
```

`validate:mvp` 覆盖 Provider -> Catalog 主链路。  
`validate:center` 覆盖 Catalog -> Center 主链路。

## 常用命令

```bash
bun run typecheck
bun run build
bun run test
```

## 主要文档

- [docs/implementation-overview.md](./docs/implementation-overview.md)
- [docs/repo-architecture.md](./docs/repo-architecture.md)
- [docs/ocp_catalog_center_protocol_v1.md](./docs/ocp_catalog_center_protocol_v1.md)
- [docs/ocp_catalog_handshake_protocol_v1.md](./docs/ocp_catalog_handshake_protocol_v1.md)
- [docs/design_v2.md](./docs/design_v2.md)
