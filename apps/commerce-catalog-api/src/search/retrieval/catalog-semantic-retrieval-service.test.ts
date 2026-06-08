import { describe, expect, test } from 'bun:test';
import type { EmbeddingProvider, EmbeddingResult } from '../indexing/search-embedding-service';
import { CatalogSemanticRetrievalService } from './catalog-semantic-retrieval-service';
import type { QueryEmbeddingCache } from './query-embedding-cache';
import type { VectorIndexAdapter, VectorIndexQueryInput } from './vector-index-adapter';

describe('CatalogSemanticRetrievalService', () => {
  test('embeds the query and delegates vector search to the configured adapter', async () => {
    const queries: VectorIndexQueryInput[] = [];
    const service = new CatalogSemanticRetrievalService(
      embeddingProvider({ vector: [1, 0, 0], model: 'test-model', dimension: 3 }),
      vectorAdapter({
        embeddingModel: 'test-model',
        embeddingDimension: 3,
        query: async (input) => {
          queries.push(input);
          return {
            profile: testVectorProfile({ embeddingModel: 'test-model', embeddingDimension: 3 }),
            matches: [
              { documentId: 'sdoc_1', score: 0.91 },
              { documentId: 'sdoc_2', score: 0.72 },
            ],
          };
        },
      }),
    );

    const result = await service.nearestNeighbors({
      catalogId: 'cat_test',
      query: 'travel headphones',
      limit: 2,
      rerankLimit: 8,
      oversampleFactor: 4,
      documentIds: ['sdoc_1', 'sdoc_2'],
    });

    expect(queries).toEqual([{
      catalogId: 'cat_test',
      queryVector: [1, 0, 0],
      limit: 2,
      rerankLimit: 8,
      oversampleFactor: 4,
      documentIds: ['sdoc_1', 'sdoc_2'],
    }]);
    expect(result).toEqual(new Map([
      ['sdoc_1', 0.91],
      ['sdoc_2', 0.72],
    ]));
  });

  test('rejects embedding output that does not match the vector index profile', async () => {
    const service = new CatalogSemanticRetrievalService(
      embeddingProvider({ vector: [1, 0], model: 'wrong-model', dimension: 2 }),
      vectorAdapter({ embeddingModel: 'test-model', embeddingDimension: 3 }),
    );

    await expect(service.nearestNeighbors({
      catalogId: 'cat_test',
      query: 'travel headphones',
      limit: 2,
    })).rejects.toThrow('does not match vector index');
  });

  test('does not call the vector adapter for empty semantic input', async () => {
    let queryCount = 0;
    const service = new CatalogSemanticRetrievalService(
      embeddingProvider({ vector: [1, 0, 0], model: 'test-model', dimension: 3 }),
      vectorAdapter({
        embeddingModel: 'test-model',
        embeddingDimension: 3,
        query: async () => {
          queryCount += 1;
          throw new Error('query should not be called');
        },
      }),
    );

    const result = await service.nearestNeighbors({
      catalogId: 'cat_test',
      query: '   ',
      limit: 2,
    });

    expect(queryCount).toBe(0);
    expect(result.size).toBe(0);
  });

  test('fails loud when query embedding cache read fails', async () => {
    let embedCount = 0;
    const service = new CatalogSemanticRetrievalService(
      {
        ...embeddingProvider({ vector: [1, 0, 0], model: 'test-model', dimension: 3 }),
        async embed() {
          embedCount += 1;
          throw new Error('embed should not be called after cache failure');
        },
      },
      vectorAdapter({ embeddingModel: 'test-model', embeddingDimension: 3 }),
      failingCache('redis unavailable'),
    );

    await expect(service.nearestNeighbors({
      catalogId: 'cat_test',
      query: 'travel headphones',
      limit: 2,
    })).rejects.toThrow('redis unavailable');
    expect(embedCount).toBe(0);
  });
});

function embeddingProvider(output: EmbeddingResult): EmbeddingProvider {
  return {
    providerId: 'test-embedding-provider',
    model: output.model,
    dimension: output.dimension,
    async embed() {
      return output;
    },
  };
}

function vectorAdapter(input: {
  embeddingModel: string;
  embeddingDimension: number;
  query?: VectorIndexAdapter['query'];
}): VectorIndexAdapter {
  const profile = testVectorProfile(input);
  return {
    profile,
    async query(queryInput) {
      if (input.query) return input.query(queryInput);
      return { profile, matches: [] };
    },
    async health() {
      return { profile, available: true };
    },
  };
}

function testVectorProfile(input: { embeddingModel: string; embeddingDimension: number }) {
  return {
    vectorProviderId: 'test-vector-provider',
    indexName: 'test-vector-index',
    embeddingProviderId: 'test-embedding-provider',
    embeddingModel: input.embeddingModel,
    embeddingDimension: input.embeddingDimension,
  };
}

function failingCache(message: string): QueryEmbeddingCache {
  return {
    async get() {
      throw new Error(message);
    },
    async set() {
      throw new Error('set should not be called');
    },
  };
}
