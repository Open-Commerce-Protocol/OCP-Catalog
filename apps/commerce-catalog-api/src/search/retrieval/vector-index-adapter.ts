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

export type TextIndexQueryInput = {
  catalogId: string;
  query: string;
  limit: number;
  filters?: {
    providerId?: string;
    category?: string;
    brand?: string;
    currency?: string;
    availabilityStatus?: string;
    sku?: string;
    hasImage?: boolean;
    inStockOnly?: boolean;
    minAmount?: number;
    maxAmount?: number;
  };
};

export type VectorIndexDocument = {
  documentId: string;
  catalogId: string;
  providerId: string;
  objectType: string;
  embeddingVector: number[];
  embeddingTextHash: string;
};

export type TextIndexDocument = {
  documentId: string;
  catalogId: string;
  providerId: string;
  objectId: string;
  objectType: string;
  title: string;
  summary: string | null;
  searchText: string;
  documentStatus: 'pending' | 'active' | 'inactive' | 'stale' | 'failed';
  normalizedBrand: string;
  normalizedCategory: string;
  normalizedSku: string;
  currency: string | null;
  availabilityStatus: string | null;
  amount: number | null;
  hasImage: boolean;
  qualityRank: number;
  availabilityRank: number;
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

export interface WritableVectorIndexAdapter extends VectorIndexAdapter {
  ensureIndex(): Promise<void>;
  upsert(input: VectorIndexDocument): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export interface TextSearchIndexAdapter {
  searchText(input: TextIndexQueryInput): Promise<VectorIndexMatch[]>;
}

export interface WritableTextSearchIndexAdapter extends TextSearchIndexAdapter {
  upsertText(input: TextIndexDocument): Promise<void>;
}

export interface BulkWritableTextSearchIndexAdapter extends WritableTextSearchIndexAdapter {
  bulkUpsertText(input: TextIndexDocument[]): Promise<void>;
}
