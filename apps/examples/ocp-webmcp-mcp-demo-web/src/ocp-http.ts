export type CatalogOption = {
  catalogId: string;
  catalogName: string;
  queryUrl: string;
  manifestUrl?: string;
  resolveUrl?: string;
  supportedQueryPacks: string[];
};

export type CatalogQueryResponse = {
  catalog_id?: string;
  catalog_name?: string;
  query?: string;
  query_pack?: string;
  result_count?: number;
  entries?: Array<Record<string, unknown>>;
  page?: {
    limit?: number;
    offset?: number;
    has_more?: boolean;
    next_offset?: number;
  };
};

export type CatalogSearchMode = 'keyword' | 'filter' | 'semantic';

export type CatalogProductQueryInput = {
  query?: string;
  queryPack?: string;
  searchMode?: CatalogSearchMode;
  filters?: Record<string, unknown>;
  limit: number;
  offset?: number;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function discoverRegistration(baseUrl: string, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}/.well-known/ocp-registration`);
  if (!response.ok) throw new Error(`Registration discovery failed: HTTP ${response.status}`);
  return await response.json() as {
    registration_id?: string;
    registration_name?: string;
    catalog_search_url?: string;
  };
}

export async function searchCatalogOptions(baseUrl: string, fetchImpl: FetchLike = fetch): Promise<CatalogOption[]> {
  const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}/ocp/catalogs/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'commerce product catalog',
      limit: 20,
      explain: true,
    }),
  });
  if (!response.ok) throw new Error(`Catalog search failed: HTTP ${response.status}`);

  const payload = await response.json() as { items?: unknown[] };
  return (payload.items ?? []).map(toCatalogOption).filter((item): item is CatalogOption => Boolean(item));
}

export async function listCatalogProducts(catalog: CatalogOption, input: CatalogProductQueryInput, fetchImpl: FetchLike = fetch): Promise<CatalogQueryResponse> {
  const query = input.query?.trim();
  const filters = cleanFilters(input.filters);
  const queryPack = pickQueryPack(catalog, input);
  const response = await fetchImpl(catalog.queryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      catalog_id: catalog.catalogId,
      ...(queryPack ? { query_pack: queryPack } : {}),
      ...(query ? { query } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
      limit: input.limit,
      offset: input.offset ?? 0,
    }),
  });

  if (!response.ok) throw new Error(`Catalog query failed: HTTP ${response.status}`);
  return await response.json() as CatalogQueryResponse;
}

function toCatalogOption(value: unknown): CatalogOption | null {
  if (!isRecord(value)) return null;
  const routeHint = isRecord(value.route_hint) ? value.route_hint : undefined;
  const catalogId = getString(routeHint?.catalog_id) ?? getString(value.catalog_id);
  const catalogName = getString(routeHint?.catalog_name) ?? getString(value.catalog_name);
  const queryUrl = getString(routeHint?.query_url);
  if (!catalogId || !catalogName || !queryUrl) return null;

  return {
    catalogId,
    catalogName,
    queryUrl,
    manifestUrl: getString(routeHint?.manifest_url),
    resolveUrl: getString(routeHint?.resolve_url),
    supportedQueryPacks: Array.isArray(routeHint?.supported_query_packs)
      ? routeHint.supported_query_packs.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function pickQueryPack(catalog: CatalogOption, input: CatalogProductQueryInput) {
  const requestedPack = normalizeQueryPack(input.queryPack);
  if (requestedPack) return ensureSupportedQueryPack(catalog, requestedPack);

  const requestedMode = input.searchMode;
  if (requestedMode) return ensureSupportedQueryPack(catalog, packForSearchMode(requestedMode));

  const hasQuery = Boolean(input.query?.trim());
  const hasFilters = Boolean(input.filters && Object.values(input.filters).some((value) => value !== undefined && value !== null && value !== ''));
  if (!hasQuery && !hasFilters) return undefined;

  if (hasQuery && catalog.supportedQueryPacks.includes('ocp.query.keyword.v1')) return 'ocp.query.keyword.v1';
  if (hasFilters && catalog.supportedQueryPacks.includes('ocp.query.filter.v1')) return 'ocp.query.filter.v1';
  return catalog.supportedQueryPacks[0];
}

function packForSearchMode(mode: CatalogSearchMode) {
  if (mode === 'semantic') return 'ocp.query.semantic.v1';
  if (mode === 'filter') return 'ocp.query.filter.v1';
  return 'ocp.query.keyword.v1';
}

function ensureSupportedQueryPack(catalog: CatalogOption, queryPack: string) {
  if (!catalog.supportedQueryPacks.includes(queryPack)) {
    throw new Error(`Catalog ${catalog.catalogName} does not support query_pack ${queryPack}`);
  }
  return queryPack;
}

function normalizeQueryPack(value: string | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanFilters(filters: Record<string, unknown> | undefined) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== undefined && value !== null && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
