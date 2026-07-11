export type CatalogOption = {
  catalogId: string;
  catalogName: string;
  queryUrl: string;
  manifestUrl?: string;
  resolveUrl?: string;
  routeSupportedQueryPacks: string[];
  queryPackOptions: QueryPackOption[];
};

export type QueryPackOption = {
  packId: string;
  queryModes: CatalogQueryMode[];
};

export type CatalogQueryResponse = {
  catalog_id?: string;
  catalog_name?: string;
  query?: string;
  query_pack?: string;
  query_mode?: string;
  result_count?: number;
  entries?: Array<Record<string, unknown>>;
  page?: {
    limit?: number;
    offset?: number;
    has_more?: boolean;
  };
};

export type CatalogQueryMode = 'keyword' | 'filter' | 'semantic' | 'hybrid';

export type CatalogManifestFailure = {
  catalogId: string;
  catalogName: string;
  manifestUrl?: string;
  error: string;
};

export type CatalogManifestLoadResult = {
  catalogs: CatalogOption[];
  failures: CatalogManifestFailure[];
};

export type CatalogProductQueryInput = {
  query?: string;
  queryPack?: string;
  queryMode?: CatalogQueryMode;
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
  if (!Array.isArray(payload.items)) throw new Error('Catalog search response is missing items');
  return payload.items.map((item, index) => toCatalogOption(item, index));
}

export async function loadCatalogManifestOptions(
  catalog: CatalogOption,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8_000,
): Promise<CatalogOption> {
  if (!catalog.manifestUrl) {
    throw new Error(`Catalog ${catalog.catalogName} does not expose a manifest URL; cannot derive query packs`);
  }
  const response = await fetchWithTimeout(catalog.manifestUrl, fetchImpl, timeoutMs);
  if (!response.ok) throw new Error(`Catalog manifest fetch failed: HTTP ${response.status}`);
  const manifest = await response.json() as { query_capabilities?: unknown[] };
  const queryPackOptions = queryPackOptionsFromManifest(manifest);
  if (queryPackOptions.length === 0) {
    throw new Error(`Catalog ${catalog.catalogName} manifest declares no usable query packs`);
  }
  return { ...catalog, queryPackOptions };
}

export async function loadCatalogManifestOptionsIsolated(
  catalogs: CatalogOption[],
  fetchImpl: FetchLike = fetch,
  timeoutMs = 8_000,
): Promise<CatalogManifestLoadResult> {
  const settled = await Promise.all(catalogs.map(async (catalog) => {
    try {
      return { catalog: await loadCatalogManifestOptions(catalog, fetchImpl, timeoutMs) };
    } catch (error) {
      return {
        failure: {
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          manifestUrl: catalog.manifestUrl,
          error: errorMessage(error),
        },
      };
    }
  }));

  return {
    catalogs: settled.flatMap((item) => item.catalog ? [item.catalog] : []),
    failures: settled.flatMap((item) => item.failure ? [item.failure] : []),
  };
}

export function selectLoadedCatalog(result: CatalogManifestLoadResult, requestedCatalogId?: string) {
  if (requestedCatalogId) {
    const catalog = result.catalogs.find((candidate) => candidate.catalogId === requestedCatalogId);
    if (catalog) return catalog;
    const failure = result.failures.find((candidate) => candidate.catalogId === requestedCatalogId);
    if (failure) {
      throw new Error(`Requested Catalog ${failure.catalogName} (${failure.catalogId}) failed to load from ${failure.manifestUrl ?? 'a missing manifest URL'}: ${failure.error}`);
    }
    throw new Error(`Requested Catalog ${requestedCatalogId} was not returned by Registration search`);
  }
  return result.catalogs[0];
}

export async function listCatalogProducts(catalog: CatalogOption, input: CatalogProductQueryInput, fetchImpl: FetchLike = fetch): Promise<CatalogQueryResponse> {
  const query = input.query?.trim();
  const filters = cleanFilters(input.filters);
  const queryPack = pickQueryPack(catalog, input);
  const queryMode = pickQueryMode(catalog, input, queryPack);
  const offset = input.offset ?? 0;
  if (offset !== 0) {
    throw new Error('Catalog product queries only support offset 0; narrow filters instead of requesting deep offset pages');
  }
  const response = await fetchImpl(catalog.queryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      catalog_id: catalog.catalogId,
      ...(queryPack ? { query_pack: queryPack } : {}),
      ...(queryMode ? { query_mode: queryMode } : {}),
      ...(query ? { query } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
      limit: input.limit,
      offset,
    }),
  });

  if (!response.ok) throw new Error(`Catalog query failed: HTTP ${response.status}`);
  return await response.json() as CatalogQueryResponse;
}

