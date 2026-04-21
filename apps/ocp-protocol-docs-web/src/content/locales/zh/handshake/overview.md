# Handshake 概览

`ocp.catalog.handshake.v1` 是 Provider 和 Catalog 节点之间的最小握手层。

## 它覆盖什么

这个包定义了：

- catalog manifest discovery
- object contract
- provider registration
- 通用 commercial object 包络
- registration feedback

## 它不覆盖什么

这个包**不**冻结：

- object sync 请求包络
- catalog query 请求包络
- resolve 请求包络
- Center 注册

这些内容当前仍由仓库里的运行时 schema 管理，后续可以继续拆成单独协议包。

## 它回答的核心问题

Handshake 层主要回答三件事：

1. 这个 Catalog 是谁
2. 它接受什么对象
3. Provider 应该如何声明自己的供给能力

## 包内主要对象

```text
CatalogManifest
ObjectContract
ProviderRegistration
CommercialObject
RegistrationResult
FieldRef
FieldRule
```

## 示例流程

```text
GET /.well-known/ocp-catalog
-> 获取 manifest
-> 检查 contracts
-> POST provider registration
-> 获得 registration result
-> 开始 object sync
```

## 搜索能力的表达方式

在 `CatalogManifest` 中，搜索能力的主要表达方式是 `query_packs`。

```json
{
  "capability_id": "commerce_product_search",
  "target_object_types": ["commerce.product"],
  "query_packs": [
    {
      "pack_id": "ocp.commerce.product.search.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"],
          "content_languages": ["en"]
        }
      }
    }
  ]
}
```

这个结构是有意的：

- `query_packs` 表达“怎么搜”
- `query_modes` 附属于某个 pack
- 额外提示统一进 `metadata`
