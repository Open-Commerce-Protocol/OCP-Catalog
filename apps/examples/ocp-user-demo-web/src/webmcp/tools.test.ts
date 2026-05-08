import { expect, test } from 'bun:test';
import type { CatalogQueryItem, CatalogSearchItem, QuerySession, ResolvableReference, SavedCatalogProfile } from '../api';
import { createOcpUserDemoWebMcpTools, type OcpUserDemoWebMcpContext } from './tools';
import { ocpUserDemoWebMcpManifest } from './manifest';

type PageState = ReturnType<OcpUserDemoWebMcpContext['getState']>;

function createState(overrides: Partial<PageState> = {}): PageState {
  const routeHint: CatalogSearchItem['route_hint'] = {
    catalog_id: 'catalog-1',
    catalog_name: 'Catalog One',
    manifest_url: 'https://private.example/manifest.json',
    query_url: 'https://private.example/query',
    resolve_url: 'https://private.example/resolve',
    supported_query_packs: ['products'],
    metadata: {},
    verification_status: 'verified',
    trust_tier: 'trusted',
    health_status: 'healthy',
    snapshot_id: 'snapshot-1',
    snapshot_fetched_at: '2026-05-08T00:00:00.000Z',
  };

  const savedProfile: SavedCatalogProfile = {
    catalog_id: 'catalog-1',
    catalog_name: 'Catalog One',
    route_hint: routeHint,
    verification_status: 'verified',
    trust_tier: 'trusted',
    health_status: 'healthy',
    registered_at: '2026-05-08T00:00:00.000Z',
    last_used_at: '2026-05-08T00:00:00.000Z',
  };

  const pendingCatalog: CatalogSearchItem = {
    catalog_id: 'catalog-2',
    catalog_name: 'Catalog Two',
    description: 'Pending catalog',
    score: 0.9,
    matched_query_capabilities: ['search'],
    verification_status: 'verified',
    trust_tier: 'trusted',
    health_status: 'healthy',
    route_hint: {
      ...routeHint,
      catalog_id: 'catalog-2',
      catalog_name: 'Catalog Two',
      manifest_url: 'https://pending.example/manifest.json',
      query_url: 'https://pending.example/query',
      resolve_url: 'https://pending.example/resolve',
    },
    explain: [],
  };

  const result: CatalogQueryItem = {
    entry_id: 'entry-1',
    provider_id: 'provider-1',
    object_id: 'object-1',
    title: 'Result One',
    summary: 'Public result summary',
    score: 0.8,
    attributes: {},
    explain: [],
  };

  const resolvedItem: ResolvableReference = {
    id: 'resolved-1',
    catalog_id: 'catalog-1',
    entry_id: 'entry-1',
    commercial_object_id: 'commercial-1',
    object_id: 'object-1',
    object_type: 'product',
    provider_id: 'provider-1',
    title: 'Resolved Result',
    visible_attributes: {},
    action_bindings: [
      {
        action_id: 'open-product',
        action_type: 'open',
        label: 'Open product',
        method: 'GET',
        url: 'https://private.example/actions/open-product',
      },
    ],
    freshness: {
      object_updated_at: '2026-05-08T00:00:00.000Z',
      resolved_at: '2026-05-08T00:00:00.000Z',
    },
    expires_at: '2026-05-09T00:00:00.000Z',
  };

  const querySession: QuerySession = {
    baseIntent: 'find products',
    latestUserTurn: 'show me products',
    activeFilters: { provider_id: 'provider-1' },
    queryMode: 'hybrid',
    queryPack: 'products',
    sortPreference: 'relevance',
    searchSteps: [
      {
        purpose: 'search catalog',
        catalog_query: 'private internal query',
        query_pack: 'products',
        filters: { provider_id: 'provider-1' },
      },
    ],
  };

  return {
    savedProfiles: [savedProfile],
    pendingCatalog,
    activeProfile: savedProfile,
    catalogResults: [result],
    resolvedItem,
    querySession,
    busyAction: null,
    ...overrides,
  };
}

function createContext(state: PageState, openedActions: string[] = []): OcpUserDemoWebMcpContext {
  return {
    getState: () => state,
    submitUserIntent: async () => {},
    confirmPendingCatalog: async () => {},
    selectCatalogProfile: () => {},
    resolveResultEntry: async () => {},
    openResolvedAction: (actionId) => {
      openedActions.push(actionId);
    },
  };
}

function toolByName(name: string, state = createState(), openedActions: string[] = []) {
  const tools = createOcpUserDemoWebMcpTools({ current: createContext(state, openedActions) });
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

test('does not expose destructive local memory clear tool', () => {
  const tools = createOcpUserDemoWebMcpTools({ current: createContext(createState()) });
  const names = tools.map((tool) => tool.name);

  expect(names).not.toContain('ocp.clear_local_catalog_memory');
  expect(ocpUserDemoWebMcpManifest.tools).not.toContain('ocp.clear_local_catalog_memory');
});

test('page state summary does not leak catalog endpoint URLs', async () => {
  const summary = await toolByName('ocp.get_page_state').handler({});
  const serialized = JSON.stringify(summary);

  expect(serialized).not.toContain('query_url');
  expect(serialized).not.toContain('resolve_url');
  expect(serialized).not.toContain('manifest_url');
  expect(serialized).not.toContain('https://private.example');
  expect(serialized).not.toContain('https://pending.example');
});

test('resolved action summary exposes openability without leaking URLs', async () => {
  const summary = await toolByName('ocp.get_page_state').handler({});
  const resolvedItem = (summary as { resolvedItem: { actions: Array<Record<string, unknown>> } }).resolvedItem;

  expect(resolvedItem.actions).toEqual([
    {
      actionId: 'open-product',
      actionType: 'open',
      label: 'Open product',
      method: 'GET',
      canOpen: true,
    },
  ]);
  expect(JSON.stringify(resolvedItem.actions)).not.toContain('url');
  expect(JSON.stringify(resolvedItem.actions)).not.toContain('https://private.example');
});

test('open resolved action only accepts actions on the current resolved item', async () => {
  const openedActions: string[] = [];
  const openTool = toolByName('ocp.open_resolved_action', createState(), openedActions);

  expect(() => openTool.handler({ actionId: 'missing-action' })).toThrow(
    'Action missing-action is not available on the current resolved item',
  );
  expect(openedActions).toEqual([]);

  expect(openTool.handler({ actionId: 'open-product' })).toEqual({ ok: true });
  expect(openedActions).toEqual(['open-product']);
});
