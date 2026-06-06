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
  test('validates the requested pack against its own query modes', () => {
    const plan = planCommerceQuery(scenario, {
      query_pack: 'ocp.query.filter.v1',
      query: 'headphones',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: true });

    expect(plan.selectedQueryPack).toBe('ocp.query.filter.v1');
    expect(plan.queryMode).toBe('hybrid');
    expect(plan.policySummary.selected_query_pack).toBe('ocp.query.filter.v1');
  });

  test('rejects semantic pack when query text is empty', () => {
    expect(() => planCommerceQuery(scenario, {
      query_pack: 'ocp.query.semantic.v1',
      query: '',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: true })).toThrow('semantic query requires a non-empty query');
  });

  test('rejects semantic pack when retrieval is unavailable', () => {
    expect(() => planCommerceQuery(scenario, {
      query_pack: 'ocp.query.semantic.v1',
      query: 'noise cancelling headphones',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    }, { retrievalAvailable: false })).toThrow('semantic query capability is not enabled');
  });
});
