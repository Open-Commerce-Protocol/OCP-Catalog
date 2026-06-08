import type { AppConfig } from '@ocp-catalog/config';
import type {
  TextIndexDocument,
  TextIndexQueryInput,
  BulkWritableTextSearchIndexAdapter,
  BulkWritableVectorIndexAdapter,
  VectorIndexDocument,
  VectorIndexHealth,
  VectorIndexMatch,
  VectorIndexProfile,
  VectorIndexQueryInput,
  VectorIndexQueryResult,
  WritableTextSearchIndexAdapter,
  WritableVectorIndexAdapter,
} from './vector-index-adapter';

type OpenSearchHit = {
  _id?: string;
  _score?: number;
  _source?: {
    document_id?: string;
    catalog_entry_id?: string;
    commercial_object_id?: string;
    catalog_id?: string;
    provider_id?: string;
    object_id?: string;
    object_type?: string;
    document_status?: 'pending' | 'active' | 'inactive' | 'stale' | 'failed';
    title?: string;
    summary?: string | null;
    search_text?: string;
    visible_attributes_payload?: Record<string, unknown>;
  };
};

type OpenSearchSearchResponse = {
  hits?: {
    hits?: OpenSearchHit[];
  };
};

export class OpenSearchVectorIndexAdapter implements BulkWritableVectorIndexAdapter, BulkWritableTextSearchIndexAdapter {
  readonly profile: VectorIndexProfile;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly engine: 'lucene' | 'faiss';
  private readonly m: number;
  private readonly efConstruction: number;
  private ensureIndexPromise: Promise<void> | null = null;

  constructor(config: AppConfig, profile: VectorIndexProfile) {
    this.profile = profile;
    this.baseUrl = config.OPENSEARCH_URL.replace(/\/$/, '');
    this.username = config.OPENSEARCH_USERNAME;
    this.password = config.OPENSEARCH_PASSWORD;
    this.timeoutMs = config.OPENSEARCH_TIMEOUT_MS;
    this.engine = config.OPENSEARCH_KNN_ENGINE;
    this.m = config.OPENSEARCH_KNN_M;
    this.efConstruction = config.OPENSEARCH_KNN_EF_CONSTRUCTION;
  }

  async ensureIndex() {
    if (!this.ensureIndexPromise) {
      this.ensureIndexPromise = this.createIndexIfMissing();
    }
    return this.ensureIndexPromise;
  }

  async upsert(input: VectorIndexDocument) {
    await this.ensureIndex();
    this.assertVectorDimension(input);

    await this.updateDocument(input.documentId, this.toVectorDocument(input));
  }

  async bulkUpsert(input: VectorIndexDocument[]) {
    await this.ensureIndex();
    if (input.length === 0) return;
    for (const document of input) this.assertVectorDimension(document);

    const body = input
      .flatMap((document) => [
        {
          update: {
            _index: this.profile.indexName,
            _id: document.documentId,
          },
        },
        {
          doc: this.toVectorDocument(document),
          doc_as_upsert: true,
        },
      ])
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n';
    const response = await this.request<{ errors?: boolean; items?: unknown[] }>('/_bulk', {
      method: 'POST',
      rawBody: body,
      contentType: 'application/x-ndjson',
    });
    if (response?.errors) {
      throw new Error(`OpenSearch bulk vector upsert failed for ${input.length} document(s)`);
    }
  }

  async upsertText(input: TextIndexDocument) {
    await this.ensureIndex();
    await this.updateDocument(input.documentId, this.toTextDocument(input));
  }

  async bulkUpsertText(input: TextIndexDocument[]) {
    await this.ensureIndex();
    if (input.length === 0) return;

    const body = input
      .flatMap((document) => [
        {
          update: {
            _index: this.profile.indexName,
            _id: document.documentId,
          },
        },
        {
          doc: this.toTextDocument(document),
          doc_as_upsert: true,
        },
      ])
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n';
    const response = await this.request<{ errors?: boolean; items?: unknown[] }>('/_bulk', {
      method: 'POST',
      rawBody: body,
      contentType: 'application/x-ndjson',
    });
    if (response?.errors) {
      throw new Error(`OpenSearch bulk text upsert failed for ${input.length} document(s)`);
    }
  }

