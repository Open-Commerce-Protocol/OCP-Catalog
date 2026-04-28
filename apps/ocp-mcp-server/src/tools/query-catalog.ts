import { catalogRouteHintSchema } from '@ocp-catalog/registration-schema';
import { assertSupportedFilters, assertSupportedQueryPack, loadCatalogManifest, summarizeManifest } from '../ocp/manifest';
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

  assertSupportedQueryPack(manifest, input.query_pack);
  assertSupportedFilters(manifest, input.filters ?? {});

  const result = await deps.catalogClient.query(routeHint.query_url, {
    ocp_version: '1.0',
    kind: 'CatalogQueryRequest',
    catalog_id: manifest.catalog_id,
    query_pack: input.query_pack,
    query: input.query ?? '',
    filters: input.filters ?? {},
    limit: input.limit ?? 10,
    offset: input.offset ?? 0,
    explain: input.explain ?? true,
  }, deps.config.OCP_MCP_API_KEY || undefined);

  return {
    catalog_id: result.catalog_id,
    catalog_name: manifest.catalog_name,
    query_url: routeHint.query_url,
    requested_query_pack: input.query_pack ?? null,
    query_pack: result.query_pack ?? null,
    query: result.query,
    result_count: result.result_count,
    entries: result.items,
    page: result.page,
    explain: result.explain,
    capability_summary: summarizeManifest(manifest),
  };
}
