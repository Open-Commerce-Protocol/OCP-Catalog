import type { CatalogSearchResultItem } from '@ocp-catalog/registration-schema';
import type { SearchCatalogsInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';

export async function searchCatalogsTool(input: SearchCatalogsInput, deps: ToolDeps) {
  const registrationBaseUrl = input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL;
  const request = {
    ocp_version: '1.0',
    kind: 'CatalogSearchRequest',
    query: input.query ?? '',
    filters: input.filters ?? {},
    limit: input.limit ?? 10,
    explain: input.explain ?? true,
  } as const;
  const result = await deps.registrationClient.search(registrationBaseUrl, request);
  const shouldFallbackToListing = result.result_count === 0 && request.query.trim().length > 0;
  const effectiveResult = shouldFallbackToListing
    ? await deps.registrationClient.search(registrationBaseUrl, { ...request, query: '' })
    : result;

  return {
    registration_base_url: registrationBaseUrl,
    registration_id: effectiveResult.registration_id,
    result_count: effectiveResult.result_count,
    catalogs: effectiveResult.items.map(normalizeCatalogCandidate),
    explain: [
      ...result.explain,
      ...(shouldFallbackToListing ? ['Initial keyword search returned no catalogs; retried with an empty query to list active catalogs.'] : []),
      ...(shouldFallbackToListing ? effectiveResult.explain : []),
    ],
    fallback_used: shouldFallbackToListing,
  };
}

export function normalizeCatalogCandidate(item: CatalogSearchResultItem) {
  return {
    catalog_id: item.catalog_id,
    catalog_name: item.catalog_name,
    description: item.description ?? null,
    score: item.score,
    matched_query_capabilities: item.matched_query_capabilities,
    verification_status: item.verification_status,
    trust_tier: item.trust_tier,
    health_status: item.health_status,
    route_hint: item.route_hint,
    manifest_url: item.route_hint.manifest_url,
    query_url: item.route_hint.query_url,
    resolve_url: item.route_hint.resolve_url ?? null,
    supported_query_packs: item.route_hint.supported_query_packs,
    metadata: item.route_hint.metadata,
    explain: item.explain,
  };
}
