import { afterEach, describe, expect, test } from 'bun:test';
import type { AppConfig } from '@ocp-catalog/config';
import { OpenSearchVectorIndexAdapter } from './opensearch-vector-index-adapter';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenSearchVectorIndexAdapter', () => {
  test('creates a k-NN index and upserts vector documents', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      return Response.json({ acknowledged: true });
    }) as typeof fetch;

    const adapter = new OpenSearchVectorIndexAdapter(config(), profile());
    await adapter.upsert({
      documentId: 'sdoc_1',
      catalogId: 'cat_1',
      providerId: 'provider_1',
      objectType: 'product',
      embeddingVector: [0.1, 0.2, 0.3],
      embeddingTextHash: 'hash_1',
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['HEAD', 'https://search.example.test/ocp-commerce-catalog-vectors-test'],
      ['PUT', 'https://search.example.test/ocp-commerce-catalog-vectors-test'],
      ['POST', 'https://search.example.test/ocp-commerce-catalog-vectors-test/_update/sdoc_1'],
    ]);
    expect(JSON.parse(String(calls[1]!.init.body)).mappings.properties.embedding_vector.dimension).toBe(3);
    expect(JSON.parse(String(calls[2]!.init.body))).toMatchObject({
      doc_as_upsert: true,
      doc: {
        document_id: 'sdoc_1',
        catalog_id: 'cat_1',
        embedding_model: 'test-model',
        embedding_dimension: 3,
        embedding_vector: [0.1, 0.2, 0.3],
      },
    });
  });

  test('queries with catalog and embedding filters', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200 });
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return Response.json({
        hits: {
          hits: [
            { _id: 'sdoc_1', _score: 0.87, _source: { document_id: 'sdoc_1' } },
          ],
        },
      });
    }) as typeof fetch;

    const adapter = new OpenSearchVectorIndexAdapter(config(), profile());
    const result = await adapter.query({
      catalogId: 'cat_1',
      queryVector: [1, 0, 0],
      limit: 5,
      documentIds: ['sdoc_1'],
    });

    expect(bodies.at(-1)).toMatchObject({
      size: 5,
      query: {
        bool: {
          filter: [
            { term: { catalog_id: 'cat_1' } },
            { term: { embedding_model: 'test-model' } },
            { term: { embedding_dimension: 3 } },
            { terms: { document_id: ['sdoc_1'] } },
          ],
        },
      },
    });
    expect(result.matches).toEqual([{ documentId: 'sdoc_1', score: 0.87 }]);
  });

  test('upserts and queries text documents with commerce filters', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200 });
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return Response.json({
        hits: {
          hits: [
            {
              _id: 'sdoc_1',
              _score: 12.34567,
              _source: {
                document_id: 'sdoc_1',
                catalog_entry_id: 'centry_1',
                commercial_object_id: 'cobj_1',
                catalog_id: 'cat_1',
                provider_id: 'provider_1',
                object_id: 'obj_1',
                object_type: 'product',
                document_status: 'active',
                title: 'Travel Headphones',
                summary: 'Wireless audio',
                search_text: 'travel headphones wireless audio',
                visible_attributes_payload: { title: 'Travel Headphones' },
              },
            },
          ],
        },
      });
    }) as typeof fetch;

    const adapter = new OpenSearchVectorIndexAdapter(config(), profile());
    await adapter.upsertText({
      documentId: 'sdoc_1',
      catalogEntryId: 'centry_1',
      commercialObjectId: 'cobj_1',
      catalogId: 'cat_1',
      providerId: 'provider_1',
      objectId: 'obj_1',
      objectType: 'product',
      documentStatus: 'active',
      title: 'Travel Headphones',
      summary: 'Wireless audio',
      searchText: 'travel headphones wireless audio',
      normalizedBrand: 'north audio',
      normalizedCategory: 'electronics',
      normalizedSku: 'sku-1',
      currency: 'USD',
      availabilityStatus: 'in_stock',
      amount: 99,
      hasImage: true,
      qualityRank: 30,
      availabilityRank: 30,
      visibleAttributesPayload: {
        title: 'Travel Headphones',
        provider_id: 'provider_1',
        object_id: 'obj_1',
      },
    });
    const matches = await adapter.searchText({
      catalogId: 'cat_1',
      query: 'travel headphones',
      limit: 5,
      filters: {
        providerId: 'provider_1',
        category: 'electronics',
        inStockOnly: true,
        maxAmount: 150,
      },
    });

    expect(bodies[1]).toMatchObject({
      doc_as_upsert: true,
      doc: {
        document_id: 'sdoc_1',
        catalog_entry_id: 'centry_1',
        commercial_object_id: 'cobj_1',
        document_status: 'active',
        search_text: 'travel headphones wireless audio',
      },
    });
    expect(bodies[2]).toMatchObject({
      size: 5,
      query: {
        function_score: {
          query: {
            bool: {
              filter: [
                { term: { catalog_id: 'cat_1' } },
                { term: { document_status: 'active' } },
                { term: { provider_id: 'provider_1' } },
                { term: { normalized_category: 'electronics' } },
                { terms: { availability_status: ['in_stock', 'low_stock'] } },
                { range: { amount: { lte: 150 } } },
              ],
            },
          },
        },
      },
    });
    expect(matches).toEqual([{
      documentId: 'sdoc_1',
      score: 12.3457,
      document: {
        documentId: 'sdoc_1',
        catalogEntryId: 'centry_1',
        commercialObjectId: 'cobj_1',
        catalogId: 'cat_1',
        providerId: 'provider_1',
        objectId: 'obj_1',
        objectType: 'product',
        documentStatus: 'active',
        title: 'Travel Headphones',
        summary: 'Wireless audio',
        searchText: 'travel headphones wireless audio',
        visibleAttributesPayload: { title: 'Travel Headphones' },
      },
    }]);
  });
});

