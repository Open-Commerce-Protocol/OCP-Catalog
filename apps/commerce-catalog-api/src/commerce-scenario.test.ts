import { describe, expect, test } from 'bun:test';
import { visibleAttributes } from '@ocp-catalog/catalog-core';
import { createCommerceCatalogScenario } from './commerce-scenario';

const richProduct = {
  ocp_version: '1.0' as const,
  kind: 'CommercialObject' as const,
  id: 'obj_1',
  object_id: 'sku-1',
  object_type: 'product',
  provider_id: 'provider-1',
  title: 'Travel Headphones',
  summary: 'Wireless noise cancelling headphones.',
  status: 'active' as const,
  source_url: 'https://provider.example/products/sku-1',
  descriptors: [
    {
      pack_id: 'ocp.commerce.product.core.v1',
      data: {
        title: 'Travel Headphones',
        summary: 'Wireless noise cancelling headphones.',
        brand: 'North Audio',
        category: 'electronics',
        sku: 'sku-1',
        product_url: 'https://provider.example/products/sku-1',
        image_urls: ['https://provider.example/images/sku-1.jpg'],
        attributes: { color: 'black', material: 'aluminum' },
      },
    },
    {
      pack_id: 'ocp.commerce.price.v1',
      data: {
        currency: 'USD',
        amount: 129.99,
        list_amount: 159.99,
        price_type: 'fixed',
      },
    },
    {
      pack_id: 'ocp.commerce.inventory.v1',
      data: {
        availability_status: 'in_stock',
        quantity: 7,
      },
    },
  ],
};

