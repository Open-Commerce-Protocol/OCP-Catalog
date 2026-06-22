export const KEYWORD_QUERY_PACK = 'ocp.query.keyword.v1';
export const SEMANTIC_QUERY_PACK = 'ocp.query.semantic.v1';

export type SearchQueryPolicy = {
  queryPack: string;
  queryMode?: 'semantic';
};

export function selectSearchQueryPolicy(input: {
  query: string;
  supportedQueryPacks: readonly string[] | undefined;
}): SearchQueryPolicy | undefined {
  if (!input.query.trim()) return undefined;
  const supported = new Set(input.supportedQueryPacks ?? []);
  if (supported.has(SEMANTIC_QUERY_PACK)) {
    return { queryPack: SEMANTIC_QUERY_PACK, queryMode: 'semantic' };
  }
  if (supported.has(KEYWORD_QUERY_PACK)) {
    return { queryPack: KEYWORD_QUERY_PACK };
  }
  return undefined;
}

export function routeSupportedQueryPacks(routeHint: unknown, catalogId: string): string[] {
  if (!routeHint || typeof routeHint !== 'object') {
    throw new Error(`catalog ${catalogId} route_hint is missing or invalid`);
  }
  const value = (routeHint as { supported_query_packs?: unknown }).supported_query_packs;
  if (!Array.isArray(value)) {
    throw new Error(`catalog ${catalogId} route_hint.supported_query_packs is missing or invalid`);
  }
  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`catalog ${catalogId} route_hint.supported_query_packs contains non-string values`);
  }
  return value;
}