function profile() {
  return {
    vectorProviderId: 'opensearch-knn',
    indexName: 'ocp-commerce-catalog-vectors-test',
    embeddingProviderId: 'openai',
    embeddingModel: 'test-model',
    embeddingDimension: 3,
  };
}

function config(): AppConfig {
  return {
    DATABASE_URL: 'postgres://ocp:ocp@localhost:5432/ocp_catalog',
    DATABASE_POOL_MAX: 10,
    CATALOG_WORKER_DATABASE_POOL_MAX: 4,
    CATALOG_API_PORT: 4000,
    CATALOG_PUBLIC_BASE_URL: 'http://localhost:4000',
    PROVIDER_API_PORT: 4200,
    PROVIDER_PUBLIC_BASE_URL: 'http://localhost:4200',
    USER_DEMO_API_PORT: 4230,
    OCP_SITE_PORT: 5173,
    REGISTRATION_API_PORT: 4100,
    REGISTRATION_ADMIN_UI_PORT: 4250,
    REGISTRATION_PUBLIC_BASE_URL: 'http://localhost:4100',
    REGISTRATION_DISCOVERY_URL: 'http://localhost:4100/.well-known/ocp-registration',
    REGISTRATION_REFRESH_SCHEDULER_ENABLED: true,
    REGISTRATION_REFRESH_INTERVAL_SECONDS: 300,
    REGISTRATION_HEALTH_CHECK_TIMEOUT_MS: 5000,
    REGISTRATION_HEALTH_FAILURE_STALE_THRESHOLD: 3,
    CATALOG_SEARCH_INDEX_WORKER_ENABLED: true,
    CATALOG_SEARCH_INDEX_WORKER_INTERVAL_SECONDS: 30,
    CATALOG_SEARCH_INDEX_WORKER_BATCH_SIZE: 25,
    CATALOG_SEARCH_INDEX_REALTIME_EMBEDDING_BACKLOG_LIMIT: 5000,
    CATALOG_SEARCH_INDEX_RECONCILE_ON_STARTUP: false,
    CATALOG_SEARCH_INDEX_WORKER_JOB_DELAY_MS: 0,
    CATALOG_SEARCH_INDEX_JOB_MAX_ATTEMPTS: 5,
    CATALOG_SEARCH_INDEX_RETRY_BASE_DELAY_MS: 30000,
    CATALOG_SEARCH_INDEX_RETRY_MAX_DELAY_MS: 900000,
    CATALOG_SEARCH_INDEX_RETRY_JITTER_RATIO: 0.2,
    API_KEY_DEV: 'dev-api-key',
    API_KEYS: '',
    CATALOG_ADMIN_API_KEY: 'dev-admin-key',
    CATALOG_ADMIN_API_KEYS: '',
    CATALOG_ID: 'cat_local_dev',
    CATALOG_NAME: 'Commerce Product Search Catalog',
    COMMERCE_PROVIDER_ID: 'commerce_provider_local_dev',
    COMMERCE_PROVIDER_NAME: 'Local Commerce Provider',
    COMMERCE_PROVIDER_CONTACT_EMAIL: 'ops@example.test',
    COMMERCE_PROVIDER_DOMAIN: 'localhost',
    REGISTRATION_ID: 'ocp_registry_public',
    REGISTRATION_NAME: 'Open Commerce Protocol Registry',
    EMBEDDING_MODEL: 'test-model',
    EMBEDDING_DIMENSION: 3,
    CATALOG_VECTOR_INDEX_PROVIDER: 'opensearch',
    OPENSEARCH_URL: 'https://search.example.test',
    OPENSEARCH_USERNAME: 'user',
    OPENSEARCH_PASSWORD: 'pass',
    OPENSEARCH_INDEX_NAME: 'ocp-commerce-catalog-vectors-test',
    OPENSEARCH_TIMEOUT_MS: 10000,
    OPENSEARCH_KNN_ENGINE: 'lucene',
    OPENSEARCH_KNN_M: 16,
    OPENSEARCH_KNN_EF_CONSTRUCTION: 128,
    USER_DEMO_AGENT_MODEL: 'qwen-plus',
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_TIMEOUT_MS: 30000,
    OPENAI_EMBEDDING_MAX_INPUT_CHARS: 12000,
    OCP_MCP_DEFAULT_REGISTRATION_URL: 'http://localhost:4100',
    OCP_MCP_REQUEST_TIMEOUT_MS: 10000,
    OCP_MCP_USER_AGENT: 'ocp-mcp-server/test',
    OCP_MCP_API_KEY: '',
    OCP_MCP_HTTP_PORT: 4300,
    OCP_MCP_HTTP_PATH: '/mcp',
    OCP_ACTIVITY_API_PORT: 4400,
    OCP_ACTIVITY_PUBLIC_BASE_URL: 'http://localhost:4400',
    OCP_ACTIVITY_API_KEY: '',
    OCP_MCP_SKILL_GATEWAY_URL: 'http://localhost:4330',
    OCP_MCP_SKILL_GATEWAY_KEY: '',
  };
}
