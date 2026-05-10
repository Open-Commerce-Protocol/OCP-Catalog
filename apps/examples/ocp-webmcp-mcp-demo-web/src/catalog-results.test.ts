import { expect, test } from 'bun:test';
import { findLatestCatalogSummary, summarizeCatalogCall, summarizeCatalogResponse } from './catalog-results';
import type { DemoCallRecord } from './webmcp/tools';

test('summarizes find_and_query_catalog results into product cards', () => {
  const summary = summarizeCatalogCall(createRecord({
    structuredContent: {
      selected_catalog: {
        catalog_id: 'cat_local_dev',
        catalog_name: 'Commerce Product Search Catalog',
      },
      query_result: {
        entries: [{
          id: 'sku-1',
          title: 'Goody Two-Shoes',
          attributes: {
            brand: 'ColourPop',
            amount: 5,
            currency: 'USD',
            availability_status: 'in_stock',
            primary_image_url: 'https://example.com/shoe.jpg',
            product_url: 'https://example.com/shoe',
          },
        }],
      },
    },
  }));

  expect(summary.catalogName).toBe('Commerce Product Search Catalog');
  expect(summary.products).toHaveLength(1);
  expect(summary.products[0]).toMatchObject({
    id: 'sku-1',
    title: 'Goody Two-Shoes',
    brand: 'ColourPop',
    price: '$5.00',
    availability: 'in stock',
    imageUrl: 'https://example.com/shoe.jpg',
    productUrl: 'https://example.com/shoe',
  });
});

test('summarizes tool errors for the shopping view', () => {
  const summary = summarizeCatalogCall({
    id: 'call-1',
    toolName: 'ocp.mcp.query_catalog',
    input: {},
    error: 'Catalog unavailable',
    createdAt: '2026-05-10T00:00:00.000Z',
  });

  expect(summary.error).toBe('Catalog unavailable');
  expect(summary.products).toEqual([]);
});

test('keeps the latest query-like catalog result when later calls have no entries', () => {
  const summary = findLatestCatalogSummary([
    createRecord({
      structuredContent: {
        visible_attributes: { product_url: 'https://example.com/shoe' },
      },
    }, 'ocp.mcp.resolve_catalog_entry'),
    createRecord({
      structuredContent: {
        catalog_name: 'Direct Query Catalog',
        entries: [{
          entry_id: 'sku-2',
          title: 'Direct Query Shoes',
          attributes: { amount: 12.5, currency: 'USD' },
        }],
      },
    }, 'ocp.mcp.query_catalog'),
  ]);

  expect(summary?.catalogName).toBe('Direct Query Catalog');
  expect(summary?.products[0]?.title).toBe('Direct Query Shoes');
  expect(summary?.products[0]?.price).toBe('$12.50');
});

test('ignores malformed entries without throwing', () => {
  const summary = summarizeCatalogCall(createRecord({
    structuredContent: {
      query_result: {
        entries: { invalid: true },
      },
    },
  }));

  expect(summary.products).toEqual([]);
  expect(summary.title).toBe('没有找到商品');
});

test('summarizes direct catalog HTTP list response items', () => {
  const summary = summarizeCatalogResponse({
    catalog_id: 'cat_local_dev',
    items: [{
      entry_id: 'entry-1',
      title: 'HTTP Listed Product',
      attributes: {
        amount: 9,
        currency: 'USD',
        primary_image_url: 'https://example.com/item.jpg',
      },
    }],
  }, 'Commerce Product Search Catalog');

  expect(summary.catalogName).toBe('Commerce Product Search Catalog');
  expect(summary.products[0]?.title).toBe('HTTP Listed Product');
  expect(summary.products[0]?.price).toBe('$9.00');
});

function createRecord(result: unknown, toolName = 'ocp.mcp.find_and_query_catalog'): DemoCallRecord {
  return {
    id: 'call-1',
    toolName,
    input: { query: 'shoes' },
    result,
    createdAt: '2026-05-10T00:00:00.000Z',
  };
}
