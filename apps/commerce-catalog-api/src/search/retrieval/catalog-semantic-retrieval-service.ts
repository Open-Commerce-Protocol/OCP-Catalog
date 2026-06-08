import type { EmbeddingProvider } from '../indexing/search-embedding-service';
import type { TextIndexQueryInput, TextSearchIndexAdapter, VectorIndexAdapter, VectorIndexMatch } from './vector-index-adapter';

export type SemanticRetrievalQuery = {
  catalogId: string;
  query: string;
  limit: number;
  rerankLimit?: number;
  oversampleFactor?: number;
  documentIds?: string[];
};

export interface CatalogSemanticRetriever {
  nearestNeighbors(input: SemanticRetrievalQuery): Promise<Map<string, number>>;
  searchText?(input: TextIndexQueryInput): Promise<VectorIndexMatch[]>;
}

export class CatalogSemanticRetrievalService implements CatalogSemanticRetriever {
  private readonly queryEmbeddingCache = new Map<string, {
    expiresAt: number;
    vector: number[];
    model: string;
    dimension: number;
  }>();
  private readonly inFlightQueryEmbeddings = new Map<string, Promise<{
    vector: number[];
    model: string;
    dimension: number;
  }>>();
  private readonly queryEmbeddingCacheTtlMs = 10 * 60 * 1000;
  private readonly queryEmbeddingCacheMaxEntries = 5000;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorIndex: VectorIndexAdapter & Partial<TextSearchIndexAdapter>,
  ) {}

  async nearestNeighbors(input: SemanticRetrievalQuery) {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery || input.limit <= 0) return new Map<string, number>();

    const queryEmbedding = await this.embedQuery(normalizedQuery);
    if (
      queryEmbedding.model !== this.vectorIndex.profile.embeddingModel ||
      queryEmbedding.dimension !== this.vectorIndex.profile.embeddingDimension
    ) {
      throw new Error(
        `embedding provider ${this.provider.providerId}/${queryEmbedding.model}/${queryEmbedding.dimension} does not match vector index ${this.vectorIndex.profile.vectorProviderId}/${this.vectorIndex.profile.embeddingProviderId}/${this.vectorIndex.profile.embeddingModel}/${this.vectorIndex.profile.embeddingDimension}`,
      );
    }

    const result = await this.vectorIndex.query({
      catalogId: input.catalogId,
      queryVector: queryEmbedding.vector,
      limit: input.limit,
      rerankLimit: input.rerankLimit,
      oversampleFactor: input.oversampleFactor,
      documentIds: input.documentIds,
    });

    return new Map(result.matches.map((match) => [match.documentId, match.score]));
  }

  async searchText(input: TextIndexQueryInput) {
    if (typeof this.vectorIndex.searchText !== 'function') return [];
    return this.vectorIndex.searchText(input);
  }

  private async embedQuery(query: string) {
    const cacheKey = `${this.provider.providerId}:${this.provider.model}:${this.provider.dimension}:${query.toLowerCase()}`;
    const now = Date.now();
    const cached = this.queryEmbeddingCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.queryEmbeddingCache.delete(cacheKey);
      this.queryEmbeddingCache.set(cacheKey, cached);
      return cached;
    }

    const inFlight = this.inFlightQueryEmbeddings.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = this.provider.embed(query)
      .then((embedding) => {
        const cachedEmbedding = {
          vector: embedding.vector,
          model: embedding.model,
          dimension: embedding.dimension,
          expiresAt: Date.now() + this.queryEmbeddingCacheTtlMs,
        };
        this.queryEmbeddingCache.set(cacheKey, cachedEmbedding);
        while (this.queryEmbeddingCache.size > this.queryEmbeddingCacheMaxEntries) {
          const oldestKey = this.queryEmbeddingCache.keys().next().value;
          if (!oldestKey) break;
          this.queryEmbeddingCache.delete(oldestKey);
        }
        return cachedEmbedding;
      })
      .finally(() => {
        this.inFlightQueryEmbeddings.delete(cacheKey);
      });

    this.inFlightQueryEmbeddings.set(cacheKey, promise);
    return promise;
  }
}
