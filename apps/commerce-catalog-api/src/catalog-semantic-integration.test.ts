import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { loadConfig } from '@ocp-catalog/config';
import { CatalogEmbeddingService, createCatalogServices, type EmbeddingProvider, type EmbeddingResult } from '@ocp-catalog/catalog-core';
import { createDb } from '@ocp-catalog/db';
import { createCommerceCatalogScenario } from './commerce-scenario';

const baseConfig = loadConfig();
const db = createDb(baseConfig.DATABASE_URL);
const sql = postgres(baseConfig.DATABASE_URL, { max: 1 });
const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: true });

const providerId = `itest_semantic_provider_${Date.now()}`;
const semanticQuery = `wireless aluminum travel audio ${providerId}`;
const hybridQuery = `travel headphones ${providerId}`;

describe('commerce catalog semantic integration', () => {
  beforeAll(async () => {
    await cleanupProviderData(providerId, [semanticQuery, hybridQuery]);
  });

  afterAll(async () => {
    await cleanupProviderData(providerId, [semanticQuery, hybridQuery]);
    await sql.end();
  });

  test('writes local embeddings and supports semantic and hybrid retrieval', async () => {
    await services.registrations.register({
      ocp_version: '1.0',
      kind: 'ProviderRegistration',
      id: `reg_${providerId}_1`,
      catalog_id: baseConfig.CATALOG_ID,
      registration_version: 1,
      updated_at: new Date().toISOString(),
      provider: {
        provider_id: providerId,
        entity_type: 'merchant',
        display_name: 'Semantic Test Provider',
        homepage: 'https://provider.example',
        contact_email: 'semantic@example.test',
        domains: ['provider.example'],
      },
      object_declarations: [
        {
          guaranteed_fields: [
            'ocp.commerce.product.core.v1#/title',
            'ocp.commerce.price.v1#/currency',
            'ocp.commerce.price.v1#/amount',
            'ocp.commerce.product.core.v1#/product_url',
          ],
          optional_fields: [
            'ocp.commerce.product.core.v1#/summary',
            'ocp.commerce.product.core.v1#/brand',
            'ocp.commerce.product.core.v1#/category',
            'ocp.commerce.product.core.v1#/sku',
            'ocp.commerce.product.core.v1#/image_urls',
            'ocp.commerce.inventory.v1#/availability_status',
          ],
          sync: {
            preferred_capabilities: ['ocp.push.batch'],
            avoid_capabilities_unless_necessary: [],
            provider_endpoints: {},
          },
        },
      ],
    });

    const syncResult = await services.objects.sync({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: baseConfig.CATALOG_ID,
      provider_id: providerId,
      registration_version: 1,
      batch_id: `batch_${providerId}`,
      objects: [
        buildSemanticObject({
          providerId,
          objectId: 'semantic-rich',
          title: `Travel Headphones ${providerId}`,
          summary: 'Wireless aluminum frame over-ear audio gear for commuting and flights.',
          brand: 'North Audio',
          category: 'electronics',
          sku: `sku-${providerId}-rich`,
          productUrl: `https://provider.example/products/${providerId}/rich`,
          imageUrls: [`https://provider.example/images/${providerId}-rich.jpg`],
          amount: 129.99,
          availabilityStatus: 'in_stock',
          quantity: 5,
        }),
        buildSemanticObject({
          providerId,
          objectId: 'semantic-basic',
          title: `Travel Headphones ${providerId} basic`,
          summary: 'Budget wired headphones.',
          brand: 'Budget Audio',
          category: 'electronics',
          sku: `sku-${providerId}-basic`,
          productUrl: `https://provider.example/products/${providerId}/basic`,
          imageUrls: [],
          amount: 99.99,
          availabilityStatus: 'out_of_stock',
          quantity: 0,
        }),
      ],
    });

    expect(syncResult.accepted_count).toBe(2);

    const embeddingRows = await sql`
      select embedding_model, embedding_dimension, status
      from catalog_entry_embeddings
      where catalog_id = ${baseConfig.CATALOG_ID}
        and catalog_entry_id in (
          select id from catalog_entries where provider_id = ${providerId}
        )
      order by created_at
    `;

    expect(embeddingRows.length).toBe(2);
    expect(embeddingRows.every((row) => row.embedding_model === 'local-hash-v1')).toBe(true);
    expect(embeddingRows.every((row) => Number(row.embedding_dimension) === 64)).toBe(true);
    expect(embeddingRows.every((row) => row.status === 'ready')).toBe(true);

    const semanticResult = await services.query.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      query_mode: 'semantic',
      query_pack: 'ocp.query.semantic.v1',
      query: semanticQuery,
      filters: {
        has_image: true,
      },
      limit: 5,
      explain: true,
    });

    expect(semanticResult.query_mode).toBe('semantic');
    expect(semanticResult.items).toHaveLength(1);
    expect(semanticResult.items[0]?.title).toContain(providerId);
    expect(semanticResult.items[0]?.attributes.quality_tier).toBe('rich');
    expect(semanticResult.items[0]?.score).toBeGreaterThan(0);

    const hybridResult = await services.query.query({
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: baseConfig.CATALOG_ID,
      query_mode: 'hybrid',
      query_pack: 'ocp.query.keyword.v1',
      query: hybridQuery,
      filters: {},
      limit: 5,
      explain: true,
    });

    expect(hybridResult.query_mode).toBe('hybrid');
    expect(hybridResult.items.length).toBeGreaterThanOrEqual(2);
    expect(hybridResult.items[0]?.attributes.quality_tier).toBe('rich');
    expect(hybridResult.items[0]?.score).toBeGreaterThan(hybridResult.items[1]?.score ?? 0);
    expect(hybridResult.explain).toContain('Applied semantic ANN shortlist with exact cosine rerank.');
  });
});