describe('commerce-scenario', () => {
  test('requires title and price fields for commerce products', () => {
    const scenario = createCommerceCatalogScenario();
    expect(scenario.objectContracts()[0]?.required_fields).toEqual([
      'ocp.commerce.product.core.v1#/title',
      'ocp.commerce.price.v1#/currency',
      'ocp.commerce.price.v1#/amount',
    ]);
  });

  test('builds rich product projection with price and image signals', () => {
    const scenario = createCommerceCatalogScenario();
    const projection = scenario.buildSearchProjection(richProduct);

    expect(projection.sku).toBe('sku-1');
    expect(projection.amount).toBe(129.99);
    expect(projection.list_amount).toBe(159.99);
    expect(projection.discount_present).toBe(true);
    expect(projection.image_url).toBe('https://provider.example/images/sku-1.jpg');
    expect(projection.primary_image_url).toBe('https://provider.example/images/sku-1.jpg');
    expect(projection.has_image).toBe(true);
    expect(projection.quality_tier).toBe('rich');
  });

  test('builds basic quality tier when only minimum commerce fields are present', () => {
    const scenario = createCommerceCatalogScenario();
    const projection = scenario.buildSearchProjection({
      ...richProduct,
      source_url: undefined,
      descriptors: [
        {
          pack_id: 'ocp.commerce.product.core.v1',
          data: {
            title: 'Budget Cable',
          },
        },
        {
          pack_id: 'ocp.commerce.price.v1',
          data: {
            currency: 'USD',
            amount: 9.99,
          },
        },
      ],
    });

    expect(projection.quality_tier).toBe('basic');
    expect(projection.has_image).toBe(false);
    expect(projection.has_product_url).toBe(false);
  });

  test('uses cleaned embedding text focused on commerce-relevant fields', () => {
    const scenario = createCommerceCatalogScenario();
    const projection = scenario.buildSearchProjection(richProduct);
    const text = scenario.buildEmbeddingText?.(richProduct, projection);

    expect(text).toContain('Travel Headphones');
    expect(text).toContain('sku-1');
    expect(text).toContain('list price 159.99');
    expect(text).not.toContain('provider-1');
    expect(text).not.toContain('in_stock');
  });

  test('advertises expanded commerce filters', () => {
    const scenario = createCommerceCatalogScenario();
    const capability = scenario.queryCapabilities()[0];
    const inputNames = capability?.input_fields.map((field) => field.name);

    expect(inputNames).toContain('filters.sku');
    expect(inputNames).toContain('filters.min_amount');
    expect(inputNames).toContain('filters.max_amount');
    expect(inputNames).toContain('filters.in_stock_only');
    expect(inputNames).toContain('filters.has_image');
  });

  test('advertises NDJSON streaming sync for large catalog intake', () => {
    const scenario = createCommerceCatalogScenario();
    const [capability] = scenario.providerSyncCapabilities?.() ?? [];
    expect(capability).toBeDefined();

    expect(capability).toMatchObject({
      capability_id: 'ocp.push.batch',
      sync_model: {
        snapshot: true,
        stream: true,
      },
      batching: {
        enabled: true,
        max_items: 1000,
      },
      streaming: {
        enabled: true,
      },
      metadata: {
        stream_endpoint_path: '/ocp/objects/sync/stream',
        run_status_endpoint_path: '/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}',
        run_complete_endpoint_path: '/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}',
        stream_content_type: 'application/x-ndjson',
      },
    });
  });

  test('advertises provider upload guidance and async indexing behavior', () => {
    const scenario = createCommerceCatalogScenario();
    const [capability] = scenario.providerSyncCapabilities?.() ?? [];
    const metadata = capability?.metadata as Record<string, unknown>;
    const uploadGuide = metadata.upload_guide as Record<string, unknown>;
    const indexingBehavior = uploadGuide.indexing_behavior as Record<string, unknown>;
    const batchEndpoint = uploadGuide.batch_endpoint as Record<string, unknown>;
    const streamEndpoint = uploadGuide.stream_endpoint as Record<string, unknown>;
    const objectRequirements = uploadGuide.object_requirements as Record<string, unknown>;
    const auth = uploadGuide.auth as Record<string, unknown>;

    expect(uploadGuide.summary).toContain('register first');
    expect(auth.registration_result_field).toBe('provider_api_key');
    expect(batchEndpoint.path).toBe('/ocp/objects/sync');
    expect(streamEndpoint.path).toBe('/ocp/objects/sync/stream');
    expect(indexingBehavior.mode).toBe('async');
    expect(indexingBehavior.note).toContain('semantic embeddings are ready');
    expect(objectRequirements.minimum_required_fields).toContain('descriptors[ocp.commerce.price.v1].amount');
  });

  test('advertises practical query usage guidance in manifest metadata', () => {
    const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: true });
    const capability = scenario.queryCapabilities()[0];
    const metadata = capability?.metadata as Record<string, unknown>;
    const usageGuide = metadata.usage_guide as Record<string, unknown>;
    const requestExamples = metadata.request_examples as Record<string, unknown>;
    const responseContract = metadata.response_contract as Record<string, unknown>;
    const keywordPack = capability?.query_packs.find((pack) => pack.pack_id === 'ocp.query.keyword.v1');

    expect(usageGuide.clean_list).toContain('omit query');
    expect(usageGuide.pagination).toContain('Offset pagination is intentionally disabled');
    expect(requestExamples.clean_list).toMatchObject({
      catalog_id: '<catalog_id>',
      limit: 20,
      offset: 0,
    });
    expect(requestExamples.semantic_search).toMatchObject({
      query_pack: 'ocp.query.semantic.v1',
      offset: 0,
    });
    expect(requestExamples.resolve_selected_entry).toMatchObject({
      kind: 'ResolveRequest',
      entry_id: '<entry_id from query result>',
    });
    expect(responseContract.pagination).toBeDefined();
    expect(keywordPack?.metadata.example_request).toMatchObject({
      query_pack: 'ocp.query.keyword.v1',
      offset: 0,
    });
  });

  test('builds resolve actions and live checks from resolve context without leaking private fields', () => {
    const scenario = createCommerceCatalogScenario();
    const projection = scenario.buildSearchProjection(richProduct);
    const context = {
      request: {
        entry_id: 'entry_1',
        purpose: 'view' as const,
        live_check: true,
        requested_fields: [],
      },
      projection,
      catalog_id: 'cat_1',
      entry_id: 'entry_1',
      commercial_object_id: 'commercial_1',
      object_id: 'sku-1',
      object_type: 'product',
      provider_id: 'provider-1',
      title: 'Travel Headphones',
      resolved_at: '2026-04-28T00:00:00.000Z',
      expires_at: '2026-04-28T00:15:00.000Z',
    };

    expect(visibleAttributes(projection)).not.toHaveProperty('product_url');
    expect(visibleAttributes(projection)).not.toHaveProperty('source_url');
    expect(visibleAttributes(projection)).not.toHaveProperty('text');
    expect(scenario.buildResolveActions?.(context)[0]).toMatchObject({
      action_id: 'view_product',
      entrypoint: {
        url: 'https://provider.example/products/sku-1',
        method: 'GET',
      },
    });
    expect(scenario.buildResolveLiveChecks?.(context)[0]).toMatchObject({
      check_id: 'availability',
      status: 'passed',
      summary: 'in_stock',
    });
    expect(scenario.buildResolveAccess?.(context)?.redacted_fields).toEqual(['product_url', 'source_url', 'text']);
  });
});
