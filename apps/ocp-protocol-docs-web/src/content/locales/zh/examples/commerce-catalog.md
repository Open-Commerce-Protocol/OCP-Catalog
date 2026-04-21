# 电商目录示例（Commerce Catalog Example）

这个仓库实现了一个具体场景 catalog：commerce product catalog。

## 目录画像

当前 catalog profile 围绕这些点构建：

- `product`
- 一个主 product-search capability
- `query_packs` 作为主搜索契约
- 在 metadata 中暴露 language hints
- 一个 live provider-facing sync capability：`ocp.push.batch`

## 对象契约示例

当前 commerce catalog 接受一个 object contract：

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title"
  ],
  "optional_fields": [
    "ocp.commerce.price.v1#/amount",
    "ocp.commerce.inventory.v1#/availability_status"
  ],
  "additional_fields_policy": "allow"
}
```

这就是 provider 必须满足的真实 contract 边界。

## 最小注册成功条件

在当前仓库里，一个 provider 只有在能声明以下内容时才能注册成功：

- `guaranteed_fields` 包含 `ocp.commerce.product.core.v1#/title`
- `sync.preferred_capabilities` 或 `sync.avoid_capabilities_unless_necessary` 与 catalog 的 `sync_capabilities` 有交集

## 已发布的同步能力

当前 live manifest 发布的是：

```json
{
  "capability_id": "ocp.push.batch",
  "direction": "provider_to_catalog",
  "transport": "http_push",
  "object_types": [],
  "sync_model": {
    "snapshot": true,
    "delta": false,
    "stream": false
  },
  "mutation_semantics": {
    "upsert": true,
    "delete": true
  }
}
```

## 同步路径

当前验证过的交互是：

```text
ProviderRegistration.sync.preferred_capabilities = ["ocp.push.batch"]
  -> provider 注册
  -> RegistrationResult.selected_sync_capability = ocp.push.batch
  -> provider 发送 batched object sync request
```

像 `ocp.feed.url` 这样的保留能力，应在对应 pull 实现完成后再出现在 runtime manifest 里。

## 索引策略

当前 commerce catalog 使用分层索引：

1. descriptor projection into catalog entries
2. Postgres structured filter columns
3. keyword search text
4. semantic embedding vectors
5. `pgvector` HNSW shortlist + exact cosine rerank

## 为什么这很重要

协议文档描述了 catalog 的 shape，而这个示例 catalog 则展示了真实实现如何暴露：

- language hints
- semantic capability hints
- filterable field hints
- resolve support
- provider registration 所需的具体 contract
- 显式 sync capability negotiation