  private toTextDocument(input: TextIndexDocument) {
    return {
      document_id: input.documentId,
      catalog_entry_id: input.catalogEntryId,
      commercial_object_id: input.commercialObjectId,
      catalog_id: input.catalogId,
      provider_id: input.providerId,
      object_id: input.objectId,
      object_type: input.objectType,
      document_status: input.documentStatus,
      title: input.title,
      summary: input.summary,
      search_text: input.searchText,
      normalized_brand: input.normalizedBrand,
      normalized_category: input.normalizedCategory,
      normalized_sku: input.normalizedSku,
      currency: input.currency,
      availability_status: input.availabilityStatus,
      amount: input.amount,
      has_image: input.hasImage,
      quality_rank: input.qualityRank,
      availability_rank: input.availabilityRank,
      visible_attributes_payload: input.visibleAttributesPayload,
      text_indexed_at: new Date().toISOString(),
    };
  }

  private toVectorDocument(input: VectorIndexDocument) {
    return {
      document_id: input.documentId,
      catalog_id: input.catalogId,
      provider_id: input.providerId,
      object_type: input.objectType,
      embedding_provider: this.profile.embeddingProviderId,
      embedding_model: this.profile.embeddingModel,
      embedding_dimension: this.profile.embeddingDimension,
      embedding_text_hash: input.embeddingTextHash,
      embedding_vector: input.embeddingVector,
      embedding_indexed_at: new Date().toISOString(),
    };
  }

  private assertVectorDimension(input: VectorIndexDocument) {
    if (input.embeddingVector.length !== this.profile.embeddingDimension) {
      throw new Error(`OpenSearch vector dimension ${input.embeddingVector.length} does not match configured dimension ${this.profile.embeddingDimension}`);
    }
  }

