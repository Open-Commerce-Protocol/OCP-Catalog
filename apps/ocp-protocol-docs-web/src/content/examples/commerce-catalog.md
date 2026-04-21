# Commerce Catalog Example

This repository implements one concrete catalog scenario: a commerce product catalog.

## Catalog Profile

The current catalog profile is shaped around:

- `commerce.product`
- one main product-search capability
- `query_packs` as the primary search contract
- English-first content with language hints in metadata

## Query Pack Example

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

## Indexing Strategy

The commerce catalog currently uses a layered index:

1. descriptor projection into catalog entries
2. structured filter columns in Postgres
3. normalized search text for keyword search
4. embedding vectors for semantic search
5. `pgvector` HNSW shortlist plus exact cosine rerank

## Why This Matters

The protocol documents the shape of the catalog, but the example catalog also shows how a real implementation can expose:

- language hints
- semantic capability hints
- filterable field hints
- resolve support
