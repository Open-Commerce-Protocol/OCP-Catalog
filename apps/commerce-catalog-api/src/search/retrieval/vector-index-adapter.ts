export type VectorIndexProfile = {
  vectorProviderId: string;
  indexName: string;
  embeddingProviderId: string;
  embeddingModel: string;
  embeddingDimension: number;
};

export type VectorIndexQueryInput = {
  catalogId: string;
  queryVector: number[];
  limit: number;
  rerankLimit?: number;
  oversampleFactor?: number;
  documentIds?: string[];
};

export type VectorIndexMatch = {
  documentId: string;
  score: number;
};

export type VectorIndexQueryResult = {
  profile: VectorIndexProfile;
  matches: VectorIndexMatch[];
};

export type VectorIndexHealth = {
  profile: VectorIndexProfile;
  available: boolean;
};

export interface VectorIndexAdapter {
  readonly profile: VectorIndexProfile;
  query(input: VectorIndexQueryInput): Promise<VectorIndexQueryResult>;
  health(): Promise<VectorIndexHealth>;
}
