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
  items?: Array<Record<string, unknown>>;
  entries?: Array<Record<string, unknown>>;
  page?: {
    limit?: number;
    offset?: number;
    has_more?: boolean;
    next_offset?: number;
  };
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

export async function listCatalogProducts(catalog: CatalogOption, input: {
  query?: string;
  limit: number;
  offset?: number;
}, fetchImpl: FetchLike = fetch): Promise<CatalogQueryResponse> {
  const query = input.query?.trim();
  const response = await fetchImpl(catalog.queryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      catalog_id: catalog.catalogId,
      ...(query ? { query_pack: pickKeywordPack(catalog), query } : {}),
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

function pickKeywordPack(catalog: CatalogOption) {
  return catalog.supportedQueryPacks.includes('ocp.query.keyword.v1')
    ? 'ocp.query.keyword.v1'
    : catalog.supportedQueryPacks[0];
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
