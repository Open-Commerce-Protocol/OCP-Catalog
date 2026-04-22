# Center 流程

这一页描述的是当前仓库里真实存在的 `Catalog -> Center` 运行链路。

## 真实生命周期

```text
catalog admin 提交 CatalogRegistration
-> Center 校验 center_id 和 registration_version
-> Center 拉取 /.well-known/ocp-catalog 与 catalog manifest
-> Center 校验拉取到的身份信息、endpoint 与 domain 一致性
-> Center 对 catalog query endpoint 做健康检查
-> Center 落 registration record 和 manifest snapshot
-> 如果是 localhost，Center 会自动验证并立即建索引
-> 否则 Center 会生成 verification challenge，等待 verify
-> verify 成功后，Center 会索引 active snapshot，并且可以下发 catalog_access_token
-> 后续 refresh 会重新拉 discovery / manifest，并更新 active snapshot
```

## 当前实现实际会持久化什么

当前 Center runtime 不是只存一条 registration 行，而是会分层持久化：

- `catalog_registration_records`
- `registered_catalogs`
- `catalog_manifest_snapshots`
- `catalog_index_entries`
- `catalog_verification_records`
- `catalog_health_checks`
- `catalog_search_audit_records`

这样拆分很重要，因为当前运行时明确把 registration 历史、active catalog 状态、snapshot、搜索索引、verification 和 health 当成相关但不同的生命周期对象。

## 当前仓库里的 registration 状态

对于一个 `catalog_id`，当前实现会区分几种运行时结果：

- `stale_ignored`
  registration 被记录了，但它的 `registration_version` 没有覆盖当前 active 版本。
- `accepted_pending_verification`
  registration 和 snapshot 已经被接受，但 catalog 还没有进入可供 Center 普通搜索的索引状态。
- `accepted_indexed`
  catalog 已经拥有 active indexed snapshot。

这里有两个当前实现层面的关键行为：

- localhost catalog 会被自动验证，并且可以立即索引
- 非 localhost catalog 会先收到 verification challenge，之后才会进入 indexed 状态

## Verification、Token 与 Refresh 行为

当前实现里还有一条明确的控制面流程：

- `verify` 会检查待处理的 DNS TXT 或 HTTPS well-known challenge
- verification 成功后会提升 trust 状态，并索引 active snapshot
- 如果 catalog 进入 indexed 状态时还没有 token，Center 会下发 `catalog_access_token`
- `refresh` 和 `token/rotate` 都要求带这个 catalog token
- refresh scheduler 只会扫描已经 `verified` 且 `accepted_indexed` 的 catalog

所以在当前仓库里，verification 不只是 trust metadata；它也是很多 catalog 进入 Center searchable index 的门槛。

## Health 与 Indexing

当前 Center 不把 health 当成一个被动展示字段，而是会主动调用 catalog 的 query endpoint 并记录结果。

这个 health 状态会继续影响：

- 新注册 catalog 能否立即建索引
- refresh 后的新 snapshot 是否仍然可索引
- route hint 里返回的 trust / health 信息

## 当前仓库里的真实示例

当前 workspace 里已经验证过的路径是：

```text
catalog admin 提交 CatalogRegistration
-> Center 拉取 catalog discovery document
-> Center 拉取 manifest
-> Center 发送一个最小的 POST /ocp/query health probe
-> Center 落 registration + snapshot
-> localhost demo catalog 被自动验证
-> Center 写入 catalog_index_entries
-> user-side agent 之后就可以通过 Center search 找到这个 catalog
-> 后续 refresh 会重新拉 manifest，并更新 active snapshot
```

## 为什么这个示例重要

这条 Center flow 已经不只是 schema 演示：

- registration 是有版本和状态流转的
- snapshot 是一等运行时对象
- verification、indexing 和 token issuance 是连在一起的
- Center search 运行在内部 catalog metadata index 上，而不是直接扫远端 catalog
- route hint 来源于 active indexed snapshot，而不只是未验证的 registration 输入