function toCatalogOption(value: unknown, index: number): CatalogOption {
  if (!isRecord(value)) throw new Error(`Catalog search item ${index} is not an object`);
  const routeHint = isRecord(value.route_hint) ? value.route_hint : undefined;
  const catalogId = getString(routeHint?.catalog_id) ?? getString(value.catalog_id);
  const catalogName = getString(routeHint?.catalog_name) ?? getString(value.catalog_name);
  const queryUrl = getString(routeHint?.query_url);
  if (!catalogId || !catalogName || !queryUrl) throw new Error(`Catalog search item ${index} is missing route hint fields`);

  return {
    catalogId,
    catalogName,
    queryUrl,
    manifestUrl: getString(routeHint?.manifest_url),
    resolveUrl: getString(routeHint?.resolve_url),
    routeSupportedQueryPacks: routeSupportedQueryPacks(routeHint, index),
    queryPackOptions: [],
  };
}

function pickQueryPack(catalog: CatalogOption, input: CatalogProductQueryInput) {
  const requestedPack = normalizeQueryPack(input.queryPack);
  if (requestedPack) return ensureSupportedQueryPack(catalog, requestedPack);

  const requestedMode = input.queryMode;
  if (requestedMode) {
    const option = catalog.queryPackOptions.find((candidate) => candidate.queryModes.includes(requestedMode));
    if (!option) {
      throw new Error(`Catalog ${catalog.catalogName} does not support query_mode ${requestedMode}`);
    }
    return option.packId;
  }

  const hasQuery = Boolean(input.query?.trim());
  const hasFilters = Boolean(input.filters && Object.values(input.filters).some((value) => value !== undefined && value !== null && value !== ''));
  if (!hasQuery && !hasFilters) return undefined;

  const supportedQueryPacks = queryPackIds(catalog);
  if (hasQuery && supportedQueryPacks.includes('ocp.query.keyword.v1')) return 'ocp.query.keyword.v1';
  if (hasFilters && supportedQueryPacks.includes('ocp.query.filter.v1')) return 'ocp.query.filter.v1';
  throw new Error(`Catalog ${catalog.catalogName} has no manifest-declared query_pack for this query shape`);
}

function pickQueryMode(catalog: CatalogOption, input: CatalogProductQueryInput, queryPack: string | undefined) {
  const hasQuery = Boolean(input.query?.trim());
  const hasFilters = hasNonEmptyFilters(input.filters);
  if (input.queryMode) {
    validateQueryModeShape(input.queryMode, { hasQuery, hasFilters });
    return ensureSupportedQueryMode(catalog, queryPack, input.queryMode);
  }
  if (!queryPack) return undefined;

  const supportedModes = queryModesForPack(catalog, queryPack);
  return ensureSupportedQueryMode(catalog, queryPack, inferModeForPack(queryPack, supportedModes, { hasQuery, hasFilters }));
}

function ensureSupportedQueryPack(catalog: CatalogOption, queryPack: string) {
  if (!queryPackIds(catalog).includes(queryPack)) {
    throw new Error(`Catalog ${catalog.catalogName} does not support query_pack ${queryPack}`);
  }
  return queryPack;
}

function ensureSupportedQueryMode(catalog: CatalogOption, queryPack: string | undefined, queryMode: CatalogQueryMode) {
  if (!queryPack) return queryMode;
  const supportedModes = queryModesForPack(catalog, queryPack);
  if (!supportedModes.includes(queryMode)) {
    throw new Error(`Catalog ${catalog.catalogName} query_pack ${queryPack} does not support query_mode ${queryMode}`);
  }
  return queryMode;
}

