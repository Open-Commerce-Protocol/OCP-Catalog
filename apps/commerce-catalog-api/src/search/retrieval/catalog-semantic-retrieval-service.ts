import type { EmbeddingProvider } from '../indexing/search-embedding-service';
import type { VectorIndexAdapter } from './vector-index-adapter';

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
}

export class CatalogSemanticRetrievalService implements CatalogSemanticRetriever {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorIndex: VectorIndexAdapter,
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
}
