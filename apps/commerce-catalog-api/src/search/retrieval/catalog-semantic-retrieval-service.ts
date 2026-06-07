import type { EmbeddingProvider } from '../indexing/search-embedding-service';
import type { TextIndexQueryInput, TextSearchIndexAdapter, VectorIndexAdapter } from './vector-index-adapter';

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
  searchText?(input: TextIndexQueryInput): Promise<Map<string, number>>;
}

export class CatalogSemanticRetrievalService implements CatalogSemanticRetriever {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorIndex: VectorIndexAdapter & Partial<TextSearchIndexAdapter>,
  ) {}

  async nearestNeighbors(input: SemanticRetrievalQuery) {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery || input.limit <= 0) return new Map<string, number>();

    const queryEmbedding = await this.provider.embed(normalizedQuery);
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
    if (typeof this.vectorIndex.searchText !== 'function') return new Map<string, number>();
    const matches = await this.vectorIndex.searchText(input);
    return new Map(matches.map((match) => [match.documentId, match.score]));
  }
}