async function cleanupProviderData(providerId: string, queries: string[]) {
  for (const query of queries) {
    await sql`delete from query_audit_records where request_payload->>'query' = ${query}`;
  }
  await sql`delete from object_sync_batches where provider_id = ${providerId}`;
  await sql`delete from provider_contract_states where provider_id = ${providerId}`;
  await sql`delete from provider_registrations where provider_id = ${providerId}`;
  await sql`delete from commercial_objects where provider_id = ${providerId}`;
}

function buildSemanticObject(input: {
  providerId: string;
  objectId: string;
  title: string;
  summary: string;
  brand: string;
  category: string;
  sku: string;
  productUrl: string;
  imageUrls: string[];
  amount: number;
  availabilityStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  quantity: number;
}) {
  return {
    ocp_version: '1.0' as const,
    kind: 'CommercialObject' as const,
    id: `obj_${input.providerId}_${input.objectId}`,
    object_id: input.objectId,
    object_type: 'product',
    provider_id: input.providerId,
    title: input.title,
    summary: input.summary,
    status: 'active' as const,
    source_url: input.productUrl,
    descriptors: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        data: {
          title: input.title,
          summary: input.summary,
          brand: input.brand,
          category: input.category,
          sku: input.sku,
          product_url: input.productUrl,
          image_urls: input.imageUrls,
          attributes: {
            material: 'aluminum',
            usage: 'commuting',
          },
        },
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        data: {
          currency: 'USD',
          amount: input.amount,
          price_type: 'fixed',
        },
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        data: {
          availability_status: input.availabilityStatus,
          quantity: input.quantity,
        },
      },
    ],
  };
}

class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = 'local';

  constructor(
    readonly model: string,
    readonly dimension: number,
  ) {}

  async embed(input: string): Promise<EmbeddingResult> {
    const vector = Array.from({ length: this.dimension }, () => 0);
    for (const token of tokenize(input)) {
      const hash = createHash('sha256').update(token).digest();
      for (let index = 0; index < hash.length; index += 2) {
        const bucket = hash[index]! % this.dimension;
        const sign = hash[index + 1]! % 2 === 0 ? 1 : -1;
        vector[bucket] += sign;
      }
    }

    return {
      vector: normalize(vector),
      model: this.model,
      dimension: this.dimension,
    };
  }
}

function tokenize(input: string) {
  return input.toLowerCase().split(/[\s,;:/|()[\]{}"'`~!?.]+/).map((token) => token.trim()).filter(Boolean);
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

const embeddings = new CatalogEmbeddingService(db, scenario, new LocalHashEmbeddingProvider('local-hash-v1', 64));
const services = createCatalogServices(db, baseConfig, scenario, { embeddings });