  async delete(documentId: string) {
    await this.request(`/${encodeURIComponent(this.profile.indexName)}/_doc/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      ignoreStatuses: [404],
    });
  }

  async query(input: VectorIndexQueryInput): Promise<VectorIndexQueryResult> {
    if (input.queryVector.length === 0 || input.limit <= 0) {
      return { profile: this.profile, matches: [] };
    }
    if (input.queryVector.length !== this.profile.embeddingDimension) {
      throw new Error(`OpenSearch query vector dimension ${input.queryVector.length} does not match configured dimension ${this.profile.embeddingDimension}`);
    }

    const size = Math.max(input.rerankLimit ?? input.limit, input.limit);
    const filters: Array<Record<string, unknown>> = [
      { term: { catalog_id: input.catalogId } },
      { term: { embedding_model: this.profile.embeddingModel } },
      { term: { embedding_dimension: this.profile.embeddingDimension } },
    ];
    if (input.documentIds?.length) {
      filters.push({ terms: { document_id: input.documentIds } });
    }

    const response = await this.request<OpenSearchSearchResponse>(`/${encodeURIComponent(this.profile.indexName)}/_search`, {
      method: 'POST',
      body: {
        size,
        _source: [
          'document_id',
          'catalog_entry_id',
          'commercial_object_id',
          'catalog_id',
          'provider_id',
          'object_id',
          'object_type',
          'document_status',
          'title',
          'summary',
          'search_text',
          'visible_attributes_payload',
        ],
        query: {
          bool: {
            filter: filters,
            must: [
              {
                knn: {
                  embedding_vector: {
                    vector: input.queryVector,
                    k: Math.max(size, input.limit),
                  },
                },
              },
            ],
          },
        },
      },
    });

    return {
      profile: this.profile,
      matches: toMatches(response).slice(0, size),
    };
  }

  async searchText(input: TextIndexQueryInput): Promise<VectorIndexMatch[]> {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery || input.limit <= 0) return [];

    const response = await this.request<OpenSearchSearchResponse>(`/${encodeURIComponent(this.profile.indexName)}/_search`, {
      method: 'POST',
      body: {
        size: input.limit,
        _source: ['document_id'],
        query: {
          function_score: {
            query: {
              bool: {
                filter: this.textFilters(input),
                must: [
                  {
                    multi_match: {
                      query: normalizedQuery,
                      fields: [
                        'title^5',
                        'normalized_sku^8',
                        'normalized_brand^3',
                        'normalized_category^2',
                        'search_text',
                        'summary',
                      ],
                      type: 'best_fields',
                      operator: 'and',
                      fuzziness: 'AUTO',
                    },
                  },
                ],
              },
            },
            functions: [
              { field_value_factor: { field: 'quality_rank', factor: 0.02, missing: 0 } },
              { filter: { term: { has_image: true } }, weight: 1.05 },
            ],
            score_mode: 'sum',
            boost_mode: 'sum',
          },
        },
      },
    });

    return toMatches(response);
  }

  async health(): Promise<VectorIndexHealth> {
    try {
      await this.request('/_cluster/health', { method: 'GET' });
      return { profile: this.profile, available: true };
    } catch {
      return { profile: this.profile, available: false };
    }
  }

  private async updateDocument(documentId: string, doc: Record<string, unknown>) {
    await this.request(`/${encodeURIComponent(this.profile.indexName)}/_update/${encodeURIComponent(documentId)}`, {
      method: 'POST',
      body: {
        doc,
        doc_as_upsert: true,
      },
    });
  }

  private textFilters(input: TextIndexQueryInput) {
    const filters: Array<Record<string, unknown>> = [
      { term: { catalog_id: input.catalogId } },
      { term: { document_status: 'active' } },
    ];
    const queryFilters = input.filters ?? {};
    if (queryFilters.providerId) filters.push({ term: { provider_id: queryFilters.providerId } });
    if (queryFilters.category) filters.push({ term: { normalized_category: queryFilters.category } });
    if (queryFilters.brand) filters.push({ term: { normalized_brand: queryFilters.brand } });
    if (queryFilters.currency) filters.push({ term: { currency: queryFilters.currency } });
    if (queryFilters.availabilityStatus) filters.push({ term: { availability_status: queryFilters.availabilityStatus } });
    if (queryFilters.sku) filters.push({ term: { normalized_sku: queryFilters.sku } });
    if (queryFilters.hasImage !== undefined) filters.push({ term: { has_image: queryFilters.hasImage } });
    if (queryFilters.inStockOnly) filters.push({ terms: { availability_status: ['in_stock', 'low_stock'] } });
    if (queryFilters.minAmount !== undefined || queryFilters.maxAmount !== undefined) {
      filters.push({
        range: {
          amount: {
            ...(queryFilters.minAmount !== undefined ? { gte: queryFilters.minAmount } : {}),
            ...(queryFilters.maxAmount !== undefined ? { lte: queryFilters.maxAmount } : {}),
          },
        },
      });
    }
    return filters;
  }

  private async createIndexIfMissing() {
    const indexPath = `/${encodeURIComponent(this.profile.indexName)}`;
    const exists = await this.request(indexPath, { method: 'HEAD', ignoreStatuses: [404] });
    if (exists !== null) {
      await this.ensureTextMappings();
      return;
    }

    await this.request(indexPath, {
      method: 'PUT',
      body: {
        settings: {
          index: {
            knn: true,
          },
        },
        mappings: {
          dynamic: 'strict',
          properties: {
            document_id: { type: 'keyword' },
            catalog_entry_id: { type: 'keyword' },
            commercial_object_id: { type: 'keyword' },
            catalog_id: { type: 'keyword' },
            provider_id: { type: 'keyword' },
            object_id: { type: 'keyword' },
            object_type: { type: 'keyword' },
            document_status: { type: 'keyword' },
            title: { type: 'text', analyzer: 'standard' },
            summary: { type: 'text', analyzer: 'standard' },
            search_text: { type: 'text', analyzer: 'standard' },
            normalized_brand: { type: 'keyword' },
            normalized_category: { type: 'keyword' },
            normalized_sku: { type: 'keyword' },
            currency: { type: 'keyword' },
            availability_status: { type: 'keyword' },
            amount: { type: 'double' },
            has_image: { type: 'boolean' },
            quality_rank: { type: 'integer' },
            availability_rank: { type: 'integer' },
            visible_attributes_payload: { type: 'object', enabled: false },
            embedding_provider: { type: 'keyword' },
            embedding_model: { type: 'keyword' },
            embedding_dimension: { type: 'integer' },
            embedding_text_hash: { type: 'keyword' },
            text_indexed_at: { type: 'date' },
            embedding_indexed_at: { type: 'date' },
            embedding_vector: {
              type: 'knn_vector',
              dimension: this.profile.embeddingDimension,
              method: {
                name: 'hnsw',
                space_type: 'cosinesimil',
                engine: this.engine,
                parameters: {
                  m: this.m,
                  ef_construction: this.efConstruction,
                },
              },
            },
          },
        },
      },
    });
  }

  private async ensureTextMappings() {
    await this.request(`/${encodeURIComponent(this.profile.indexName)}/_mapping`, {
      method: 'PUT',
      body: {
        properties: {
          object_id: { type: 'keyword' },
          catalog_entry_id: { type: 'keyword' },
          commercial_object_id: { type: 'keyword' },
          document_status: { type: 'keyword' },
          title: { type: 'text', analyzer: 'standard' },
          summary: { type: 'text', analyzer: 'standard' },
          search_text: { type: 'text', analyzer: 'standard' },
          normalized_brand: { type: 'keyword' },
          normalized_category: { type: 'keyword' },
          normalized_sku: { type: 'keyword' },
          currency: { type: 'keyword' },
          availability_status: { type: 'keyword' },
          amount: { type: 'double' },
          has_image: { type: 'boolean' },
          quality_rank: { type: 'integer' },
          availability_rank: { type: 'integer' },
          visible_attributes_payload: { type: 'object', enabled: false },
          text_indexed_at: { type: 'date' },
          embedding_indexed_at: { type: 'date' },
        },
      },
    });
  }

  private async request<T = unknown>(path: string, options: {
    method: 'GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE';
    body?: unknown;
    rawBody?: string;
    contentType?: string;
    ignoreStatuses?: number[];
  }): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: this.headers(options.body !== undefined || options.rawBody !== undefined, options.contentType),
        body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: controller.signal,
      });

      if (options.ignoreStatuses?.includes(response.status)) return null;
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`OpenSearch ${options.method} ${path} failed: ${response.status} ${response.statusText} ${message}`);
      }
      if (options.method === 'HEAD') return {} as T;
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(includeBody: boolean, contentType = 'application/json') {
    const headers: Record<string, string> = {};
    if (includeBody) headers['content-type'] = contentType;
    if (this.username || this.password) {
      headers.authorization = `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }
    return headers;
  }
}

function toMatches(response: OpenSearchSearchResponse | null): VectorIndexMatch[] {
  return (response?.hits?.hits ?? [])
    .map((hit) => ({
      documentId: hit._source?.document_id ?? hit._id ?? '',
      score: typeof hit._score === 'number' ? Number(hit._score.toFixed(4)) : 0,
      document: toStoredDocument(hit._source),
    }))
    .filter((match) => match.documentId && match.score > 0);
}

function toStoredDocument(source: OpenSearchHit['_source']): VectorIndexMatch['document'] {
  if (!source?.document_id || !source.catalog_entry_id || !source.commercial_object_id) return undefined;
  if (!source.catalog_id || !source.provider_id || !source.object_id || !source.object_type || !source.document_status) return undefined;
  return {
    documentId: source.document_id,
    catalogEntryId: source.catalog_entry_id,
    commercialObjectId: source.commercial_object_id,
    catalogId: source.catalog_id,
    providerId: source.provider_id,
    objectId: source.object_id,
    objectType: source.object_type,
    documentStatus: source.document_status,
    title: source.title ?? '',
    summary: source.summary ?? null,
    searchText: source.search_text ?? '',
    visibleAttributesPayload: source.visible_attributes_payload ?? {},
  };
}
