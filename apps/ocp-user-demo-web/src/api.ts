export type CatalogSearchItem = {
  catalog_id: string;
  catalog_name: string;
  description?: string;
  score: number;
  matched_query_capabilities: string[];
  verification_status: string;
  trust_tier: string;
  health_status: string;
  route_hint: {
    catalog_id: string;
    catalog_name: string;
    description?: string;
    manifest_url: string;
    query_url: string;
    resolve_url?: string;
    supported_query_packs: string[];
    metadata: {
      query_hints?: {
        supported_query_modes?: string[];
        supported_query_languages?: string[];
        content_languages?: string[];
      };
    };
    verification_status: string;
    trust_tier: string;
    health_status: string;
    snapshot_id: string;
    snapshot_fetched_at: string;
  };
  explain: string[];
};

export type CatalogQueryItem = {
  entry_id: string;
  provider_id: string;
  object_id: string;
  title: string;
  summary?: string;
  score: number;
  attributes: Record<string, unknown>;
  explain: string[];
};

export type SavedCatalogProfile = {
  catalog_id: string;
  catalog_name: string;
  route_hint: CatalogSearchItem['route_hint'];
  verification_status: string;
  trust_tier: string;
  health_status: string;
  registered_at: string;
  last_used_at: string;
};

export type QuerySession = {
  baseIntent: string;
  latestUserTurn: string;
  activeFilters: {
    category?: string;
    brand?: string;
    currency?: string;
    availability_status?: string;
    provider_id?: string;
    sku?: string;
    min_amount?: number;
    max_amount?: number;
    in_stock_only?: boolean;
    has_image?: boolean;
  };
  queryMode?: 'keyword' | 'filter' | 'semantic' | 'hybrid';
  queryPack?: string;
  sortPreference?: 'relevance' | 'price_asc';
};

export type ResolvableReference = {
  id: string;
  catalog_id: string;
  entry_id: string;
  commercial_object_id: string;
  object_id: string;
  object_type: string;
  provider_id: string;
  title: string;
  visible_attributes: Record<string, unknown>;
  action_bindings: Array<{
    action_id: string;
    action_type: 'url';
    label: string;
    url: string;
    method: 'GET';
  }>;
  freshness: {
    object_updated_at: string;
    resolved_at: string;
  };
  expires_at: string;
};

const centerBaseUrl = import.meta.env.VITE_CENTER_API_BASE_URL || 'http://localhost:4100';
const fallbackCatalogQueryUrl = import.meta.env.VITE_DEFAULT_CATALOG_QUERY_URL || 'http://localhost:4000/ocp/query';
const fallbackCatalogResolveUrl = import.meta.env.VITE_DEFAULT_CATALOG_RESOLVE_URL || 'http://localhost:4000/ocp/resolve';
const userDemoApiPrefix = '/api/user-demo';

export async function searchCenter(input: {
  query: string;
  queryMode?: string;
  queryPack?: string;
  verificationStatus?: string;
  supportsResolve?: boolean;
}) {
  const payload = await request<{ items: CatalogSearchItem[]; explain: string[] }>(`${centerBaseUrl}/ocp/catalogs/search`, {
    method: 'POST',
    body: {
      ocp_version: '1.0',
      kind: 'CatalogSearchRequest',
      query: input.query,
      filters: {
        ...(input.queryMode ? { query_mode: input.queryMode } : {}),
        ...(input.queryPack ? { query_pack: input.queryPack } : {}),
        ...(input.verificationStatus ? { verification_status: input.verificationStatus } : {}),
        ...(input.supportsResolve !== undefined ? { supports_resolve: input.supportsResolve } : {}),
      },
      limit: 10,
      explain: true,
    },
  });

  return payload;
}

