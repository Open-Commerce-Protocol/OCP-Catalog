# Implementation Overview

本文档描述当前仓库已经实现的内容，而不是未来设计目标。

如果你想看长期协议设计，读 [design_v2.md](./design_v2.md)。  
如果你想看当前仓库真实可跑的实现，读本文。

## 0. 当前服务模型

从运行和部署视角看，当前项目可以理解为 5 个服务：

1. `ocp-center-api`
2. `commerce-catalog-api`
3. `commerce-provider`
   - `commerce-provider-api`
   - `commerce-provider-admin-web`
4. `ocp-user-demo`
   - `ocp-user-demo-api`
   - `ocp-user-demo-web`
5. `ocp-protocol-docs-web`

其中 `commerce-provider` 和 `ocp-user-demo` 在代码上各拆成前后端两个 app，但运行语义上分别属于一个配套单元。

## 1. 当前完成的闭环

### 1.1 Catalog -> Center

已完成：

- Catalog 注册到 Center
- Center 拉取 catalog manifest
- Center 保存 manifest snapshot
- Center 构建 catalog 索引
- Center 返回 route hint

这条链路的意义是：

- 用户侧或 agent 不需要预先知道具体 catalog 地址
- 先从 Center 找“应该用哪个 catalog”
- 再使用 route hint 中暴露的 query / resolve 入口

### 1.2 Provider -> Catalog

已完成：

- Provider 发现 catalog
- Provider 获取 manifest / contracts
- Provider 提交 registration
- Catalog 建立 active provider contract state
- Provider 分批同步 `CommercialObject`
- Catalog 校验 descriptor packs 和 required fields
- Catalog 写入对象、投影、embedding 和 resolve reference 相关数据

这条链路是当前仓库的内容生产主链路。

### 1.3 User / Agent -> Center -> Catalog

已完成：

- 用户侧 agent 检查本地已保存的 catalog profiles
- 本地为空时到 Center 搜索 catalog
- 用户确认后再把 catalog profile 保存到本地
- agent 获得在该 catalog 上继续 query 的许可
- agent 调用 catalog query
- agent 返回候选项
- agent 可继续 resolve 并跳转到 provider 商品详情

这里有两个明确约束：

- 默认不自动把 catalog 注册到本地
- tool 返回不会直接原样展示给用户，而是先由 agent 消化后再转述

## 2. 当前示例 Catalog

当前仓库只实现了一个垂直场景 catalog：commerce product catalog。

它不是 OCP 内核本身，而是第一个场景实现，放在：

- [apps/commerce-catalog-api](D:/workspace/ts/ocp-catalog-demo/apps/commerce-catalog-api)

### 2.1 支持的对象

- `object_type = product`

### 2.2 使用的 descriptor packs

当前围绕商品场景使用的 pack 主要包括：

- `ocp.commerce.product.core.v1`
- `ocp.commerce.price.v1`
- `ocp.commerce.inventory.v1`

### 2.3 当前 catalog profile / query capability

当前 commerce catalog 会在 manifest 里声明：

- `ocp.commerce.product.search.v1`
- `ocp.query.keyword.v1`
- `ocp.query.filter.v1`
- 开启 embedding 时再声明 `ocp.query.semantic.v1`

支持的 query modes：

- `keyword`
- `filter`
- `hybrid`
- 可选 `semantic`

实现位置：

- [commerce-scenario.ts](D:/workspace/ts/ocp-catalog-demo/apps/commerce-catalog-api/src/commerce-scenario.ts)

### 2.4 当前语言能力声明

当前 profile 和 Center route hint 会显式声明：

- `supported_query_languages: ["en"]`
- `content_languages: ["en"]`

这是有意设计，不是文档装饰。

原因是当前样例商品内容主要为英文，catalog 的检索质量也主要围绕英文构建。用户如果用中文提问，用户侧 agent 会先把购物意图转成适合该 catalog 的英文检索短语，再调用 query。

## 3. 索引机制

当前 catalog 的索引机制分三层：structured filter、keyword、semantic。

### 3.1 对象到索引投影

写入链路：

```text
CommercialObject
  -> Descriptor validation
  -> scenario projection
  -> CatalogEntry
  -> search/filter columns
  -> optional embedding row
```

关键表包括：

- `commercial_objects`
- `descriptor_instances`
- `catalog_entries`
- `catalog_entry_embeddings`

DB schema 在：

- [catalog.ts](D:/workspace/ts/ocp-catalog-demo/packages/db/src/schema/catalog.ts)

### 3.2 Structured filter

当前 `catalog_entries` 已去规范化出过滤字段，直接用于 DB 筛选：

- `object_type`
- `provider_id`
- `category`
- `brand`
- `currency`
- `availability_status`

这意味着后续数据量变大时，query 不需要先把对象全拉出来再在应用层过滤。

### 3.3 Keyword

keyword path 使用 `search_text` 和应用层 scoring。

当前做法是：

- 先在 DB 里通过过滤条件和 `search_text` 收缩候选集
- 再在应用层做标题和文本匹配评分

实现位置：

- [query-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/catalog-core/src/query-service.ts)

### 3.4 Semantic

当前 semantic path 已经接入 `pgvector`，不是只存一份 JSON 向量。

当前实现：

- `catalog_entry_embeddings.embedding_vector_pg`
- HNSW ANN 索引
- ANN shortlist
- exact cosine rerank
- 与 keyword/filter 结果合并排序

当前 migration 已为两种维度建了 HNSW 索引：

