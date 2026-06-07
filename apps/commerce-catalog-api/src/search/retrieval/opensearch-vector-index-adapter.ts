import type { AppConfig } from '@ocp-catalog/config';
import type {
  VectorIndexDocument,
  VectorIndexHealth,
  VectorIndexProfile,
  VectorIndexQueryInput,
  VectorIndexQueryResult,
  WritableVectorIndexAdapter,
} from './vector-index-adapter';

type OpenSearchHit = {
  _id?: string;
  _score?: number;
  _source?: {
    document_id?: string;
  };
};

type OpenSearchSearchResponse = {
  hits?: {
    hits?: OpenSearchHit[];
  };
};

export class OpenSearchVectorIndexAdapter implements WritableVectorIndexAdapter {
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
    if (input.embeddingVector.length !== this.profile.embeddingDimension) {
      throw new Error(`OpenSearch vector dimension ${input.embeddingVector.length} does not match configured dimension ${this.profile.embeddingDimension}`);
    }

    await this.request(`/${encodeURIComponent(this.profile.indexName)}/_doc/${encodeURIComponent(input.documentId)}`, {
      method: 'PUT',
      body: {
        document_id: input.documentId,
        catalog_id: input.catalogId,
        provider_id: input.providerId,
        object_type: input.objectType,
        embedding_provider: this.profile.embeddingProviderId,
        embedding_model: this.profile.embeddingModel,
        embedding_dimension: this.profile.embeddingDimension,
        embedding_text_hash: input.embeddingTextHash,
        embedding_vector: input.embeddingVector,
        indexed_at: new Date().toISOString(),
      },
    });
  }

  async delete(documentId: string) {
    await this.request(`/${encodeURIComponent(this.profile.indexName)}/_doc/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      ignoreStatuses: [404],
    });
  }

  async query(input: VectorIndexQueryInput): Promise<VectorIndexQueryResult> {
    await this.ensureIndex();
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
        _source: ['document_id'],
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
    if (!response) {
      return { profile: this.profile, matches: [] };
    }

    const matches = (response.hits?.hits ?? [])
      .map((hit) => ({
        documentId: hit._source?.document_id ?? hit._id ?? '',
        score: typeof hit._score === 'number' ? Number(hit._score.toFixed(4)) : 0,
      }))
      .filter((match) => match.documentId && match.score > 0)
      .slice(0, size);

    return {
      profile: this.profile,
      matches,
    };
  }

  async health(): Promise<VectorIndexHealth> {
    try {
      await this.request('/_cluster/health', { method: 'GET' });
      return { profile: this.profile, available: true };
    } catch {
      return { profile: this.profile, available: false };
    }
  }

  private async createIndexIfMissing() {
    const indexPath = `/${encodeURIComponent(this.profile.indexName)}`;
    const exists = await this.request(indexPath, { method: 'HEAD', ignoreStatuses: [404] });
    if (exists !== null) return;

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
            catalog_id: { type: 'keyword' },
            provider_id: { type: 'keyword' },
            object_type: { type: 'keyword' },
            embedding_provider: { type: 'keyword' },
            embedding_model: { type: 'keyword' },
            embedding_dimension: { type: 'integer' },
            embedding_text_hash: { type: 'keyword' },
            indexed_at: { type: 'date' },
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

  private async request<T = unknown>(path: string, options: {
    method: 'GET' | 'HEAD' | 'PUT' | 'POST' | 'DELETE';
    body?: unknown;
    ignoreStatuses?: number[];
  }): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: this.headers(options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

  private headers(includeJson: boolean) {
    const headers: Record<string, string> = {};
    if (includeJson) headers['content-type'] = 'application/json';
    if (this.username || this.password) {
      headers.authorization = `Basic ${btoa(`${this.username}:${this.password}`)}`;
    }
    return headers;
  }
}