export async function queryCatalog(routeHint: CatalogSearchItem['route_hint'] | null, input: {
  query: string;
  queryMode?: string;
  queryPack?: string;
  filters?: Record<string, string | number | boolean>;
}) {
  const queryUrl = routeHint?.query_url || fallbackCatalogQueryUrl;
  return request<{ items: CatalogQueryItem[]; explain: string[]; query_mode: string }>(queryUrl, {
    method: 'POST',
    body: {
      ocp_version: '1.0',
      kind: 'CatalogQueryRequest',
      catalog_id: routeHint?.catalog_id,
      query_pack: input.queryPack || undefined,
      query_mode: input.queryMode || undefined,
      query: input.query,
      filters: input.filters || {},
      limit: 12,
      explain: true,
    },
  });
}

export async function resolveEntry(routeHint: CatalogSearchItem['route_hint'] | null, entryId: string) {
  const resolveUrl = routeHint?.resolve_url || fallbackCatalogResolveUrl;
  return request<ResolvableReference>(resolveUrl, {
    method: 'POST',
    body: {
      ocp_version: '1.0',
      kind: 'ResolveRequest',
      catalog_id: routeHint?.catalog_id,
      entry_id: entryId,
    },
  });
}

export async function runAgentRoute(input: {
  centerQuery: string;
  catalogQuery: string;
  queryMode?: string;
  queryPack?: string;
}) {
  const timeline: string[] = [];

  timeline.push('Searching OCP Center for candidate catalogs.');
  const center = await searchCenter({
    query: input.centerQuery,
    queryMode: input.queryMode,
    queryPack: input.queryPack,
    verificationStatus: 'verified',
    supportsResolve: true,
  });

  if (!center.items.length) {
    throw new Error('No catalogs matched the current center search.');
  }

  const selectedCatalog = center.items[0];
  timeline.push(`Selected catalog ${selectedCatalog.catalog_name} from center results.`);

  const catalog = await queryCatalog(selectedCatalog.route_hint, {
    query: input.catalogQuery,
    queryMode: input.queryMode,
    queryPack: input.queryPack,
    filters: {},
  });

  if (!catalog.items.length) {
    throw new Error('The selected catalog returned no content for the current query.');
  }

  const selectedEntry = catalog.items[0];
  timeline.push(`Queried catalog and picked top entry ${selectedEntry.title}.`);

  const resolved = await resolveEntry(selectedCatalog.route_hint, selectedEntry.entry_id);
  timeline.push('Resolved the entry into a user action binding.');

  return {
    center,
    selectedCatalog,
    catalog,
    selectedEntry,
    resolved,
    timeline,
  };
}

export async function agentTurn(input: {
  userInput: string;
  savedProfiles: SavedCatalogProfile[];
  activeCatalogId?: string | null;
  pendingCatalog?: CatalogSearchItem | null;
  session?: QuerySession | null;
  previousResults?: CatalogQueryItem[];
}) {
  return request<{
    agent_message: string;
    pending_catalog: CatalogSearchItem | null;
    next_session: QuerySession | null;
    result_items: CatalogQueryItem[];
    selected_catalog_id: string | null;
  }>(`${userDemoApiPrefix}/agent/turn`, {
    method: 'POST',
    body: {
      user_input: input.userInput,
      saved_profiles: input.savedProfiles,
      active_catalog_id: input.activeCatalogId ?? null,
      pending_catalog: input.pendingCatalog ?? null,
      session: input.session ?? null,
      previous_results: input.previousResults ?? [],
    },
  });
}

export async function confirmCatalogRegistration(input: {
  pendingCatalog: CatalogSearchItem;
  session: QuerySession;
}) {
  return request<{
    agent_message: string;
    next_session: QuerySession;
    result_items: CatalogQueryItem[];
    selected_catalog_id: string;
  }>(`${userDemoApiPrefix}/agent/confirm-registration`, {
    method: 'POST',
    body: {
      pending_catalog: input.pendingCatalog,
      session: input.session,
    },
  });
}

async function request<T>(url: string, options: { method: 'POST'; body: unknown }) {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return payload as T;
}