- `vector(64)`，给本地 hash embedding
- `vector(1024)`，给当前 `text-embedding-v4`

实现位置：

- [embedding-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/catalog-core/src/embedding-service.ts)
- [query-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/catalog-core/src/query-service.ts)
- [0006_center_languages_and_pgvector.sql](D:/workspace/ts/ocp-catalog-demo/packages/db/migrations/0006_center_languages_and_pgvector.sql)

当前语义检索流程：

```text
query text
  -> embed query
  -> ANN shortlist from pgvector HNSW
  -> exact cosine rerank on shortlist
  -> merge with keyword/filter candidates
  -> final score
```

### 3.5 当前阶段的限制

虽然已经做了 ANN shortlist + rerank，但当前仍然有几个现实边界：

- 样例数据量还很小，Planner 可能仍然偏向顺扫
- 目前只对已知维度建了 HNSW 索引
- semantic 仍是单 catalog 内检索，不包含 cross-catalog federation ranking
- 当前还没有更复杂的业务重排特征，如 provider trust、freshness boost、inventory priority

## 4. Center 侧索引内容

当前 Center 不是在索引商品，而是在索引 catalog metadata。

Center 会抽取并建立索引的信息包括：

- catalog name
- tags
- supported object types
- supported query packs
- supported query modes
- supported query languages
- content languages
- supports resolve
- route hint endpoints

也就是说，Center 回答的是：

> 应该用哪个 catalog

而 Catalog 回答的是：

> 这个 catalog 里有哪些对象

## 5. Provider 配套单元实现了什么

当前 provider 不是一次性 demo script，而是一个完整配套单元：

- [apps/commerce-provider-api](D:/workspace/ts/ocp-catalog-demo/apps/commerce-provider-api)
- [apps/commerce-provider-admin-web](D:/workspace/ts/ocp-catalog-demo/apps/commerce-provider-admin-web)

已实现：

- `commerce-provider-api`
  - 商品后台 CRUD
  - demo 商品 seed
  - provider status 查看
  - register-to-catalog
  - sync-product
  - sync-to-catalog
  - publish-to-catalog

其中 `publish-to-catalog` 是当前推荐工作流：

```text
register -> active version confirmed -> batched sync
```

这样可以避免 register 和 sync 的时序竞争。

- `commerce-provider-admin-web`
  - 商品管理页面
  - 后台增删改查
  - register / publish / sync runs 操作入口

## 6. User Demo 与 agent

用户侧 demo 由一个配套单元组成：

- [apps/ocp-user-demo-api](D:/workspace/ts/ocp-catalog-demo/apps/ocp-user-demo-api)
- [apps/ocp-user-demo-web](D:/workspace/ts/ocp-catalog-demo/apps/ocp-user-demo-web)

### 6.1 已完成的交互

```text
用户说需求
  -> agent 查本地 catalog memory
  -> 为空则到 Center 找 catalog
  -> 用户确认是否注册到本地
  -> agent 保存本地 catalog profile
  -> agent 调用 Catalog query
  -> 返回候选项
  -> agent 可继续 refinement / resolve
```

### 6.2 当前约束

- agent 不直接暴露 raw tool result
- agent 默认不替用户自动保存 catalog
- 当前用户 demo 仍是单用户、本地 memory、单 catalog 选择模型

## 6.3 Protocol Docs

协议文档站位于：

- [apps/ocp-protocol-docs-web](D:/workspace/ts/ocp-catalog-demo/apps/ocp-protocol-docs-web)

它是纯静态前端，不依赖业务 API。当前已实现：

- 中英文协议正文
- schema fragment 展示
- API endpoint 示例
- 仓库实现映射
- 协议设计原则页面

## 7. 当前完成的 OCP 链路总结

如果按链路而不是按 app 看，当前仓库已经完成：

### 7.1 Catalog 生产链

```text
Provider -> Catalog
  registration
  active contract state
  object sync
  projection
  indexing
```

### 7.2 Catalog 消费链

```text
User / Agent -> Catalog
  query
  explain
  resolve
  action binding
```

### 7.3 Catalog 发现链

```text
Catalog -> Center
  register
  refresh
  search
  route hint
```

### 7.4 用户侧跨节点链

```text
User / Agent
  -> local catalog memory
  -> Center
  -> chosen Catalog
  -> query
  -> resolve
```

## 8. 当前没有完成的内容

下面这些仍未完成，或者只做了最小实现：

- 多 catalog 聚合和 federation query
- 完整权限系统
- field-level visibility policy
- provider / catalog 运营侧 agent tools
- MCP 服务层
- ACP / UCP adapter
- 更完整的 ANN tuning 和更大规模 benchmark
- 多场景 catalog，不止 commerce

## 9. 读代码时的入口建议

如果你想从代码理解仓库，建议按这个顺序读：

1. [README.md](D:/workspace/ts/ocp-catalog-demo/README.md)
2. [docs/repo-architecture.md](D:/workspace/ts/ocp-catalog-demo/docs/repo-architecture.md)
3. [commerce-scenario.ts](D:/workspace/ts/ocp-catalog-demo/apps/commerce-catalog-api/src/commerce-scenario.ts)
4. [query-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/catalog-core/src/query-service.ts)
5. [embedding-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/catalog-core/src/embedding-service.ts)
6. [catalog-registry-service.ts](D:/workspace/ts/ocp-catalog-demo/packages/center-core/src/catalog-registry-service.ts)
