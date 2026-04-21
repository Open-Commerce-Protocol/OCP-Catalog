# Commerce Catalog 示例

当前仓库实现了一个具体的 catalog 场景：电商商品 catalog。

## Catalog Profile

当前 catalog profile 围绕这些能力构建：

- `commerce.product`
- 一个主要的 product-search capability
- 使用 `query_packs` 作为主要搜索契约
- 内容以英文为主，并通过 metadata 暴露语言提示

## Query Pack 示例

```json
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
```

## 索引策略

当前 commerce catalog 采用分层索引：

1. 把 descriptor 投影到 catalog entry
2. 在 Postgres 中存结构化 filter 列
3. 保存标准化 search text 用于 keyword 检索
4. 保存 embedding 向量用于 semantic 检索
5. 使用 `pgvector` HNSW shortlist，再做 exact cosine rerank

## 为什么这个例子重要

协议只规定了 catalog 的外部形状，而这个示例进一步说明了真实实现如何暴露：

- 语言提示
- 语义检索提示
- 可过滤字段提示
- resolve 支持
