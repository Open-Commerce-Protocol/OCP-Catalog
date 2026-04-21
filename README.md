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
  Provider 分批同步对象
  Catalog 校验、入库、建索引

User / Agent -> Center -> Catalog
  用户侧 agent 先查本地 catalog profile
  缺失时到 Center 找 catalog
  用户确认后保存本地 profile
  agent 再对 Catalog query / resolve
```

## 仓库里有什么

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

- 商品后台 CRUD
- seed demo products
- register 到 catalog
- publish-to-catalog
  - 先注册
  - 再按当前 active registration version 分批同步
- sync run 审计

### 4. User Demo

- 真正接入 agent backend，不是只在前端写规则
- agent 不直接把 tool raw output 返回给用户
- agent 先消化 Center / Catalog 的返回，再转述给用户
- 默认不自动保存 catalog profile 到本地
- 支持多轮 refinement

实现总览见 [docs/implementation-overview.md](./docs/implementation-overview.md)。

## 当前示例 Catalog 是什么

当前仓库里的第一个 Catalog 是一个 commerce product catalog。

它的目标不是做通用 marketplace，而是作为 OCP Catalog 的第一个垂直场景实现，承载：

- `object_type = product`
- commerce descriptor packs
- 商品搜索和 resolve
- Provider 注册与内容同步

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
```

默认地址：

- Catalog API: `http://localhost:4000`
- Center API: `http://localhost:4100`
- Provider API: `http://localhost:4200`
- User Demo API: `http://localhost:4230`
- Provider Admin Web: `http://localhost:4210`
- User Demo Web: `http://localhost:4220`

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
