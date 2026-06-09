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
          entry: {
            entry_id: 'sku-1',
            title: 'Goody Two-Shoes',
            attributes: {
              brand: 'ColourPop',
              amount: 5,
              currency: 'USD',
              availability_status: 'in_stock',
              primary_image_url: 'https://example.com/shoe.jpg',
              product_url: 'https://example.com/shoe',
            },
          },
          score: 1,
          explain: [],
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
          entry: {
            entry_id: 'sku-2',
            title: 'Direct Query Shoes',
            attributes: { amount: 12.5, currency: 'USD' },
          },
          score: 1,
          explain: [],
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

test('parses affiliate entry format with nested price and image_urls array', () => {
  const summary = summarizeCatalogResponse({
    catalog_id: 'cat_alimama',
    entries: [{
      entry: {
        entry_id: 'entry_alimama_1',
        title: '夏季连衣裙',
        image_url: 'https://img.alimama.example/top.jpg',
        attributes: {
          brand: '某旗舰店',
          price: { amount: 99.5, currency: 'CNY' },
          image_urls: ['https://img.alimama.example/a.jpg', 'https://img.alimama.example/b.jpg'],
          source_url: 'https://s.click.example/item',
        },
      },
      score: 0.8,
      explain: [],
    }],
  }, 'Alimama Affiliate Catalog');

  expect(summary.products).toHaveLength(1);
  expect(summary.products[0]).toMatchObject({
    title: '夏季连衣裙',
    brand: '某旗舰店',
    price: 'CN¥99.50',
    imageUrl: 'https://img.alimama.example/top.jpg',
    productUrl: 'https://s.click.example/item',
  });
});

test('falls back to image_urls array when no direct image field is present', () => {
  const summary = summarizeCatalogResponse({
    catalog_id: 'cat_pdd',
    entries: [{
      entry: {
        entry_id: 'entry_pdd_1',
        title: '拼团商品',
        attributes: {
          price: { amount: 25, currency: 'CNY' },
          image_urls: ['https://img.pdd.example/cover.jpg'],
        },
      },
      score: 1,
      explain: [],
    }],
  });

  expect(summary.products[0]?.imageUrl).toBe('https://img.pdd.example/cover.jpg');
  expect(summary.products[0]?.price).toBe('CN¥25.00');
});

test('findLatestCatalogSummary ignores page-native ocp.mall.* records', () => {
  const summary = findLatestCatalogSummary([
    createRecord({
      structuredContent: {
        entries: [{
          entry: { entry_id: 'sku-stale', title: 'Stale Mall Product', attributes: {} },
          score: 1,
          explain: [],
        }],
      },
    }, 'ocp.mall.list_products'),
    createRecord({
      structuredContent: {
        catalog_name: 'Gateway Query Catalog',
        entries: [{
          entry: { entry_id: 'sku-gw', title: 'Gateway Product', attributes: { amount: 7, currency: 'USD' } },
          score: 1,
          explain: [],
        }],
      },
    }, 'ocp.mcp.query_catalog'),
  ]);

  expect(summary?.catalogName).toBe('Gateway Query Catalog');
  expect(summary?.products[0]?.title).toBe('Gateway Product');
});

test('findLatestCatalogSummary returns null when only page-native records exist', () => {
  const summary = findLatestCatalogSummary([
    createRecord({
      structuredContent: {
        entries: [{
          entry: { entry_id: 'sku-mall', title: 'Mall Product', attributes: {} },
          score: 1,
          explain: [],
        }],
      },
    }, 'ocp.mall.search_products'),
  ]);

  expect(summary).toBeNull();
});

test('summarizes direct catalog HTTP list response entries', () => {
  const summary = summarizeCatalogResponse({
    catalog_id: 'cat_local_dev',
    entries: [{
      entry: {
        entry_id: 'entry-1',
        title: 'HTTP Listed Product',
        attributes: {
          amount: 9,
          currency: 'USD',
          primary_image_url: 'https://example.com/item.jpg',
        },
      },
      score: 1,
      explain: [],
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
