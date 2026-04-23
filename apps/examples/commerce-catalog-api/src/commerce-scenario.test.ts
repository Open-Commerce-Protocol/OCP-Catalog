import { describe, expect, test } from 'bun:test';
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

  test('advertises practical query usage guidance in manifest metadata', () => {
    const scenario = createCommerceCatalogScenario({ semanticSearchEnabled: true });
    const capability = scenario.queryCapabilities()[0];
    const metadata = capability?.metadata as Record<string, unknown>;
    const usageGuide = metadata.usage_guide as Record<string, unknown>;
    const requestExamples = metadata.request_examples as Record<string, unknown>;
    const responseContract = metadata.response_contract as Record<string, unknown>;
    const keywordPack = capability?.query_packs.find((pack) => pack.pack_id === 'ocp.query.keyword.v1');

    expect(usageGuide.clean_list).toContain('omit query');
    expect(usageGuide.pagination).toContain('page.next_offset');
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
});
