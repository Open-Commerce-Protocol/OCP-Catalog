import { describe, expect, test } from 'bun:test';
import type { CatalogScenarioModule } from '@ocp-catalog/catalog-core';
import { planCommerceQuery } from './commerce-query-planner';

const scenario = {
  queryCapabilities: () => [
    {
      capability_id: 'commerce.search',
      supports_explain: true,
      query_packs: [
        { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword', 'hybrid'], metadata: {} },
        { pack_id: 'ocp.query.filter.v1', query_modes: ['filter', 'hybrid'], metadata: {} },
        { pack_id: 'ocp.query.semantic.v1', query_modes: ['semantic', 'hybrid'], metadata: {} },
      ],
    },
  ],
} as unknown as CatalogScenarioModule;

describe('planCommerceQuery', () => {
  test('accepts the requested pack when the inferred query mode is supported', () => {
    const plan = planCommerceQuery(scenario, {
      query_pack: 'ocp.query.filter.v1',
      query: 'headphones',
      filters: { category: 'audio' },
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: true });

    expect(plan.selectedQueryPack).toBe('ocp.query.filter.v1');
    expect(plan.queryMode).toBe('hybrid');
    expect(plan.policySummary.selected_query_pack).toBe('ocp.query.filter.v1');
  });

  test('rejects a requested pack instead of downgrading to one of its supported modes', () => {
    expect(() => planCommerceQuery(scenario, {
      query_pack: 'ocp.query.filter.v1',
      query: 'headphones',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: true })).toThrow('query_pack ocp.query.filter.v1 does not support query mode keyword');
  });

  test('rejects an inferred mode that is unsupported by every declared pack', () => {
    const keywordOnlyScenario = {
      queryCapabilities: () => [
        {
          capability_id: 'commerce.search',
          supports_explain: true,
          query_packs: [
            { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'], metadata: {} },
          ],
        },
      ],
    } as unknown as CatalogScenarioModule;

    expect(() => planCommerceQuery(keywordOnlyScenario, {
      query: '',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: true })).toThrow('Unsupported query strategy: filter');
  });

  test('rejects semantic pack when query text is empty', () => {
    expect(() => planCommerceQuery(scenario, {
      query_pack: 'ocp.query.semantic.v1',
      query_mode: 'semantic',
      query: '',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    } as Parameters<typeof planCommerceQuery>[1], { retrievalAvailable: true })).toThrow('semantic query requires a non-empty query');
  });

  test('rejects semantic pack when retrieval is unavailable', () => {
    expect(() => planCommerceQuery(scenario, {
      query_pack: 'ocp.query.semantic.v1',
      query_mode: 'semantic',
      query: 'noise cancelling headphones',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    } as Parameters<typeof planCommerceQuery>[1], { retrievalAvailable: false })).toThrow('semantic query capability is not enabled');
  });
});
