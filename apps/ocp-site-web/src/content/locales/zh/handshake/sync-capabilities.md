# 同步能力（Sync Capabilities）

`SyncCapability` 是 Catalog 和 Provider 之间正式的同步协商面。

## 它定义什么

`SyncCapability` 用来定义 Catalog 与 Provider 之间可协商的同步能力。

它可以表达：

- snapshot / delta / stream
- mutation semantics
- batching limits
- endpoint ownership
- endpoint field requirements
- 未来的 bootstrap 或 auth 细节

## Catalog 侧

Catalog 在这里发布 sync capabilities：

```text
CatalogManifest.provider_contract.sync_capabilities[]
```

每个 capability 都通过 `capability_id` 参与匹配。

## Provider 侧

Provider 在这里声明自己的同步意图：

```text
ProviderRegistration.object_declarations[].sync
```

这个声明面刻意保持很小：

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

如果一个 capability 没出现在这两个 capability 列表里，说明这个 provider declaration 没有声明它参与协商。

## 示例同步路径

当前 commerce provider 和 catalog 示例协商的是：

```json
{
  "preferred_capabilities": ["ocp.push.batch"],
  "avoid_capabilities_unless_necessary": [],
  "provider_endpoints": {}
}
```

Catalog 随后返回：

```json
{
  "selected_sync_capability": {
    "capability_id": "ocp.push.batch",
    "reason": "provider_preferred_and_supported_by_catalog"
  }
}
```

示例运行路径如下：

```text
register
-> selected_sync_capability = ocp.push.batch
-> provider 发送 batched ObjectSyncRequest payload
```

## 预留能力说明

### `ocp.feed.url`

只有当 Catalog 能主动拉取 provider-hosted feed 时，才应该使用它。

实现要求：

- provider 声明 `provider_endpoints.feed_url.url`
- catalog 具备 fetch scheduler
- catalog 能处理 snapshot replacement、retry 和 checksum/etag 逻辑

### `ocp.pull.api`

只有当 Catalog 能直接调用 Provider API 时，才应该使用它。

实现要求：

- provider 暴露 pull endpoint 与分页/游标契约
- catalog 具备 API client、鉴权处理和增量状态跟踪

### `ocp.streaming`

只有当 Catalog 能消费连续变更流时，才应该使用它。

实现要求：

- provider 暴露稳定的 streaming channel 或 webhook 合约
- catalog 具备 reconnect、checkpoint、replay 和幂等消费逻辑

## `provider_endpoints` 形状

`provider_endpoints` 是 endpoint map，不是 bare string map。

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

把 URL 包装成对象后，可以继续扩展 auth override、content type、refresh hint、checksum URL、webhook callback 或 bootstrap metadata。