function inferModeForPack(
  queryPack: string,
  supportedModes: CatalogQueryMode[],
  input: { hasQuery: boolean; hasFilters: boolean },
) {
  if (queryPack === 'ocp.query.semantic.v1') {
    if (!input.hasQuery) throw new Error('semantic query_pack requires query text');
    if (input.hasFilters && supportedModes.includes('hybrid')) return 'hybrid';
    return 'semantic';
  }

  if (queryPack === 'ocp.query.filter.v1') {
    if (input.hasQuery && !input.hasFilters) {
      throw new Error('filter query_pack cannot be used with query text without filters');
    }
    if (input.hasQuery && input.hasFilters && supportedModes.includes('hybrid')) return 'hybrid';
    return 'filter';
  }

  if (queryPack === 'ocp.query.keyword.v1') {
    if (!input.hasQuery) throw new Error('keyword query_pack requires query text');
    if (input.hasFilters && supportedModes.includes('hybrid')) return 'hybrid';
    return 'keyword';
  }

  if (supportedModes.length === 1) return supportedModes[0];
  throw new Error(`query_pack ${queryPack} requires explicit query_mode`);
}

export function queryPackIds(catalog: Pick<CatalogOption, 'queryPackOptions'>) {
  return catalog.queryPackOptions.map((option) => option.packId);
}

export function queryModesForPack(catalog: Pick<CatalogOption, 'queryPackOptions'>, queryPack: string): CatalogQueryMode[] {
  return catalog.queryPackOptions.find((option) => option.packId === queryPack)?.queryModes ?? [];
}

function routeSupportedQueryPacks(routeHint: Record<string, unknown> | undefined, index: number) {
  if (!Array.isArray(routeHint?.supported_query_packs)) {
    throw new Error(`Catalog search item ${index} route_hint.supported_query_packs is missing or invalid`);
  }
  if (!routeHint.supported_query_packs.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`Catalog search item ${index} route_hint.supported_query_packs contains invalid values`);
  }
  return routeHint.supported_query_packs;
}

function queryPackOptionsFromManifest(manifest: { query_capabilities?: unknown[] }): QueryPackOption[] {
  if (!Array.isArray(manifest.query_capabilities)) {
    throw new Error('Catalog manifest query_capabilities is missing or invalid');
  }
  const options = new Map<string, QueryPackOption>();
  manifest.query_capabilities.forEach((capability, capabilityIndex) => {
    if (!isRecord(capability)) throw new Error(`Catalog manifest query_capabilities[${capabilityIndex}] is not an object`);
    if (!Array.isArray(capability.query_packs)) {
      throw new Error(`Catalog manifest query_capabilities[${capabilityIndex}].query_packs is missing or invalid`);
    }
    capability.query_packs.forEach((pack, packIndex) => {
      if (!isRecord(pack)) {
        throw new Error(`Catalog manifest query_capabilities[${capabilityIndex}].query_packs[${packIndex}] is not an object`);
      }
      const packId = getString(pack.pack_id);
      if (!packId) {
        throw new Error(`Catalog manifest query_capabilities[${capabilityIndex}].query_packs[${packIndex}].pack_id is missing or invalid`);
      }
      if (!Array.isArray(pack.query_modes)) {
        throw new Error(`Catalog manifest query_pack ${packId} query_modes is missing or invalid`);
      }
      const queryModes = pack.query_modes.map((mode) => {
        if (!isCatalogQueryMode(mode)) throw new Error(`Catalog manifest query_pack ${packId} contains unsupported query_mode ${String(mode)}`);
        return mode;
      });
      if (queryModes.length === 0) {
        throw new Error(`Catalog manifest query_pack ${packId} does not declare query_modes`);
      }
      options.set(packId, { packId, queryModes });
    });
  });
  return [...options.values()];
}

function validateQueryModeShape(
  queryMode: CatalogQueryMode,
  input: { hasQuery: boolean; hasFilters: boolean },
) {
  if ((queryMode === 'keyword' || queryMode === 'semantic') && !input.hasQuery) {
    throw new Error(`${queryMode} query_mode requires query text`);
  }
  if (queryMode === 'hybrid' && (!input.hasQuery || !input.hasFilters)) {
    throw new Error('hybrid query_mode requires both query text and filters');
  }
}

function isCatalogQueryMode(value: unknown): value is CatalogQueryMode {
  return value === 'keyword' || value === 'filter' || value === 'semantic' || value === 'hybrid';
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

function hasNonEmptyFilters(filters: Record<string, unknown> | undefined) {
  return Object.values(filters ?? {}).some((value) => value !== undefined && value !== null && value !== '');
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url: string, fetchImpl: FetchLike, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Manifest timeout must be a positive number');
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Catalog manifest fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
