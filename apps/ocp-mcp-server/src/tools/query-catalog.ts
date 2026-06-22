import { catalogRouteHintSchema } from '@ocp-catalog/registration-schema';
import { assertSupportedFilters, loadCatalogManifest, summarizeManifest } from '../ocp/manifest';
import { negotiateQueryPolicy } from '../ocp/query-policy';
import { resolveRouteHint } from '../ocp/route-hints';
import type { QueryCatalogInput } from '../schemas/tool-inputs';
import type { ToolDeps } from './context';

export async function queryCatalogTool(input: QueryCatalogInput, deps: ToolDeps) {
  const routeHint = await resolveRouteHint({
    routeHint: input.route_hint ? catalogRouteHintSchema.parse(input.route_hint) : undefined,
    catalogId: input.catalog_id,
    registrationBaseUrl: input.registration_base_url ?? deps.config.OCP_MCP_DEFAULT_REGISTRATION_URL,
    registrationClient: deps.registrationClient,
  });
  const manifest = await loadCatalogManifest({ routeHint, catalogClient: deps.catalogClient });

  assertSupportedFilters(manifest, input.filters ?? {});
  const queryPolicy = negotiateQueryPolicy(manifest, {
    query_pack: input.query_pack,
    query_mode: input.query_mode,
    query: input.query ?? '',
    filters: input.filters ?? {},
  });

  const result = await deps.catalogClient.query(routeHint.query_url, {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    catalog_id: manifest.catalog_id,
    query_pack: queryPolicy.queryPack,
    ...(input.query_mode ? { query_mode: queryPolicy.queryMode } : {}),
    query: input.query ?? '',
    filters: input.filters ?? {},
    limit: input.limit ?? 10,
    offset: input.offset ?? 0,
    explain: queryPolicy.supportsExplain ? input.explain ?? true : false,
  });

  return {
    catalog_id: result.catalog_id,
    catalog_name: manifest.catalog_name,
    query_url: routeHint.query_url,
    requested_query_pack: input.query_pack ?? null,
    requested_query_mode: input.query_mode ?? null,
    query_pack: result.query_pack ?? queryPolicy.queryPack,
    query_mode: result.query_mode ?? queryPolicy.queryMode,
    query: result.query,
    result_count: result.result_count,
    entries: result.entries,
    page: result.page,
    policy_summary: result.policy_summary ?? queryPolicy.policySummary,
    audit_id: result.audit_id ?? null,
    explain: result.explain,
    capability_summary: summarizeManifest(manifest),
  };
}
